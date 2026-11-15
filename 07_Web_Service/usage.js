/**
 * Usage records (v5.3.28): who used a Customer app, when, and for which program.
 *
 * In a Customer app (createUsageRecorder):
 *  - "app-opened" and "build" events are recorded with the time, licence ID, company, user (the named user whose
 *    key unlocked the app), program (name, short name, document prefix, type), phases, document and failure
 *    counts, app version and hosting. Only metadata: never workbook or document contents.
 *  - Each event is appended to a monthly ledger (usage-YYYY-MM.jsonl). Installed apps keep it in
 *    07_Web_Service/usage (or ISAF_USAGE_DIR); hosted sites keep it in a temporary folder, so the collector is
 *    their record. A "[ISAF usage]" line is also written to the server log.
 *  - When EDITION.json has usage {endpoint, token}, events are sent to the MX Aero usage collector. Unsent events
 *    wait in outbox.jsonl and are resent with the next event and every 10 minutes.
 *  - The customer can download the ledger (usage report) from the Administration tab for an offline install.
 *
 * In the Admin app (createUsageStore, collector routes in server.js): usage is kept per licence in
 * <admin data>/usage/<licence>.jsonl, de-duplicated by event id, from the collector (ingest or sync) or from an
 * imported usage report. The collector token is HMAC-SHA256(collector secret, licence ID): it only lets an app add
 * records for its own licence.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const USAGE_EVENTS = ["app-opened", "build"];
const text = (v, max = 200) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const int = v => Math.max(0, Math.min(1e7, Number.parseInt(v, 10) || 0));

export function usageToken(secret, licenseId) {
  return crypto.createHmac("sha256", String(secret)).update(String(licenseId || "")).digest("hex");
}
export function validToken(secret, licenseId, token) {
  if (!secret || !licenseId || !/^[0-9a-f]{64}$/.test(String(token || ""))) return false;
  return crypto.timingSafeEqual(Buffer.from(usageToken(secret, licenseId)), Buffer.from(String(token)));
}

/** A clean usage event (also used to check events received from apps and imported reports). */
export function cleanEvent(e = {}) {
  const event = USAGE_EVENTS.includes(e.event) ? e.event : null;
  const time = Number.isNaN(Date.parse(e.time)) ? null : new Date(e.time).toISOString();
  if (!event || !time) return null;
  const p = e.program && typeof e.program === "object" ? e.program : {};
  return {
    id: /^[0-9a-f-]{36}$/.test(String(e.id || "")) ? e.id : crypto.randomUUID(),
    time, event,
    license_id: text(e.license_id, 60), company: text(e.company, 200),
    user: text(e.user, 120), user_id: text(e.user_id, 40),
    program: { name: text(p.name), short_name: text(p.short_name, 80), doc_prefix: text(p.doc_prefix, 40), type: text(p.type, 20) },
    phases: (Array.isArray(e.phases) ? e.phases : []).map(x => text(x, 20)).filter(Boolean).slice(0, 20),
    documents: int(e.documents), failures: int(e.failures),
    version: text(e.version, 20), hosting: e.hosting === "hosted" ? "hosted" : "installed", edition: text(e.edition, 20),
  };
}

