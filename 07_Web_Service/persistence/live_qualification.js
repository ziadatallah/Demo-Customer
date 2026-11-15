import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function required(value, name) {
  const result = String(value || "").trim();
  if (!result) throw new Error(`${name} is required.`);
  return result;
}

function databaseIdentity(connectionString) {
  const value = required(connectionString, "ISAF_DATABASE_URL");
  const parsed = new URL(value);
  return {protocol: parsed.protocol, host: parsed.hostname, port: parsed.port || "5432", database: parsed.pathname.replace(/^\//, "")};
}

export function storageIdentity(env = process.env) {
  const endpoint = new URL(required(env.ISAF_S3_ENDPOINT, "ISAF_S3_ENDPOINT"));
  return {
    database: databaseIdentity(env.ISAF_DATABASE_URL),
    organizationId: required(env.ISAF_ORGANIZATION_ID, "ISAF_ORGANIZATION_ID"),
    objectStorage: {
      endpoint: endpoint.origin + endpoint.pathname.replace(/\/$/, ""),
      bucket: required(env.ISAF_S3_BUCKET, "ISAF_S3_BUCKET"),
      region: String(env.ISAF_S3_REGION || "us-east-1"),
      prefix: String(env.ISAF_S3_PREFIX || "isaf/objects"),
    },
  };
}

export function storageFingerprint(env = process.env) {
  return crypto.createHash("sha256").update(JSON.stringify(storageIdentity(env))).digest("hex");
}

export function writeStorageQualification(filename, result, env = process.env) {
  const target = path.resolve(required(filename, "Qualification output file"));
  const record = {
    schemaVersion: 1,
    status: result.status,
    passedAt: result.status === "passed" ? new Date().toISOString() : null,
    fingerprint: storageFingerprint(env),
    identity: storageIdentity(env),
    checks: result.checks || [],
  };
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, {mode: 0o600});
  return record;
}

export function readStorageQualification(filename, env = process.env) {
  const target = path.resolve(required(filename, "ISAF_STORAGE_QUALIFICATION_FILE"));
  let record;
  try { record = JSON.parse(fs.readFileSync(target, "utf8")); }
  catch (error) { throw new Error(`Could not read the live storage qualification result: ${error.message}`); }
  if (record.schemaVersion !== 1 || record.status !== "passed") throw new Error("The live storage qualification result is not a passing v1 record.");
  if (record.fingerprint !== storageFingerprint(env)) {
    throw new Error("The live storage qualification belongs to different database, bucket, prefix, or organization settings.");
  }
  return record;
}
