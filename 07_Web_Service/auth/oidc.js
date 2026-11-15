import crypto from "node:crypto";

export class AuthenticationError extends Error {
  constructor(message = "Authentication failed.", status = 401) {
    super(message);
    this.name = "AuthenticationError";
    this.status = status;
  }
}

const decode = value => {
  try { return JSON.parse(Buffer.from(String(value), "base64url").toString("utf8")); }
  catch { throw new AuthenticationError("Invalid identity token."); }
};

function audienceMatches(actual, expected) {
  return (Array.isArray(actual) ? actual : [actual]).includes(expected);
}

export class OidcVerifier {
  constructor({issuer, audience, jwksUri, fetchImpl = globalThis.fetch, cacheMs = 300_000, clock = () => Date.now()} = {}) {
    this.issuer = String(issuer || "").replace(/\/$/, "");
    this.audience = String(audience || "");
    this.jwksUri = String(jwksUri || "");
    if (!this.issuer || !this.audience || !this.jwksUri) throw new AuthenticationError("OIDC issuer, audience, and JWKS URL are required.", 500);
    if (typeof fetchImpl !== "function") throw new AuthenticationError("OIDC verification requires a fetch implementation.", 500);
    this.fetch = fetchImpl;
    this.cacheMs = cacheMs;
    this.clock = clock;
    this.cache = null;
  }

  async keys() {
    if (this.cache && this.cache.expiresAt > this.clock()) return this.cache.keys;
    let response;
    try { response = await this.fetch(this.jwksUri, {headers: {accept: "application/json"}}); }
    catch { throw new AuthenticationError("The identity provider is unavailable.", 503); }
    if (!response.ok) throw new AuthenticationError("The identity provider rejected its signing-key request.", 503);
    const data = await response.json();
    if (!Array.isArray(data.keys)) throw new AuthenticationError("The identity provider returned invalid signing keys.", 503);
    this.cache = {keys: data.keys, expiresAt: this.clock() + this.cacheMs};
    return data.keys;
  }

  async verify(token) {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) throw new AuthenticationError("Invalid identity token.");
    const header = decode(parts[0]);
    const claims = decode(parts[1]);
    if (header.alg !== "RS256" || !header.kid) throw new AuthenticationError("Unsupported identity-token signature.");
    const jwk = (await this.keys()).find(item => item.kid === header.kid && (!item.use || item.use === "sig"));
    if (!jwk) {
      this.cache = null;
      const refreshed = (await this.keys()).find(item => item.kid === header.kid && (!item.use || item.use === "sig"));
      if (!refreshed) throw new AuthenticationError("The identity token uses an unknown signing key.");
      return this.verifyWithKey(parts, claims, refreshed);
    }
    return this.verifyWithKey(parts, claims, jwk);
  }

  verifyWithKey(parts, claims, jwk) {
    let valid = false;
    try {
      const key = crypto.createPublicKey({key: jwk, format: "jwk"});
      valid = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"));
    } catch { valid = false; }
    if (!valid) throw new AuthenticationError("Invalid identity-token signature.");
    const now = Math.floor(this.clock() / 1000);
    if (String(claims.iss || "").replace(/\/$/, "") !== this.issuer) throw new AuthenticationError("Identity-token issuer does not match.");
    if (!audienceMatches(claims.aud, this.audience)) throw new AuthenticationError("Identity-token audience does not match.");
    if (!Number.isFinite(claims.exp) || claims.exp <= now) throw new AuthenticationError("Identity token has expired.");
    if (Number.isFinite(claims.nbf) && claims.nbf > now) throw new AuthenticationError("Identity token is not active.");
    if (!String(claims.sub || "").trim()) throw new AuthenticationError("Identity token has no subject.");
    return claims;
  }
}
