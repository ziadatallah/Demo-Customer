import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {sha256} from "./object_store.js";

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const copy = value => structuredClone(value);
const stateDigest = state => sha256(Buffer.from(JSON.stringify(state)));

export class RepositoryMigrationError extends Error {
  constructor(message) { super(message); this.name = "RepositoryMigrationError"; }
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), {mode: 0o600});
  fs.renameSync(temp, file);
}

function referencedHashes(program) {
  const result = new Map();
  const add = (record, reference) => {
    if (!record?.hash) return;
    if (!HASH.test(record.hash)) throw new RepositoryMigrationError(`${reference} has an invalid object hash.`);
    const refs = result.get(record.hash) || [];
    refs.push(reference);
    result.set(record.hash, refs);
  };
  add(program.configuration, `${program.id}:configuration`);
  for (const document of program.documents || []) {
    for (const version of document.versions || []) add(version, `${program.id}:document:${document.id}:version:${version.id}`);
  }
  for (const build of program.builds || []) add(build.workbook, `${program.id}:build:${build.id}:workbook`);
  for (const snapshot of program.packageSnapshots || []) {
    add(snapshot.workbook, `${program.id}:package:${snapshot.id}:workbook`);
    for (const entry of snapshot.entries || []) add(entry, `${program.id}:package:${snapshot.id}:entry`);
  }
  return result;
}

