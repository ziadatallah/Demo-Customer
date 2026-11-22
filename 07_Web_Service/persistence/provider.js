import path from "node:path";
import {RepositoryStore} from "../repository_store.js";
import {FileObjectStore} from "./object_store.js";

export const REPOSITORY_CONTRACT = Object.freeze([
  "list", "read", "public", "create", "ensure", "saveConfiguration", "roadmap",
  "import", "updateDocument", "link", "checkout", "cancelCheckout", "recoverCheckout",
  "checkinPlan", "checkin", "release", "candidate", "control", "baseline", "adoptBuild",
  "blob", "bytes", "doc", "version", "addRecord", "records", "record",
]);

// Methods that may perform filesystem, database, or object-storage I/O.
// Callers must await these methods even though the current filesystem provider
// can complete some of them synchronously. public(), doc(), and version() are
// pure helpers over an already loaded program record.
export const REPOSITORY_ASYNC_METHODS = Object.freeze(
  REPOSITORY_CONTRACT.filter(method => !["public", "doc", "version"].includes(method)),
);

export function assertRepositoryContract(store) {
  const missing = REPOSITORY_CONTRACT.filter(method => typeof store?.[method] !== "function");
  if (missing.length) throw new TypeError(`Repository provider is missing: ${missing.join(", ")}.`);
  return store;
}

export function createRepositoryProvider({
  root,
  demoEdition = false,
  backend = process.env.ISAF_REPOSITORY_BACKEND || "filesystem",
  objectStore,
} = {}) {
  const selected = String(backend).trim().toLowerCase();
  if (!["filesystem", "local"].includes(selected)) {
    throw new Error(
      `Repository backend "${selected}" is not enabled in this release. ` +
      "Use ISAF_REPOSITORY_BACKEND=filesystem until the PostgreSQL migration gate is complete.",
    );
  }
  if (!root) throw new TypeError("Repository root is required.");
  const blobs = objectStore || new FileObjectStore(path.join(root, "blobs"));
  return assertRepositoryContract(new RepositoryStore(root, {demoEdition, objectStore: blobs}));
}

export async function createRepositoryProviderAsync({
  root,
  demoEdition = false,
  backend = process.env.ISAF_REPOSITORY_BACKEND || "filesystem",
  objectStore,
  env = process.env,
  pool,
  qualification,
} = {}) {
  const selected = String(backend).trim().toLowerCase();
  if (["filesystem", "local"].includes(selected)) {
    return createRepositoryProvider({root, demoEdition, backend: selected, objectStore});
  }
  if (!["postgres", "postgresql"].includes(selected)) {
    throw new Error(`Unknown repository backend "${selected}".`);
  }
  if (String(env.ISAF_STORAGE_QUALIFIED || "").toLowerCase() !== "true") {
    throw new Error("PostgreSQL/cloud storage is disabled until ISAF_STORAGE_QUALIFIED=true and a matching qualification result is supplied.");
  }
  const [{readStorageQualification}, {createPostgresPool}, {PostgresRepositoryStore}, {createS3ObjectStoreFromEnv}] = await Promise.all([
    import("./live_qualification.js"), import("./postgres.js"), import("./postgres_repository.js"), import("./s3_object_store.js"),
  ]);
  const gate = qualification || readStorageQualification(env.ISAF_STORAGE_QUALIFICATION_FILE, env);
  if (gate.status !== "passed") throw new Error("The live storage qualification did not pass.");
  const database = pool || await createPostgresPool({connectionString: env.ISAF_DATABASE_URL, ssl: env.ISAF_DATABASE_SSL === "require"});
  const blobs = objectStore || createS3ObjectStoreFromEnv(env);
  return assertRepositoryContract(new PostgresRepositoryStore({
    pool: database,
    organizationId: env.ISAF_ORGANIZATION_ID,
    objectStore: blobs,
    demoEdition,
  }));
}
