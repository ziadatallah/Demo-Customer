import crypto from "node:crypto";
import path from "node:path";
import {createPostgresPool, migratePostgres, PostgresMetadataStore} from "./postgres.js";
import {PostgresRepositoryStore} from "./postgres_repository.js";
import {createS3ObjectStoreFromEnv} from "./s3_object_store.js";
import {writeStorageQualification} from "./live_qualification.js";

const env = process.env;
const output = env.ISAF_STORAGE_QUALIFICATION_FILE || path.resolve("live-storage-qualification.json");
const pool = await createPostgresPool();
const checks = [];
let program;
try {
  const migrations = await migratePostgres(pool);
  checks.push({name: "database migrations", status: "passed", applied: migrations.applied});
  const metadata = new PostgresMetadataStore(pool);
  if (!await metadata.health()) throw new Error("PostgreSQL health check failed.");
  checks.push({name: "database health", status: "passed"});

  const objectStore = createS3ObjectStoreFromEnv(env);
  const marker = crypto.randomUUID();
  const objectBytes = Buffer.from(`ISAF live storage qualification ${marker}`);
  const stored = await objectStore.put(objectBytes);
  if (!(await objectStore.get(stored.hash)).equals(objectBytes)) throw new Error("Cloud object round trip did not preserve bytes.");
  checks.push({name: "object storage round trip", status: "passed", sha256: stored.hash});

  const repository = new PostgresRepositoryStore({
    pool, organizationId: env.ISAF_ORGANIZATION_ID, objectStore,
  });
  const name = `ISAF Storage Qualification ${marker}`;
  program = await repository.create({name, company: "ISAF Qualification", prefix: "QUAL"}, "ISAF qualification runner");
  await repository.saveConfiguration(program.id, {
    data: {program: {name, customer_name: "ISAF Qualification", doc_prefix: "QUAL"}},
    filename: "qualification.xlsx", actor: "ISAF qualification runner",
  }, Buffer.from(`qualification-config-${marker}`));
  const document = await repository.import(program.id, {
    pn: "QUAL-001", title: "Storage Qualification Record", filename: "qualification.txt",
  }, Buffer.from("initial qualification document"), "ISAF qualification runner");
  const checkout = await repository.checkout(program.id, document.id, "ISAF qualification runner", document.head);
  const draft = await repository.checkin(program.id, document.id, {
    token: checkout.token, actor: "ISAF qualification runner", filename: "qualification.txt", comment: "Qualified update",
  }, Buffer.from("qualified cloud document"));
  await repository.updateDocument(program.id, document.id, {workflow: "Ready for release"}, "ISAF qualification runner");
  const release = await repository.release(program.id, document.id, {
    actor: "ISAF qualification runner", comment: "Qualified release", expectedVersion: draft.id,
  });
  await repository.control(program.id, {enabled: true, actor: "ISAF qualification runner", confirm: true, reason: "Qualification"});
  await repository.baseline(program.id, {
    name: `QUAL-${marker.slice(0, 8)}`, actor: "ISAF qualification runner", comment: "Qualified baseline",
    entries: [{documentId: document.id, versionId: release.id}],
  });
  if ((await repository.bytes(release.hash)).toString() !== "qualified cloud document") throw new Error("Repository byte verification failed.");
  const loaded = await repository.read(program.id);
  if (loaded.baselines.length !== 1 || loaded.documents[0].released !== release.id) throw new Error("Repository lifecycle verification failed.");
  checks.push({name: "repository lifecycle", status: "passed", programId: program.id});
  await repository.archiveQualificationProgram(program.id, name);
  checks.push({name: "qualification record archived", status: "passed"});
  writeStorageQualification(output, {status: "passed", checks}, env);
  console.log(`Live PostgreSQL and cloud-storage qualification passed.\nQualification result: ${output}`);
} catch (error) {
  console.error(`Live storage qualification failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
