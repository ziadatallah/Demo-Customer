import path from "node:path";
import {createPostgresPool} from "./postgres.js";
import {PostgresRepositoryStore} from "./postgres_repository.js";
import {createS3ObjectStoreFromEnv} from "./s3_object_store.js";
import {migrateFilesystemRepository, restoreRollbackCopy} from "./repository_migration.js";

const args = process.argv.slice(2);
const value = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : ""; };
const sourceRoot = value("--source");
const workDir = value("--work-dir") || path.resolve("repository-migration");
const execute = args.includes("--execute");
const restore = args.includes("--restore-backup");

if (restore) {
  const recovered = value("--recovered-dir");
  const digest = value("--manifest-sha256");
  if (!recovered || !digest) throw new Error("Rollback restore requires --recovered-dir and --manifest-sha256.");
  const result = restoreRollbackCopy(path.join(workDir, "rollback-repository"), recovered, digest);
  console.log(`Verified rollback repository restored to ${result.recoveredRoot}`);
} else {
  if (!sourceRoot) throw new Error("Repository migration requires --source.");
  if (!execute) {
    const result = await migrateFilesystemRepository({
      sourceRoot, workDir, dryRun: true,
      destination: {objectStore: {put() {}}, restoreProgramState() {}},
    });
    console.log(`Dry run complete. Manifest: ${result.manifestFile}`);
    console.log(JSON.stringify(result.manifest.totals));
  } else {
    const pool = await createPostgresPool();
    try {
      const destination = new PostgresRepositoryStore({
        pool, organizationId: process.env.ISAF_ORGANIZATION_ID,
        objectStore: createS3ObjectStoreFromEnv(),
      });
      const result = await migrateFilesystemRepository({sourceRoot, destination, workDir});
      console.log(`Migration complete. Progress: ${result.resumeFile}`);
      console.log(`Verified rollback copy: ${result.backupRoot}`);
    } finally { await pool.end(); }
  }
}
