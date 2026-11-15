#!/usr/bin/env node
import {createPostgresPool, migratePostgres} from "./postgres.js";

let pool;
try {
  pool = await createPostgresPool();
  const result = await migratePostgres(pool);
  if (result.applied.length) {
    console.log(`Applied PostgreSQL migrations: ${result.applied.join(", ")}`);
  } else {
    console.log(`PostgreSQL schema is current (${result.available.length} migration(s)).`);
  }
} catch (error) {
  console.error(`PostgreSQL migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
}
