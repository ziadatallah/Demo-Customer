import crypto from "node:crypto";
import {RepositoryStore, RepositoryError} from "../repository_store.js";
import {PostgresMetadataStore, requireUuid} from "./postgres.js";
import {assertObjectStore} from "./object_store.js";

const clone = value => structuredClone(value);
const actorName = actor => {
  const value = String(actor || "").trim().slice(0, 500);
  if (!value) throw new RepositoryError("Your name is required.", 400);
  return value;
};

function stateValue(row) {
  const value = row?.repositoryState ?? row?.repository_state;
  if (!value) return null;
  return typeof value === "string" ? JSON.parse(value) : clone(value);
}

export class PostgresRepositoryStore {
  constructor({pool, organizationId, objectStore, demoEdition = false, metadataStore} = {}) {
    this.organizationId = requireUuid(organizationId, "Organization ID");
    this.metadata = metadataStore || new PostgresMetadataStore(pool);
    this.objectStore = assertObjectStore(objectStore);
    this.demoEdition = demoEdition === true;
  }

  async list() {
    return this.metadata.withTenant(this.organizationId, async client => {
      const result = await client.query(
        `SELECT repository_state AS "repositoryState"
           FROM programs
          WHERE organization_id = $1 AND status = 'active'
          ORDER BY updated_at DESC, name`,
        [this.organizationId],
      );
      return result.rows.map(row => stateValue(row)).filter(Boolean).map(program => ({
        id: program.id,
        name: program.name,
        company: program.company,
        prefix: program.prefix,
        underDocumentControl: program.underDocumentControl,
        documentCount: program.documents.length,
        updatedAt: program.updatedAt,
      }));
    });
  }

  async read(programId) {
    requireUuid(programId, "Program ID");
    return this.metadata.withTenant(this.organizationId, async client => {
      const result = await client.query(
        `SELECT repository_state AS "repositoryState"
           FROM programs
          WHERE organization_id = $1 AND id = $2 AND status = 'active'`,
        [this.organizationId, programId],
      );
      const program = stateValue(result.rows[0]);
      if (!program) throw new RepositoryError("Program not found.", 404);
      return program;
    });
  }

  async create({name, company, prefix}, actor) {
    name = String(name || "").trim();
    company = String(company || "").trim();
    prefix = String(prefix || "").trim();
    if (!name) throw new RepositoryError("Program name is required.", 400);
    if (!company) throw new RepositoryError("Company is required.", 400);
    const timestamp = new Date().toISOString();
    const program = {
      id: crypto.randomUUID(), name, company, prefix, revision: 0,
      createdAt: timestamp, updatedAt: timestamp,
      underDocumentControl: false, everControlled: false,
      documents: [], builds: [], baselines: [], events: [],
    };
    this.audit(program, "program-created", actorName(actor), {name});
    await this.metadata.withTenant(this.organizationId, client => client.query(
      `INSERT INTO programs
         (id, organization_id, name, company, document_prefix,
          document_control_enabled, revision, repository_state)
       VALUES ($1, $2, $3, $4, $5, false, 0, $6::jsonb)`,
      [program.id, this.organizationId, name, company, prefix, JSON.stringify(program)],
    ));
    return this.public(program);
  }

  async ensure(identity, actor, programId) {
    if (programId) {
      const program = await this.read(programId);
      if (program.name !== identity.name || program.company !== identity.company || program.prefix !== identity.prefix) {
        throw new RepositoryError(
          "The workbook identity differs from the selected repository program. Select the matching program or create a new one.",
          422,
        );
      }
      return program;
    }
    const matches = (await this.list()).filter(program =>
      program.name === identity.name && program.company === identity.company && program.prefix === identity.prefix,
    );
    if (matches.length > 1) throw new RepositoryError("Select the intended repository program before building.");
    return matches.length ? this.read(matches[0].id) : this.create(identity, actor);
  }

