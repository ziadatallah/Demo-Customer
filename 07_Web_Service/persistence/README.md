# ISAF persistence foundation

`schema.sql` is the P1 PostgreSQL metadata model. The qualified filesystem behavior remains the default. PostgreSQL and cloud object storage activate only after the exact live service configuration passes the qualification gate described below.

The first P1.2 increment is implemented:

- `provider.js` defines and validates the repository contract used by the web service;
- `object_store.js` provides content-addressed local object storage with SHA-256 verification;
- the existing repository uses that object-store interface without changing its public behavior; and
- selecting an unfinished backend fails closed instead of silently using the wrong storage.

`ISAF_REPOSITORY_BACKEND=filesystem` remains the default backend.

## PostgreSQL foundation

The v5 development tree now contains the first P1.2b database increment:

- `postgres.js` creates the connection pool only when PostgreSQL is explicitly requested;
- every tenant operation opens a transaction and sets `app.organization_id` locally before querying tenant-owned tables;
- `migrations/*.sql` are applied in filename order and recorded with SHA-256 checksums;
- a previously applied migration cannot be silently edited; and
- connection, migration, rollback, tenant-context, and initial program-operation behavior is covered by regression tests.

After installing the v5 web-service dependencies and setting `ISAF_DATABASE_URL`, a database administrator can apply the schema explicitly:

```sh
cd 07_Web_Service
npm run db:migrate
```

Set `ISAF_DATABASE_SSL=require` for a database endpoint that requires verified TLS. The migration command is never run automatically by application startup.

The complete PostgreSQL repository adapter and asynchronous web routes are implemented. Activation still requires a matching live qualification result.

## Asynchronous repository callers

P1.2c converts the repository HTTP routes and repository-build orchestration to await every operation that may perform filesystem, database, or object-storage I/O. The current filesystem provider continues to work because JavaScript can await immediate values. A future PostgreSQL provider can return promises without changing the route behavior.

`REPOSITORY_ASYNC_METHODS` identifies the contract methods callers must await. `public()`, `doc()`, and `version()` remain pure helpers over an already loaded program record. The filesystem transaction helper supports both immediate and asynchronous callbacks and retains its update lock through commit or rollback.

## PostgreSQL repository adapter

P1.2d adds a tenant-scoped PostgreSQL repository adapter that runs the same document-control rules as the filesystem provider. Program state is locked with `SELECT ... FOR UPDATE`, updated atomically, and protected by an optimistic revision check. Immutable document bytes continue to use the configured content-addressed object store. The adapter covers configurations, documents, versions, checkout and recovery, release, candidate review, baselines, controlled builds, roadmap data, and chained audit events.

PostgreSQL activation remains blocked until the configured live PostgreSQL and object-storage services pass qualification.

## S3-compatible object storage

`s3_object_store.js` provides content-addressed immutable storage for AWS S3 and compatible customer-hosted services. It signs requests with AWS Signature Version 4, verifies SHA-256 on download, uses object metadata to verify deduplicated writes, retries temporary service failures, and fails immediately on permission errors. Credentials are read from environment or secret-manager injection and are never included in stored metadata or error messages.

Required settings are `ISAF_S3_ENDPOINT`, `ISAF_S3_BUCKET`, `ISAF_S3_ACCESS_KEY_ID`, and `ISAF_S3_SECRET_ACCESS_KEY`. Optional settings are `ISAF_S3_REGION`, `ISAF_S3_SESSION_TOKEN`, and `ISAF_S3_PREFIX`.

Repository mutations now await object writes and reads before committing metadata. A failed upload therefore rolls back the PostgreSQL transaction instead of leaving a version that refers to missing content. Releases and baselines verify referenced cloud objects before their metadata is committed.

## Repository migration and rollback

`npm run repo:migrate -- --source <repository> --work-dir <migration-folder>` performs a read-only dry run. It verifies every program, every referenced object, and every stored-object SHA-256 before writing a migration manifest.

Adding `--execute` creates and verifies a complete rollback copy before transferring content. Progress is recorded after every object and program so an interrupted migration resumes without duplicating completed work. The source repository is never modified. A verified local recovery copy can be created from the rollback snapshot with `--restore-backup`, `--recovered-dir`, and the manifest SHA-256 recorded by the dry run.

The production persistence design separates:

- PostgreSQL metadata and workflow state;
- immutable file content in S3-compatible or customer-approved object storage; and
- credentials in a secret manager, referenced by `integrations.secret_ref`.

Each database transaction must set the tenant context before accessing a tenant-owned table:

```sql
BEGIN;
SET LOCAL app.organization_id = '00000000-0000-0000-0000-000000000000';
-- tenant-scoped statements
COMMIT;
```

The application must also authorize the authenticated user's organization membership and role. Row-level security is a second enforcement boundary, not a substitute for application authorization.

## Live-service qualification and activation

Set the database, organization, and S3-compatible storage environment settings, then choose a protected output path in `ISAF_STORAGE_QUALIFICATION_FILE`. Run:

```sh
cd 07_Web_Service
npm run storage:qualify
```

The runner applies checksum-protected migrations, checks database health, verifies a cloud-object write/read round trip, and exercises configuration storage, import, checkout, check-in, release, document control, baseline, and byte retrieval. Its qualification program is archived as audit evidence. The output contains service identities and a SHA-256 fingerprint but no passwords or access keys.

To activate the qualified services, keep the same settings and add:

```text
ISAF_REPOSITORY_BACKEND=postgresql
ISAF_STORAGE_QUALIFIED=true
ISAF_STORAGE_QUALIFICATION_FILE=/protected/path/live-storage-qualification.json
```

Startup fails if the result is absent, failed, malformed, or belongs to a different database host/database name, organization, storage endpoint, bucket, region, or prefix. Changing any of those settings requires a new qualification. Credentials can rotate without invalidating the service-identity fingerprint.

## Authenticated identity foundation

The default `ISAF_AUTH_MODE=api-key` preserves the existing local and hosted-edition behavior. Setting `ISAF_AUTH_MODE=oidc` enables signed RS256 bearer-token verification using `ISAF_OIDC_ISSUER`, `ISAF_OIDC_AUDIENCE`, and `ISAF_OIDC_JWKS_URL`. OIDC mode requires the PostgreSQL provider and `ISAF_ORGANIZATION_ID`.

After token signature and standard issuer, audience, expiry, activation, and subject checks pass, ISAF resolves the subject against an active database user and organization membership. The verified identity and role are attached to the request. Users without an active membership are denied.

Repository and application routes enforce Organization Admin, Program Manager, Contributor, Reviewer, Approver, Read-only, and service-account permissions. Authenticated identity replaces any actor name supplied by an OIDC request, so repository history cannot be attributed to an arbitrary form value. Hosted users cannot invoke local file and folder pickers. Authorization audit events are the remaining P1.3 control before production activation.
