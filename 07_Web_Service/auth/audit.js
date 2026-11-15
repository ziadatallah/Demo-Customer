import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
};
const digest = value => crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

function eventFor(req, permission, outcome) {
  return {
    id: crypto.randomUUID(),
    organizationId: req.auth?.organizationId || null,
    actorId: req.auth?.id || null,
    actorLabel: req.auth?.displayName || req.auth?.subject || "Unauthenticated",
    subject: req.auth?.subject || null,
    role: req.auth?.role || null,
    action: `authorization.${outcome}`,
    permission,
    method: String(req.method || "").toUpperCase(),
    path: String(req.originalUrl || req.url || req.path || "").split("?")[0],
    occurredAt: new Date().toISOString(),
  };
}

export class FileAuthorizationAudit {
  constructor(filename) {
    this.filename = path.resolve(filename);
    fs.mkdirSync(path.dirname(this.filename), {recursive: true});
  }
  async record(req, permission, outcome) {
    const event = eventFor(req, permission, outcome);
    let previousHash = null;
    if (fs.existsSync(this.filename)) {
      const lines = fs.readFileSync(this.filename, "utf8").trim().split("\n").filter(Boolean);
      if (lines.length) previousHash = JSON.parse(lines.at(-1)).eventHash;
    }
    const complete = {...event, previousHash};
    complete.eventHash = digest(complete);
    fs.appendFileSync(this.filename, `${JSON.stringify(complete)}\n`, {mode: 0o600});
    return complete;
  }
}

export class PostgresAuthorizationAudit {
  constructor(metadata) { this.metadata = metadata; }
  async record(req, permission, outcome) {
    const event = eventFor(req, permission, outcome);
    if (!event.organizationId) throw new Error("Authorization audit requires an organization.");
    return this.metadata.withTenant(event.organizationId, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`isaf-auth:${event.organizationId}`]);
      const prior = await client.query(
        "SELECT event_hash FROM audit_events WHERE organization_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 1",
        [event.organizationId],
      );
      const previousHash = prior.rows[0]?.event_hash || prior.rows[0]?.eventHash || null;
      const complete = {...event, previousHash};
      const eventHash = digest(complete);
      await client.query(
        `INSERT INTO audit_events
          (id, organization_id, actor_id, actor_label, action, entity_kind, detail, previous_hash, event_hash, occurred_at)
         VALUES ($1, $2, $3, $4, $5, 'authorization', $6::jsonb, $7, $8, $9)`,
        [event.id, event.organizationId, event.actorId, event.actorLabel, event.action,
          JSON.stringify({subject: event.subject, role: event.role, permission, method: event.method, path: event.path}),
          previousHash, eventHash, event.occurredAt],
      );
      return {...complete, eventHash};
    });
  }
}

export function createAuthorizationAudit(repository, {filename} = {}) {
  if (repository?.metadata?.withTenant) return new PostgresAuthorizationAudit(repository.metadata);
  if (!filename) throw new Error("A local authorization-audit file is required.");
  return new FileAuthorizationAudit(filename);
}