  async restoreProgramState(input) {
    const program = clone(input);
    requireUuid(program?.id, "Program ID");
    if (!String(program.name || "").trim() || !String(program.company || "").trim() || !String(program.prefix || "").trim()) {
      throw new RepositoryError("Migrated program identity is incomplete.", 400);
    }
    for (const key of ["documents", "builds", "baselines", "events"]) {
      if (!Array.isArray(program[key])) throw new RepositoryError(`Migrated program ${key} must be a list.`, 400);
    }
    return this.metadata.withTenant(this.organizationId, async client => {
      const existing = await client.query(
        `SELECT repository_state AS "repositoryState"
           FROM programs
          WHERE organization_id = $1 AND id = $2`,
        [this.organizationId, program.id],
      );
      const prior = stateValue(existing.rows[0]);
      if (prior) {
        if (JSON.stringify(prior) !== JSON.stringify(program)) {
          throw new RepositoryError("The destination already contains a different program with this ID.");
        }
        return {program: this.public(prior), reused: true};
      }
      await client.query(
        `INSERT INTO programs
           (id, organization_id, name, company, document_prefix,
            document_control_enabled, revision, repository_state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
        [program.id, this.organizationId, program.name, program.company, program.prefix,
          program.underDocumentControl === true, Number(program.revision || 0), JSON.stringify(program),
          program.createdAt || new Date().toISOString(), program.updatedAt || new Date().toISOString()],
      );
      return {program: this.public(program), reused: false};
    });
  }

  async archiveQualificationProgram(programId, expectedName) {
    requireUuid(programId, "Program ID");
    if (!String(expectedName || "").startsWith("ISAF Storage Qualification ")) {
      throw new RepositoryError("Qualification archive requires the generated qualification program name.", 400);
    }
    return this.metadata.withTenant(this.organizationId, async client => {
      const result = await client.query(
        `UPDATE programs
            SET status = 'archived', updated_at = now()
          WHERE organization_id = $1 AND id = $2
            AND name = $3 AND status = 'active'`,
        [this.organizationId, programId, expectedName],
      );
      if (result.rowCount !== 1) throw new RepositoryError("Qualification program could not be archived.");
      return true;
    });
  }

  async transaction(programId, work) {
    requireUuid(programId, "Program ID");
    if (typeof work !== "function") throw new TypeError("Repository transaction requires a callback.");
    return this.metadata.withTenant(this.organizationId, async client => {
      const selected = await client.query(
        `SELECT repository_state AS "repositoryState", revision
           FROM programs
          WHERE organization_id = $1 AND id = $2 AND status = 'active'
          FOR UPDATE`,
        [this.organizationId, programId],
      );
      const program = stateValue(selected.rows[0]);
      if (!program) throw new RepositoryError("Program not found.", 404);
      const result = await work(program);
      program.revision = Number(program.revision || 0) + 1;
      program.updatedAt = new Date().toISOString();
      const updated = await client.query(
        `UPDATE programs
            SET repository_state = $3::jsonb,
                document_control_enabled = $4,
                revision = revision + 1,
                updated_at = now()
          WHERE organization_id = $1 AND id = $2 AND revision = $5
          RETURNING revision`,
        [this.organizationId, programId, JSON.stringify(program), program.underDocumentControl === true,
          Number(selected.rows[0].revision || 0)],
      );
      if (updated.rowCount !== 1) throw new RepositoryError("The program changed. Refresh and retry.");
      return result;
    });
  }

  async checkinPlan(programId, docId, options) {
    const program = await this.read(programId);
    const view = Object.create(this);
    view.read = () => program;
    return RepositoryStore.prototype.checkinPlan.call(view, programId, docId, options);
  }

  async roadmap(programId) {
    const program = await this.read(programId);
    const view = Object.create(this);
    view.read = () => program;
    return RepositoryStore.prototype.roadmap.call(view, programId);
  }
}

for (const method of [
  "public", "audit", "blob", "bytes", "doc", "version", "addVersion", "newDoc",
  "import", "updateDocument", "checkout", "verifyCheckout", "cancelCheckout", "recoverCheckout",
  "checkin", "release", "candidate", "control", "baseline", "adoptBuild", "link", "saveConfiguration",
  "addRecord", "records", "record",
]) {
  Object.defineProperty(PostgresRepositoryStore.prototype, method, {
    value: RepositoryStore.prototype[method], writable: true, configurable: true,
  });
}
