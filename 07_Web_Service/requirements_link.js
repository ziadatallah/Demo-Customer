// Requirements link: the reviewed requirements a program builds with.
//
// Before v5.3.38 an import ended in the browser. A build produced documents without the imported
// requirements, and the owner then had to hand those documents back to "Update documents" to have
// them written in. That round trip did not survive a rebuild, so the imported requirements were
// never in a generated document unless somebody repeated the step by hand.
//
// A link is the reviewed import held with the program, so every build writes it in. It holds the
// review exactly as the Import tab produced it, because the document writer (requirements_docs.js)
// and the review engine (requirements_review.js) both read that shape.
//
// The link is stored with the program in the repository, which is where a hosted customer's own
// register lives. A hosted trial has no program of its own (a throwaway register per build), so
// there the browser sends the review with the build request instead; both routes end in the same
// `requirements` argument to runRepositoryBuild.
import fs from 'node:fs';
import path from 'node:path';
import {RepositoryError} from './repository_store.js';

export const LINK_FILE = 'requirements.json';
// A review of 10,000 requirements is about 4 MB. The cap matches the JSON body limit and the build
// upload's field limit, and the stored record is indented, so a review small enough to save here is
// always small enough to send with a build.
export const MAX_LINK_BYTES = 10 * 1024 * 1024;

const fail = (message, status = 400) => { throw new RepositoryError(message, status); };

export const linkPath = (store, programId) => path.join(store.programPath(programId), LINK_FILE);

// Accepts the review as the Import tab builds it and rejects anything the document writer could
// not use. Levels are not checked here: requirements_review.js owns the level vocabulary, and a
// review carrying a level this release does not know must fail loudly at review time, not silently
// at build time.
export function validateReview(review) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) fail('The imported requirements are not a review object.');
  const reqs = review.requirements;
  if (!Array.isArray(reqs) || !reqs.length) fail('The review carries no requirements.');
  for (const r of reqs) {
    if (!r || typeof r !== 'object') fail('A requirement in the review is not an object.');
    if (!String(r.id || '').trim()) fail('A requirement in the review has no id.');
    if (!String(r.level || '').trim()) fail(`Requirement ${r.id} has no level.`);
  }
  if (review.findings !== undefined && !Array.isArray(review.findings)) fail('The review findings are not a list.');
  return review;
}

export const linkSummary = record => record && ({
  savedAt: record.savedAt || '',
  actor: record.actor || '',
  sources: record.sources || [],
  requirements: record.review?.requirements?.length || 0,
  findings: record.review?.findings?.length || 0,
  levels: Object.entries((record.review?.requirements || []).reduce((n, r) => ({ ...n, [r.level]: (n[r.level] || 0) + 1 }), {})).sort(),
});

export function readLink(store, programId) {
  if (!programId) return null;
  let file;
  try { file = linkPath(store, programId); } catch { return null; }
  if (!fs.existsSync(file)) return null;
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    return record?.review?.requirements?.length ? record : null;
  } catch { return null; }
}

// Written the way repository_store writes program.json: a temporary file in the program folder,
// fsynced, then renamed, so a half-written link can never be read by a build.
export function saveLink(store, programId, review, actor = '') {
  if (!programId) fail('Save the imported requirements with a program under Document Control.', 400);
  validateReview(review);
  const text = JSON.stringify({
    savedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    actor: String(actor || '').trim(),
    sources: review.meta?.sources || [],
    review,
  }, null, 2);
  if (Buffer.byteLength(text) > MAX_LINK_BYTES) fail(`The imported requirements are larger than the ${Math.round(MAX_LINK_BYTES / 1024 / 1024)} MB limit.`, 413);
  const folder = store.programPath(programId);
  if (!fs.existsSync(folder)) fail('Program not found.', 404);
  const temp = path.join(folder, `requirements-${Date.now()}-${process.pid}.tmp`);
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, linkPath(store, programId));
  return readLink(store, programId);
}

export function clearLink(store, programId) {
  if (!programId) return false;
  const file = linkPath(store, programId);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

// What a build should write in: the review sent with the request if there is one, otherwise the
// program's link. A request-carried review is not saved as a side effect of a build — saving is the
// owner's own action in the Import tab, so a one-off build cannot silently change what the program
// builds with from then on.
export function requirementsForBuild({ store, programId, supplied }) {
  if (supplied) return validateReview(supplied);
  return readLink(store, programId)?.review || null;
}
