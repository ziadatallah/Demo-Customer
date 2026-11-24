// User accounts for the Admin app (v6.0.0, owner 19-20 November 2026).
//
// Accounts are kept in ISAF_Accounts.json in the Admin data folder (the same folder as the customer register:
// beside the ISAF folder on an installed Admin, or ISAF_ADMIN_DATA_DIR, which a hosted Admin points at its
// persistent disk), so they survive upgrades and redeploys. Passwords are stored only as salted scrypt hashes.
// Sessions live in memory: a restart signs everyone out, which is acceptable for one small server.
//
// Roles: "owner" (manages accounts; at least one must stay active), "admin" (everything else in the Admin app) and
// "user" (program work only: no customers, demos, administration or accounts; owner, 21 November 2026).
//
// Customer apps (owner, 22 November 2026) use the same store with `seats`: the first account (the Customer Admin,
// role "owner", shown as "Admin") needs an Admin seat code from MX Aero, and active accounts may not exceed the
// seats of the codes entered (auth/seats.js). Disabling an account frees its seat for another person. Customer apps
// have only the "owner" (Admin) and "user" roles, and `singleSession`: signing in ends that login's other sessions,
// so one login cannot be used on two computers at once. `onEvent` receives account changes for the usage records.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {readSeatCode} from "./seats.js";

export const ROLES = Object.freeze(["owner", "admin", "user"]);
export const MIN_PASSWORD = 8; // owner, 19 November 2026
const MAX_PASSWORD = 128;
const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;      // signed out after 8 hours without activity
const SESSION_MAX_MS = 24 * 60 * 60 * 1000;      // and after 24 hours in any case
const LOCK_AFTER = 5;                            // consecutive wrong passwords before a lock
const LOCK_MS = 15 * 60 * 1000;
const SCRYPT = {N: 16384, r: 8, p: 1, keylen: 64};

// The most common passwords of eight characters or more, rejected quietly (owner agreed, 19 November 2026).
const COMMON = new Set(["password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "12345678",
  "123456789", "1234567890", "87654321", "11111111", "00000000", "12341234", "11223344", "qwertyui", "qwerty123",
  "qwertyuiop", "1q2w3e4r", "1qaz2wsx", "zaq12wsx", "asdfghjk", "abcd1234", "abc12345", "iloveyou", "sunshine",
  "princess", "football", "baseball", "superman", "trustno1", "welcome1", "welcome123", "letmein1", "changeme",
  "administrator", "admin123", "admin1234", "isafisaf", "isaf1234", "mxaero123", "aaaaaaaa", "computer",
  "internet", "starwars", "whatever", "michael1", "jennifer", "dragon12", "monkey12", "master12"]);

