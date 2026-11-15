import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HERE = path.dirname(fileURLToPath(import.meta.url));

export class PostgresConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PostgresConfigurationError";
  }
}

export function requireUuid(value, label = "identifier") {
  if (!UUID.test(String(value || ""))) {
    throw new PostgresConfigurationError(`${label} must be a UUID.`);
  }
  return String(value);
}

export async function createPostgresPool({
  connectionString = process.env.ISAF_DATABASE_URL,
  ssl = process.env.ISAF_DATABASE_SSL === "require",
  max = Number(process.env.ISAF_DATABASE_POOL_SIZE || 10),
} = {}) {
  if (!connectionString) {
    throw new PostgresConfigurationError("ISAF_DATABASE_URL is required for PostgreSQL storage.");
  }
  let pg;
  try {
    pg = await import("pg");
  } catch {
    throw new PostgresConfigurationError(
      "The PostgreSQL driver is unavailable. Install the v5 web-service dependencies before enabling PostgreSQL storage.",
    );
  }
  const Pool = pg.Pool || pg.default?.Pool;
  if (!Pool) throw new PostgresConfigurationError("The PostgreSQL driver did not provide Pool.");
  return new Pool({connectionString, max, ssl: ssl ? {rejectUnauthorized: true} : false});
}

export function discoverMigrations({directory = path.join(HERE, "migrations")} = {}) {
  return fs.readdirSync(directory)
    .filter(name => /^\d{3}_[a-z0-9_-]+\.sql$/i.test(name))
    .sort()
    .map(name => {
      const sql = fs.readFileSync(path.join(directory, name), "utf8");
      return {
        id: name.replace(/\.sql$/i, ""),
        filename: name,
        sql,
        sha256: crypto.createHash("sha256").update(sql).digest("hex"),
      };
    });
}

export async function migratePostgres(pool, options = {}) {
  if (typeof pool?.connect !== "function") throw new TypeError("PostgreSQL pool must implement connect().");
  const migrations = discoverMigrations(options);
  if (!migrations.length) throw new Error("No PostgreSQL migrations were found.");
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS isaf_schema_migrations (
        migration_id text PRIMARY KEY,
        sha256 char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const appliedResult = await client.query(
      "SELECT migration_id, sha256 FROM isaf_schema_migrations ORDER BY migration_id",
    );
    const applied = new Map(appliedResult.rows.map(row => [row.migration_id, row.sha256]));
    const completed = [];
    for (const migration of migrations) {
      if (applied.has(migration.id)) {
        if (applied.get(migration.id) !== migration.sha256) {
          throw new Error(`Applied migration ${migration.id} has changed; restore the qualified migration file.`);
        }
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO isaf_schema_migrations (migration_id, sha256) VALUES ($1, $2)",
          [migration.id, migration.sha256],
        );
        await client.query("COMMIT");
        completed.push(migration.id);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return {available: migrations.map(item => item.id), applied: completed};
  } finally {
    client.release();
  }
}

export class PostgresMetadataStore {
  constructor(pool) {
    if (typeof pool?.connect !== "function" || typeof pool?.query !== "function") {
      throw new TypeError("PostgreSQL pool must implement connect() and query().");
    }
    this.pool = pool;
  }

  async health() {
    const result = await this.pool.query("SELECT 1 AS ready");
    return result.rows?.[0]?.ready === 1;
  }

  async withTenant(organizationId, work) {
    requireUuid(organizationId, "Organization ID");
    if (typeof work !== "function") throw new TypeError("Tenant transaction requires a callback.");
    const client = await this.pool.connect();
    await client.query("BEGIN");
    try {
      await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listPrograms(organizationId) {
    return this.withTenant(organizationId, async client => {
      const result = await client.query(
        `SELECT id, name, company, document_prefix AS prefix,
                document_control_enabled AS "underDocumentControl",
                revision, created_at AS "createdAt", updated_at AS "updatedAt"
           FROM programs
          WHERE organization_id = $1 AND status = 'active'
          ORDER BY updated_at DESC, name`,
        [organizationId],
      );
      return result.rows;
    });
  }

  async readProgram(organizationId, programId, {forUpdate = false} = {}) {
    requireUuid(programId, "Program ID");
    return this.withTenant(organizationId, async client => {
      const result = await client.query(
        `SELECT id, organization_id AS "organizationId", name, company,
                document_prefix AS prefix, status,
                document_control_enabled AS "underDocumentControl",
                revision, created_at AS "createdAt", updated_at AS "updatedAt"
           FROM programs
          WHERE organization_id = $1 AND id = $2${forUpdate ? " FOR UPDATE" : ""}`,
        [organizationId, programId],
      );
      return result.rows[0] || null;
    });
  }

  async createProgram(organizationId, {name, company, prefix, createdBy = null}) {
    if (!String(name || "").trim()) throw new PostgresConfigurationError("Program name is required.");
    if (!String(company || "").trim()) throw new PostgresConfigurationError("Company is required.");
    if (createdBy !== null) requireUuid(createdBy, "Created-by user ID");
    return this.withTenant(organizationId, async client => {
      const result = await client.query(
        `INSERT INTO programs (organization_id, name, company, document_prefix, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, organization_id AS "organizationId", name, company,
                   document_prefix AS prefix,
                   document_control_enabled AS "underDocumentControl",
                   revision, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [organizationId, String(name).trim(), String(company).trim(), String(prefix).trim(), createdBy],
      );
      return result.rows[0];
    });
  }
}