const monthFile = (dir, time = new Date()) => path.join(dir, `usage-${time.toISOString().slice(0, 7)}.jsonl`);
const readLines = file => { try { return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

export function createUsageRecorder({ serviceDir, hosted, manifest = {}, version = "", log = console.log, fetchImpl = globalThis.fetch, dir: forcedDir } = {}) {
  const enabled = manifest.edition === "customer";
  const dir = forcedDir || process.env.ISAF_USAGE_DIR || (hosted ? path.join(os.tmpdir(), "isaf-usage") : path.join(serviceDir, "usage"));
  const collector = manifest.usage?.endpoint && manifest.usage?.token ? manifest.usage : null;
  const outbox = path.join(dir, "outbox.jsonl");
  let flushing = null;
  const ensureDir = () => fs.mkdirSync(dir, { recursive: true });

  async function flush() {
    if (!collector || !fetchImpl) return { sent: 0 };
    if (flushing) return flushing;
    flushing = (async () => {
      const pending = readLines(outbox);
      if (!pending.length) return { sent: 0 };
      try {
        const response = await fetchImpl(collector.endpoint, { method: "POST", headers: { "Content-Type": "application/json", "x-isaf-usage-token": collector.token }, body: JSON.stringify({ license_id: manifest.license_id || "", events: pending.slice(0, 500) }), signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`collector answered ${response.status}`);
        const sentIds = new Set(pending.slice(0, 500).map(e => e.id));
        const rest = readLines(outbox).filter(e => !sentIds.has(e.id));
        fs.writeFileSync(outbox, rest.map(e => JSON.stringify(e)).join("\n") + (rest.length ? "\n" : ""));
        return { sent: sentIds.size };
      } catch (error) { log(`[ISAF usage] not sent yet (${error.message}); will retry.`); return { sent: 0, error: error.message }; }
    })().finally(() => { flushing = null; });
    return flushing;
  }
  if (enabled && collector) { const t = setInterval(() => { flush(); }, 10 * 60 * 1000); t.unref?.(); setTimeout(() => flush(), 5000).unref?.(); }

  function record(eventName, auth = {}, details = {}) {
    if (!enabled) return null;
    const event = cleanEvent({
      id: crypto.randomUUID(), time: new Date().toISOString(), event: eventName,
      license_id: manifest.license_id || "", company: manifest.customer_name || "",
      user: auth?.user?.name || (auth?.user?.id === "company-key" ? "(company key)" : ""), user_id: auth?.user?.id || "",
      program: details.program || {}, phases: details.phases || [], documents: details.documents, failures: details.failures,
      version, hosting: hosted ? "hosted" : "installed", edition: manifest.edition || "",
    });
    if (!event) return null;
    try {
      ensureDir();
      fs.appendFileSync(monthFile(dir), JSON.stringify(event) + "\n");
      if (collector) fs.appendFileSync(outbox, JSON.stringify(event) + "\n");
    } catch (error) { log(`[ISAF usage] could not write the usage log: ${error.message}`); }
    log(`[ISAF usage] ${event.time.replace("T", " ").slice(0, 19)} UTC | ${event.event} | ${event.company} | user: ${event.user || "-"} | program: ${event.program.name || "-"}${event.phases.length ? " | phases: " + event.phases.join(",") : ""}${event.event === "build" ? ` | documents: ${event.documents}` : ""}`);
    if (collector) flush();
    return event;
  }
  /** All recorded events (for the customer's usage report), oldest first. */
  function report() {
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => /^usage-\d{4}-\d{2}\.jsonl$/.test(f)).sort(); } catch {}
    return files.flatMap(f => readLines(path.join(dir, f)));
  }
  return { enabled, dir, collector: !!collector, record, report, flush };
}

/** Admin side: usage per licence, de-duplicated by event id. */
export function createUsageStore(dir) {
  const fileOf = license => path.join(dir, `${String(license || "unknown").replace(/[^A-Za-z0-9_-]/g, "_")}.jsonl`);
  function list(license) { return readLines(fileOf(license)).sort((a, b) => a.time.localeCompare(b.time)); }
  function add(events, { license } = {}) {
    fs.mkdirSync(dir, { recursive: true });
    const byLicense = new Map();
    let added = 0, skipped = 0;
    for (const raw of events || []) {
      const e = cleanEvent(raw);
      if (!e || (license && e.license_id !== license)) { skipped++; continue; }
      const key = e.license_id || "unknown";
      if (!byLicense.has(key)) byLicense.set(key, new Set(list(key).map(x => x.id)));
      const seen = byLicense.get(key);
      if (seen.has(e.id)) { skipped++; continue; }
      seen.add(e.id); fs.appendFileSync(fileOf(key), JSON.stringify(e) + "\n"); added++;
    }
    return { added, skipped };
  }
  return { dir, list, add };
}

/** Summary for the Admin Usage view: programs and users with first/last use. */
export function summarizeUsage(events = []) {
  const programs = new Map(), users = new Map();
  for (const e of events) {
    const who = e.user || "(unknown user)";
    const u = users.get(who) || { user: who, first: e.time, last: e.time, opens: 0, builds: 0, programs: new Set() };
    u.last = e.time > u.last ? e.time : u.last; if (e.event === "app-opened") u.opens++; else u.builds++;
    if (e.event === "build") {
      const name = e.program?.name || "(program name not set)", key = `${name}|${e.program?.doc_prefix || ""}`;
      const p = programs.get(key) || { name, doc_prefix: e.program?.doc_prefix || "", type: e.program?.type || "", first: e.time, last: e.time, builds: 0, documents: 0, phases: new Set(), users: new Set() };
      p.last = e.time > p.last ? e.time : p.last; p.builds++; p.documents += e.documents || 0; e.phases.forEach(x => p.phases.add(x)); p.users.add(who);
      programs.set(key, p); u.programs.add(name);
    }
    users.set(who, u);
  }
  const list = m => [...m.values()].map(x => ({ ...x, ...(x.phases ? { phases: [...x.phases] } : {}), ...(x.users ? { users: [...x.users] } : {}), ...(x.programs ? { programs: [...x.programs] } : {}) }));
  return { programs: list(programs).sort((a, b) => b.last.localeCompare(a.last)), users: list(users).sort((a, b) => b.last.localeCompare(a.last)) };
}

const csvCell = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function usageCsv(events = []) {
  const head = ["Time (UTC)", "Event", "Company", "User", "Program name", "Program short name", "Document prefix", "Program type", "Phases", "Documents", "Failures", "Version", "Hosting", "Licence ID"];
  const rows = events.map(e => [e.time.replace("T", " ").slice(0, 19), e.event, e.company, e.user, e.program?.name, e.program?.short_name, e.program?.doc_prefix, e.program?.type, (e.phases || []).join(" "), e.documents, e.failures, e.version, e.hosting, e.license_id]);
  return [head, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