export class AccountError extends Error {
  constructor(message, status = 400, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

const now = () => new Date().toISOString();
const hashToken = token => crypto.createHash("sha256").update(token).digest("hex");
const cleanUsername = value => String(value ?? "").trim().toLowerCase();
const cleanText = (value, max = 120) => String(value ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p});
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, "base64"), expected.length, {N: Number(N), r: Number(r), p: Number(p)});
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Returns the reason a password is not acceptable, or "" when it is.
export function passwordProblem(password, {username = "", name = ""} = {}) {
  const value = String(password ?? "");
  if (value.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (value.length > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} characters.`;
  const lower = value.toLowerCase();
  if (COMMON.has(lower)) return "This password is too common. Choose another.";
  if (/^(.)\1+$/.test(value)) return "Do not repeat one character.";
  if (username && lower === cleanUsername(username)) return "The password cannot be the username.";
  if (name && lower.replace(/\s+/g, "") === String(name).toLowerCase().replace(/\s+/g, "")) return "The password cannot be your name.";
  return "";
}

// A temporary password for a new or reset account: 12 characters without look-alikes (0/O, 1/l/I).
export function temporaryPassword() {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(12);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
}

export function createAccountStore({file, eventsFile, clock = () => Date.now(), seats = null, singleSession = false, onEvent = null} = {}) {
  if (!file) throw new Error("createAccountStore needs a file");
  const sessions = new Map(); // sha256(token) -> {accountId, created, seen}
  const replaced = new Map(); // sha256(token) -> time: sessions ended because the login signed in elsewhere
  const roles = seats ? ["owner", "user"] : ROLES;
  const roleHelp = seats ? "Choose the Admin or User role." : "Choose the Owner, Admin or User role.";
  const manager = seats ? "your ISAF administrator" : "the ISAF owner";

  function load() {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return {version: 1, accounts: Array.isArray(data.accounts) ? data.accounts : [], seatCodes: Array.isArray(data.seatCodes) ? data.seatCodes : []};
    } catch (error) {
      if (error.code === "ENOENT") return {version: 1, accounts: [], seatCodes: []};
      throw new AccountError("The account file could not be read. Contact the ISAF owner.", 500);
    }
  }
  function save(data) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), {mode: 0o600});
    fs.renameSync(tmp, file);
  }
  function record(event, detail = {}) {
    if (!eventsFile) return;
    try {
      fs.mkdirSync(path.dirname(eventsFile), {recursive: true});
      fs.appendFileSync(eventsFile, JSON.stringify({at: now(), event, ...detail}) + "\n", {mode: 0o600});
    } catch { /* the account change itself has been saved; the event log is best effort */ }
    try { onEvent?.(event, detail); } catch { /* usage records are best effort too */ }
  }
  // Seats (Customer apps): the total of the seat codes entered, and the active accounts that use them.
  const activeCount = data => data.accounts.filter(a => !a.disabled).length;
  const seatTotal = data => data.seatCodes.reduce((n, c) => n + (Number(c.seats) || 0), 0);
  function seatView(data) {
    return {total: seatTotal(data), used: activeCount(data), codes: data.seatCodes.map(c => ({id: c.id, seats: c.seats, admin: !!c.admin, issuedAt: c.issuedAt || "", addedAt: c.addedAt, addedBy: c.addedBy || ""}))};
  }
  function needSeat(data) {
    if (!seats) return;
    const total = seatTotal(data);
    if (activeCount(data) >= total) throw new AccountError(`All ${total} seat${total === 1 ? " is" : "s are"} in use. Disable an account to free its seat, or add a seat code from MX Aero.`, 409);
  }
  function takeSeatCode(data, code, actorName) {
    const seat = readSeatCode(code, seats);
    if (data.seatCodes.some(c => c.id === seat.id)) throw new AccountError("This seat code has already been entered.", 409);
    const entry = {id: seat.id, seats: seat.seats, admin: seat.admin, issuedAt: seat.issuedAt, addedAt: now(), addedBy: actorName};
    data.seatCodes.push(entry);
    return entry;
  }
  const publicView = a => ({id: a.id, username: a.username, name: a.name, email: a.email || "", role: a.role,
    disabled: !!a.disabled, mustChange: !!a.mustChange, createdAt: a.createdAt, createdBy: a.createdBy || "",
    lastSignInAt: a.lastSignInAt || null, locked: !!(a.lockedUntil && Date.parse(a.lockedUntil) > clock())});
  const activeOwners = data => data.accounts.filter(a => a.role === "owner" && !a.disabled);
  function endSessions(accountId) { for (const [key, s] of sessions) if (s.accountId === accountId) sessions.delete(key); }
  function find(data, id) {
    const account = data.accounts.find(a => a.id === id);
    if (!account) throw new AccountError("This account does not exist.", 404);
    return account;
  }
  function validateNew(data, {username, name, role}) {
    const user = cleanUsername(username);
    if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(user)) throw new AccountError("Usernames are 3 to 40 characters: letters, digits, dots, dashes or underscores, starting with a letter or digit.");
    if (data.accounts.some(a => a.username === user)) throw new AccountError("This username is already taken.", 409);
    if (!cleanText(name)) throw new AccountError("Enter the person's full name.");
    if (!roles.includes(role)) throw new AccountError(roleHelp);
    return user;
  }
  function newAccount({username, name, email, role, password, mustChange, createdBy}) {
    return {id: crypto.randomUUID(), username, name: cleanText(name), email: cleanText(email, 200), role,
      passwordHash: hashPassword(password), mustChange: !!mustChange, disabled: false,
      createdAt: now(), createdBy: createdBy || "", updatedAt: now(), lastSignInAt: null, failed: 0, lockedUntil: null};
  }
  function startSession(account) {
    if (singleSession) {
      for (const [key, s] of sessions) if (s.accountId === account.id) { sessions.delete(key); replaced.set(key, clock()); }
      if (replaced.size > 5000) replaced.clear();
    }
    const token = crypto.randomBytes(32).toString("base64url");
    sessions.set(hashToken(token), {accountId: account.id, created: clock(), seen: clock()});
    return token;
  }

  return {
    hasAccounts: () => load().accounts.length > 0,
    list: () => load().accounts.map(publicView),
    usesSeats: () => !!seats,
    seats: () => seatView(load()),

    // First run only: the Owner account (in a Customer app the Customer Admin, which needs an Admin seat code from
    // MX Aero). Signs the new account in.
    setup({username, name, email, password, seatCode}) {
      const data = load();
      if (data.accounts.length) throw new AccountError(seats ? "The Admin account already exists. Sign in instead." : "The Owner account already exists. Sign in instead.", 409);
      const user = validateNew(data, {username, name, role: "owner"});
      const problem = passwordProblem(password, {username: user, name});
      if (problem) throw new AccountError(problem);
      let seat = null;
      if (seats) {
        seat = readSeatCode(seatCode, seats);
        if (!seat.admin) throw new AccountError("The first account needs an Admin seat code from MX Aero. This code adds seats but cannot create the Admin account.", 403);
      }
      const account = newAccount({username: user, name, email, role: "owner", password, mustChange: false, createdBy: "first setup"});
      account.lastSignInAt = now();
      if (seat) data.seatCodes.push({id: seat.id, seats: seat.seats, admin: true, issuedAt: seat.issuedAt, addedAt: now(), addedBy: user});
      data.accounts.push(account); save(data);
      if (seat) record("seats-added", {username: user, name: account.name, by: user, seats: seat.seats, total: seatTotal(data), used: activeCount(data), code: seat.id});
      record(seats ? "admin-created" : "owner-created", {username: user, name: account.name, role: "owner", by: user, ...(seats ? {total: seatTotal(data), used: activeCount(data)} : {})});
      return {token: startSession(account), account: publicView(account)};
    },
    // Customer app: a seat code from MX Aero adds seats.
    addSeatCode(actor, code) {
      if (!seats) throw new AccountError("Seat codes are used only in Customer apps.", 404);
      const data = load(), entry = takeSeatCode(data, code, actor.username);
      save(data);
      record("seats-added", {username: actor.username, name: actor.name, by: actor.username, seats: entry.seats, total: seatTotal(data), used: activeCount(data), code: entry.id});
      return seatView(data);
    },
    // True when this token's session ended because its login signed in on another computer (singleSession).
    replacedSession: token => !!token && replaced.has(hashToken(token)),

    signIn({username, password, ip = ""}) {
      const data = load(), user = cleanUsername(username);
      const account = data.accounts.find(a => a.username === user);
      const fail = () => new AccountError("The username or password is not correct.", 401);
      if (!account) { record("sign-in-failed", {username: user, ip, reason: "unknown"}); throw fail(); }
      if (account.lockedUntil && Date.parse(account.lockedUntil) > clock()) {
        const minutes = Math.ceil((Date.parse(account.lockedUntil) - clock()) / 60000);
        record("sign-in-refused", {username: user, ip, reason: "locked"});
        throw new AccountError(`Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or ask ${seats ? "your ISAF administrator" : "the Owner"} to reset your password.`, 429);
      }
      if (!verifyPassword(password, account.passwordHash)) {
        account.failed = (account.failed || 0) + 1;
        if (account.failed >= LOCK_AFTER) { account.lockedUntil = new Date(clock() + LOCK_MS).toISOString(); account.failed = 0; }
        save(data); record("sign-in-failed", {username: user, ip, reason: "password"});
        throw fail();
      }
      if (account.disabled) { record("sign-in-refused", {username: user, ip, reason: "disabled"}); throw new AccountError(`This account is disabled. Contact ${manager}.`, 403); }
      account.failed = 0; account.lockedUntil = null; account.lastSignInAt = now(); save(data);
      record("signed-in", {username: user, ip});
      return {token: startSession(account), account: publicView(account)};
    },

    // The account behind a session token, or null. Touches the session (idle timeout).
    session(token) {
      if (!token) return null;
      const key = hashToken(token), s = sessions.get(key);
      if (!s) return null;
      const t = clock();
      if (t - s.seen > SESSION_IDLE_MS || t - s.created > SESSION_MAX_MS) { sessions.delete(key); return null; }
      const account = load().accounts.find(a => a.id === s.accountId);
      if (!account || account.disabled) { sessions.delete(key); return null; }
      s.seen = t;
      return publicView(account);
    },
    signOut(token) { if (token) sessions.delete(hashToken(token)); },

    changePassword(accountId, {current, password}) {
      const data = load(), account = find(data, accountId);
      if (!verifyPassword(current, account.passwordHash)) throw new AccountError("The current password is not correct.", 403);
      const problem = passwordProblem(password, account);
      if (problem) throw new AccountError(problem);
      if (verifyPassword(password, account.passwordHash)) throw new AccountError("Choose a password different from the current one.");
      account.passwordHash = hashPassword(password); account.mustChange = false; account.updatedAt = now(); save(data);
      record("password-changed", {username: account.username});
      return publicView(account);
    },

    // Owner actions. `actor` is the Owner's public account view.
    create(actor, {username, name, email, role}) {
      const data = load(), user = validateNew(data, {username, name, role});
      needSeat(data);
      const password = temporaryPassword();
      const account = newAccount({username: user, name, email, role, password, mustChange: true, createdBy: actor.username});
      data.accounts.push(account); save(data);
      record("account-created", {username: user, name: account.name, role, by: actor.username, total: seats ? seatTotal(data) : undefined, used: seats ? activeCount(data) : undefined});
      return {account: publicView(account), temporaryPassword: password};
    },
    update(actor, id, changes = {}) {
      const data = load(), account = find(data, id);
      let temporary = null;
      if ("name" in changes) { if (!cleanText(changes.name)) throw new AccountError("Enter the person's full name."); account.name = cleanText(changes.name); }
      if ("email" in changes) account.email = cleanText(changes.email, 200);
      if ("role" in changes && changes.role !== account.role) {
        if (!roles.includes(changes.role)) throw new AccountError(roleHelp);
        if (account.role === "owner" && activeOwners(data).length === 1 && !account.disabled) throw new AccountError(seats ? "At least one active Admin is required. Make another account Admin first." : "At least one active Owner is required. Make another account Owner first.", 409);
        account.role = changes.role; record("role-changed", {username: account.username, name: account.name, role: account.role, by: actor.username});
      }
      if ("disabled" in changes && !!changes.disabled !== !!account.disabled) {
        if (changes.disabled) {
          if (account.id === actor.id) throw new AccountError("You cannot disable your own account.", 409);
          if (account.role === "owner" && activeOwners(data).length === 1) throw new AccountError(seats ? "At least one active Admin is required." : "At least one active Owner is required.", 409);
          account.disabled = true; endSessions(account.id);
        } else { needSeat(data); account.disabled = false; }
        record(account.disabled ? "account-disabled" : "account-enabled", {username: account.username, name: account.name, role: account.role, by: actor.username, total: seats ? seatTotal(data) : undefined, used: seats ? activeCount(data) : undefined});
      }
      if (changes.resetPassword) {
        temporary = temporaryPassword();
        account.passwordHash = hashPassword(temporary); account.mustChange = true; account.failed = 0; account.lockedUntil = null;
        endSessions(account.id); record("password-reset", {username: account.username, by: actor.username});
      }
      account.updatedAt = now(); save(data);
      return {account: publicView(account), ...(temporary ? {temporaryPassword: temporary} : {})};
    },
  };
}

// Reads the session cookie from a request.
export const SESSION_COOKIE = "isaf_session";
export function sessionToken(req) {
  const header = String(req?.headers?.cookie || "");
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return "";
}
export function sessionCookie(token, {secure = false, clear = false} = {}) {
  const parts = [`${SESSION_COOKIE}=${clear ? "" : encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Strict"];
  if (secure) parts.push("Secure");
  if (clear) parts.push("Max-Age=0");
  return parts.join("; ");
}