export function inspectFilesystemRepository(sourceRoot) {
  const root = path.resolve(sourceRoot);
  const programsRoot = path.join(root, "programs");
  const blobsRoot = path.join(root, "blobs");
  if (!fs.existsSync(programsRoot) || !fs.statSync(programsRoot).isDirectory()) {
    throw new RepositoryMigrationError("The source repository does not contain a programs folder.");
  }
  if (!fs.existsSync(blobsRoot) || !fs.statSync(blobsRoot).isDirectory()) {
    throw new RepositoryMigrationError("The source repository does not contain a blobs folder.");
  }
  const references = new Map();
  const programs = [];
  for (const id of fs.readdirSync(programsRoot).sort()) {
    if (!UUID.test(id)) continue;
    const file = path.join(programsRoot, id, "program.json");
    if (!fs.existsSync(file)) throw new RepositoryMigrationError(`Program ${id} is missing program.json.`);
    let state;
    try { state = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { throw new RepositoryMigrationError(`Program ${id} contains invalid JSON.`); }
    if (state.id !== id) throw new RepositoryMigrationError(`Program folder ${id} does not match its stored ID.`);
    for (const key of ["documents", "builds", "baselines", "events"]) {
      if (!Array.isArray(state[key])) throw new RepositoryMigrationError(`Program ${id} has invalid ${key} data.`);
    }
    for (const [hash, refs] of referencedHashes(state)) {
      references.set(hash, [...(references.get(hash) || []), ...refs]);
    }
    programs.push({id, name: state.name, company: state.company, prefix: state.prefix,
      revision: Number(state.revision || 0), documentCount: state.documents.length,
      stateSha256: stateDigest(state), state});
  }
  const objects = [];
  for (const name of fs.readdirSync(blobsRoot).sort()) {
    if (!HASH.test(name)) continue;
    const file = path.join(blobsRoot, name);
    if (!fs.statSync(file).isFile()) continue;
    const bytes = fs.readFileSync(file);
    if (sha256(bytes) !== name) throw new RepositoryMigrationError(`Object ${name} failed its SHA-256 integrity check.`);
    objects.push({hash: name, size: bytes.length, references: references.get(name) || [], orphan: !references.has(name)});
  }
  const available = new Set(objects.map(item => item.hash));
  for (const [hash, refs] of references) {
    if (!available.has(hash)) throw new RepositoryMigrationError(`Referenced object ${hash} is missing (${refs[0]}).`);
  }
  const manifestCore = {
    format: "ISAF repository migration manifest v1",
    programs: programs.map(({state, ...summary}) => summary),
    objects,
  };
  return {
    root,
    programs,
    manifest: {...manifestCore, manifestSha256: stateDigest(manifestCore),
      totals: {programs: programs.length, documents: programs.reduce((n, item) => n + item.documentCount, 0),
        objects: objects.length, bytes: objects.reduce((n, item) => n + item.size, 0)}},
  };
}

export function createRollbackCopy(sourceRoot, backupRoot, expectedManifestSha256 = null) {
  const source = inspectFilesystemRepository(sourceRoot);
  if (expectedManifestSha256 && source.manifest.manifestSha256 !== expectedManifestSha256) {
    throw new RepositoryMigrationError("The source repository changed after the migration plan was created.");
  }
  const backup = path.resolve(backupRoot);
  if (fs.existsSync(backup)) throw new RepositoryMigrationError("The rollback-copy folder already exists.");
  fs.cpSync(source.root, backup, {recursive: true, errorOnExist: true, preserveTimestamps: true});
  const verified = inspectFilesystemRepository(backup);
  if (verified.manifest.manifestSha256 !== source.manifest.manifestSha256) {
    throw new RepositoryMigrationError("The rollback copy did not match the source repository.");
  }
  return {backupRoot: backup, manifestSha256: verified.manifest.manifestSha256};
}

export function restoreRollbackCopy(backupRoot, recoveredRoot, expectedManifestSha256) {
  const backup = inspectFilesystemRepository(backupRoot);
  if (backup.manifest.manifestSha256 !== expectedManifestSha256) {
    throw new RepositoryMigrationError("The rollback copy no longer matches the migration manifest.");
  }
  const recovered = path.resolve(recoveredRoot);
  if (fs.existsSync(recovered)) throw new RepositoryMigrationError("The recovery destination already exists.");
  fs.cpSync(backup.root, recovered, {recursive: true, errorOnExist: true, preserveTimestamps: true});
  const verified = inspectFilesystemRepository(recovered);
  if (verified.manifest.manifestSha256 !== expectedManifestSha256) {
    throw new RepositoryMigrationError("The recovered repository failed verification.");
  }
  return {recoveredRoot: recovered, manifestSha256: expectedManifestSha256};
}

export async function migrateFilesystemRepository({sourceRoot, destination, workDir, dryRun = false} = {}) {
  if (!destination?.objectStore?.put || typeof destination.restoreProgramState !== "function") {
    throw new RepositoryMigrationError("The migration destination is incomplete.");
  }
  const inspected = inspectFilesystemRepository(sourceRoot);
  const folder = path.resolve(workDir);
  fs.mkdirSync(folder, {recursive: true});
  const manifestFile = path.join(folder, "migration-manifest.json");
  atomicJson(manifestFile, inspected.manifest);
  if (dryRun) return {dryRun: true, manifestFile, manifest: inspected.manifest};

  const backupRoot = path.join(folder, "rollback-repository");
  if (!fs.existsSync(backupRoot)) createRollbackCopy(inspected.root, backupRoot, inspected.manifest.manifestSha256);
  else if (inspectFilesystemRepository(backupRoot).manifest.manifestSha256 !== inspected.manifest.manifestSha256) {
    throw new RepositoryMigrationError("The existing rollback copy does not match this migration.");
  }
  const resumeFile = path.join(folder, "migration-progress.json");
  let progress = {manifestSha256: inspected.manifest.manifestSha256, objects: [], programs: [], complete: false};
  if (fs.existsSync(resumeFile)) progress = JSON.parse(fs.readFileSync(resumeFile, "utf8"));
  if (progress.manifestSha256 !== inspected.manifest.manifestSha256) {
    throw new RepositoryMigrationError("The resumable migration state belongs to a different source manifest.");
  }
  const completedObjects = new Set(progress.objects);
  const completedPrograms = new Set(progress.programs);
  for (const object of inspected.manifest.objects) {
    if (completedObjects.has(object.hash)) continue;
    const bytes = fs.readFileSync(path.join(inspected.root, "blobs", object.hash));
    const stored = await destination.objectStore.put(bytes);
    if (stored.hash !== object.hash || Number(stored.size) !== object.size) {
      throw new RepositoryMigrationError(`Destination verification failed for object ${object.hash}.`);
    }
    completedObjects.add(object.hash);
    progress.objects = [...completedObjects].sort();
    atomicJson(resumeFile, progress);
  }
  for (const program of inspected.programs) {
    if (completedPrograms.has(program.id)) continue;
    await destination.restoreProgramState(copy(program.state));
    const restored = await destination.read(program.id);
    if (stateDigest(restored) !== program.stateSha256) {
      throw new RepositoryMigrationError(`Destination verification failed for program ${program.id}.`);
    }
    completedPrograms.add(program.id);
    progress.programs = [...completedPrograms].sort();
    atomicJson(resumeFile, progress);
  }
  progress.complete = true;
  progress.completedAt = new Date().toISOString();
  atomicJson(resumeFile, progress);
  return {dryRun: false, manifestFile, resumeFile, backupRoot, manifest: inspected.manifest, progress};
}
