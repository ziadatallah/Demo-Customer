import {AuthenticationError, OidcVerifier} from "./oidc.js";
import {PostgresMembershipStore} from "./postgres_membership.js";
import {hasPermission} from "./permissions.js";
import crypto from "node:crypto";

export function createAuthentication({
  mode = process.env.ISAF_AUTH_MODE || "api-key",
  apiKey = process.env.ISAF_API_KEY || "",
  apiKeyHash = "", // SHA-256 (hex) of the access key, from a customer app's EDITION.json; used when no ISAF_API_KEY is set
  organizationId = process.env.ISAF_ORGANIZATION_ID,
  metadata,
  verifier,
  membershipStore,
  auditStore,
  onKeyRejected, // optional: called when a wrong access key is supplied (not when none is supplied)
  accessKeys = [], // named users of a customer app: [{id, name, sha256}] (EDITION.json access_keys); each key identifies its user
  env = process.env,
} = {}) {
  const selected = String(mode || "api-key").trim().toLowerCase();
  if (!["api-key", "oidc"].includes(selected)) throw new AuthenticationError(`Unknown authentication mode "${selected}".`, 500);
  const oidc = selected === "oidc"
    ? verifier || new OidcVerifier({issuer: env.ISAF_OIDC_ISSUER, audience: env.ISAF_OIDC_AUDIENCE, jwksUri: env.ISAF_OIDC_JWKS_URL})
    : null;
  const memberships = selected === "oidc" ? membershipStore || new PostgresMembershipStore(metadata) : null;

  const requireAuth = async (req, res, next) => {
    try {
      if (selected === "api-key") {
        const userKeys = (accessKeys || []).filter(k => /^[0-9a-f]{64}$/i.test(k?.sha256 || ""));
        if (!apiKey && !apiKeyHash && !userKeys.length) {
          req.auth = {mode: "development", subject: "local-development", role: "organization_admin", displayName: "Local user"};
          return next();
        }
        const provided = String(req.headers["x-api-key"] || req.query.key || "");
        const providedHash = Buffer.from(crypto.createHash("sha256").update(provided).digest("hex"));
        const same = hash => crypto.timingSafeEqual(providedHash, Buffer.from(String(hash).toLowerCase().padEnd(64, "0").slice(0, 64)));
        // A named user's key identifies that user (usage records name them). A customer app's own company key (set
        // in the Admin Customers tab) wins over ISAF_API_KEY, so changing the key there and publishing is all that is
        // needed; ISAF_API_KEY applies to apps without a built-in key.
        const user = provided ? userKeys.find(k => same(k.sha256)) : null;
        const matches = !!user || (apiKeyHash ? same(apiKeyHash) : (!!apiKey && provided === apiKey));
        if (provided && !matches) { try { onKeyRejected?.(req); } catch {} }
        if (!provided || !matches) throw new AuthenticationError("Invalid or missing API key.");
        req.auth = user
          ? {mode: "api-key", subject: "user:" + user.id, role: "service_account", displayName: user.name, user: {id: user.id, name: user.name}}
          : {mode: "api-key", subject: "legacy-api-key", role: "service_account", displayName: "ISAF service account", user: {id: "company-key", name: ""}};
        return next();
      }
      const header = String(req.headers.authorization || "");
      if (!header.startsWith("Bearer ")) throw new AuthenticationError("A signed user identity is required.");
      const claims = await oidc.verify(header.slice(7).trim());
      const member = await memberships.resolve(organizationId, claims.sub);
      if (!member) throw new AuthenticationError("This user is not an active member of the organization.", 403);
      req.auth = {mode: "oidc", organizationId, ...member, claims};
      return next();
    } catch (error) {
      const status = Number(error.status) || 401;
      return res.status(status).json({error: status === 403 ? error.message : (error.status === 503 ? error.message : "Invalid or missing authentication.")});
    }
  };
  const authorize = permission => async (req, res, next) => {
    try {
      if (!req.auth) return res.status(401).json({error: "Authentication is required."});
      if (permission === "filesystem.local" && req.auth.mode === "oidc") {
        await auditStore?.record(req, permission, "denied");
        return res.status(403).json({error: "This local-computer action is unavailable in the hosted application."});
      }
      if (!hasPermission(req.auth.role, permission)) {
        await auditStore?.record(req, permission, "denied");
        return res.status(403).json({error: "You do not have permission to perform this action."});
      }
      await auditStore?.record(req, permission, "allowed");
      return next();
    } catch {
      return res.status(503).json({error: "Authorization auditing is unavailable. Retry later."});
    }
  };
  return {mode: selected, requireAuth, authorize, memberships};
}
