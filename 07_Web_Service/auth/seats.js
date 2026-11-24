// Seat codes for Customer app accounts (owner, 22 November 2026).
//
// MX Aero controls how many people may have an active login in a Customer app. A seat code is a short signed text
// that MX Aero issues from the Admin app's Customers tab for one customer's license: it carries the license ID, the
// number of seats it adds, and whether it may create the app's first (Customer Admin) account. The Customer app
// checks the signature with MX Aero's public key, which is built into the app (EDITION.json seat_public_key), so no
// internet connection is needed. The app's seats are the total of the valid codes entered; a seat is free again
// when an account is disabled, so it can be given to another person (owner decision).
//
// Format: ISAF-SEAT.<base64url JSON payload>.<base64url Ed25519 signature of the payload part>.
// The private signing key exists only in the Admin data folder (ISAF_Seat_Signing_Key.pem, never committed and
// never shipped); losing it means new codes cannot be issued for apps built with the old public key.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PREFIX = "ISAF-SEAT";
export const KEY_FILE = "ISAF_Seat_Signing_Key.pem";

export class SeatCodeError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const b64 = buffer => Buffer.from(buffer).toString("base64url");

/** Admin app: the MX Aero signing key, created on first use in the Admin data folder. */
export function seatSigner(dataDir) {
  const file = path.join(dataDir, KEY_FILE);
  function key() {
    if (!fs.existsSync(file)) {
      const {privateKey} = crypto.generateKeyPairSync("ed25519");
      fs.mkdirSync(dataDir, {recursive: true});
      fs.writeFileSync(file, privateKey.export({type: "pkcs8", format: "pem"}), {mode: 0o600, flag: "wx"});
    }
    return crypto.createPrivateKey(fs.readFileSync(file, "utf8"));
  }
  return {
    file,
    exists: () => fs.existsSync(file),
    /** The public key built into Customer apps (base64 DER, SPKI). */
    publicKey: () => crypto.createPublicKey(key()).export({type: "spki", format: "der"}).toString("base64"),
    /** A seat code for one license. */
    issue({licenseId, company = "", seats = 1, admin = false}) {
      const count = Number.parseInt(seats, 10);
      if (!String(licenseId || "").trim()) throw new SeatCodeError("Set the customer's License ID before issuing seat codes.");
      if (!(count >= 1 && count <= 1000)) throw new SeatCodeError("A seat code adds 1 to 1000 seats.");
      const payload = {v: 1, id: crypto.randomBytes(6).toString("hex"), lic: String(licenseId).trim(), seats: count, admin: !!admin,
        co: String(company || "").slice(0, 80), iat: new Date().toISOString().slice(0, 10)};
      const body = b64(JSON.stringify(payload));
      const signature = crypto.sign(null, Buffer.from(body), key());
      return {code: `${PREFIX}.${body}.${b64(signature)}`, payload};
    },
  };
}

/** Customer app: checks a seat code against the built-in public key and the app's license ID. */
export function readSeatCode(code, {publicKey, licenseId}) {
  if (!publicKey || !licenseId) throw new SeatCodeError("This app cannot accept seat codes. Ask MX Aero for a Customer app with accounts.", 409);
  const text = String(code || "").replace(/\s+/g, "");
  const [prefix, body, signature] = text.split(".");
  if (prefix !== PREFIX || !body || !signature) throw new SeatCodeError("This is not an ISAF seat code. Copy the whole code from MX Aero.");
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(body), crypto.createPublicKey({key: Buffer.from(publicKey, "base64"), format: "der", type: "spki"}), Buffer.from(signature, "base64url")); } catch { ok = false; }
  if (!ok) throw new SeatCodeError("This seat code is not valid. Copy the whole code from MX Aero.");
  let payload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { throw new SeatCodeError("This seat code is not valid."); }
  if (payload.v !== 1 || !/^[0-9a-f]{12}$/.test(String(payload.id)) || !(payload.seats >= 1)) throw new SeatCodeError("This seat code is not valid.");
  if (payload.lic !== String(licenseId)) throw new SeatCodeError("This seat code is for another ISAF license.", 403);
  return {id: payload.id, seats: Math.min(1000, Number(payload.seats)), admin: !!payload.admin, issuedAt: String(payload.iat || ""), company: String(payload.co || "")};
}
