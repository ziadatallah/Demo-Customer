/**
 * App updates (v5.3.29): telling a Customer app that a newer ISAF version exists, and letting each user
 * accept it, postpone it or skip it — except for a Critical Update, which must be installed.
 *
 * MX Aero side (Admin app, createReleaseRegister):
 *  - The owner records each release offered to customers in the Customers tab (App updates): version, release
 *    date, Critical Update yes/no, grace period in days, what is new, where to get it, and the contact to show.
 *  - The register is kept with the other owner data (ISAF_Update_Releases.json, outside the app folder) and is
 *    published to the usage collector, which is the service the Customer apps can reach.
 *
 * Customer app side (createUpdateClient):
 *  - EDITION.json carries updates {endpoint, token} (the same license token as usage). The app asks the collector
 *    when it starts, every six hours, and whenever a user chooses "Check for updates". Sites hosted by MX Aero
 *    are updated by MX Aero itself, so they show no notice and are never blocked.
 *  - The answer is cached (updates.json) so the notice still shows when the collector is asleep or unreachable.
 *  - Each named user chooses for themself: install it (the app only shows where to get it; it never changes the
 *    installed files), remind me later (hidden for seven days) or skip this version. Choices are per user and per
 *    version, so a later release is offered again.
 *  - A Critical Update cannot be dismissed. Builds are refused from its deadline: the release date plus the grace
 *    period, and never less than three days after the app first learned of the update, so nobody is stopped
 *    without warning. Everything else (reading, Config Data, Documents, the usage report) keeps working.
 *
 * No document, workbook or configuration content is involved: an update check sends the license ID and the
 * version the app is running, and receives the release details.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const LATER_DAYS = 7;          // "Remind me later" hides a non-critical notice for a week
export const MIN_WARNING_DAYS = 3;    // a critical update never blocks builds sooner than this after the app first saw it
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
export const UPDATE_CHOICES = ["install", "later", "skip"];
const DAY = 24 * 60 * 60 * 1000;

const text = (v, max = 400) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const isVersion = v => /^\d+\.\d+\.\d+$/.test(String(v || ""));
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !Number.isNaN(Date.parse(v));
const link = v => { const s = text(v, 500); return /^https:\/\/[^\s]+$/i.test(s) ? s : ""; };

/** Compare two x.y.z versions: 1 if a is newer than b, -1 if older, 0 if the same. */
export function compareVersions(a, b) {
  const pa = String(a || "0").split("."), pb = String(b || "0").split(".");
  for (let i = 0; i < 3; i++) {
    const x = Number.parseInt(pa[i], 10) || 0, y = Number.parseInt(pb[i], 10) || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
export const isNewer = (candidate, current) => isVersion(candidate) && compareVersions(candidate, current) > 0;

/** One release as the owner recorded it. Unknown or malformed fields are dropped, not guessed. */
export function cleanRelease(r = {}) {
  if (!isVersion(r.version)) return null;
  const critical = r.critical === true || r.critical === "true";
  return {
    version: String(r.version),
    date: isDay(r.date) ? String(r.date) : new Date().toISOString().slice(0, 10),
    critical,
    grace_days: critical ? Math.max(0, Math.min(365, Number.parseInt(r.grace_days, 10) || 14)) : 0,
    summary: text(r.summary, 1500),
    download: link(r.download),
    notes_url: link(r.notes_url),
    offered: r.offered !== false,
  };
}

/** The deadline after which a critical update stops builds. Never sooner than MIN_WARNING_DAYS after first_seen. */
export function blockDate(release, firstSeen, now = new Date()) {
  if (!release?.critical) return "";
  const released = Date.parse(release.date);
  const fromRelease = (Number.isNaN(released) ? now.getTime() : released) + release.grace_days * DAY;
  const seen = Date.parse(firstSeen || "");
  const floor = (Number.isNaN(seen) ? now.getTime() : seen) + MIN_WARNING_DAYS * DAY;
  return new Date(Math.max(fromRelease, floor)).toISOString();
}

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };

// ---------------------------------------------------------------------------
// MX Aero side: the register of releases offered to customers
// ---------------------------------------------------------------------------
export function createReleaseRegister(file) {
  const load = () => {
    const raw = readJson(file, {});
    const releases = (Array.isArray(raw.releases) ? raw.releases : []).map(cleanRelease).filter(Boolean)
      .sort((a, b) => compareVersions(b.version, a.version));
    return { contact: text(raw.contact, 200), releases };
  };
  const store = next => { writeJson(file, next); return next; };
  return {
    file,
    read: load,
    /** Add or replace one release. */
    save(release) {
      const clean = cleanRelease(release);
      if (!clean) { const e = new Error("Enter the version as three numbers, for example 5.3.29."); e.status = 400; throw e; }
      const current = load();
      const releases = [clean, ...current.releases.filter(r => r.version !== clean.version)].sort((a, b) => compareVersions(b.version, a.version));
      return store({ ...current, releases });
    },
    remove(version) {
      const current = load();
      return store({ ...current, releases: current.releases.filter(r => r.version !== String(version)) });
    },
    setContact(contact) {
      const current = load();
      return store({ ...current, contact: text(contact, 200) });
    },
    replace(registerFromAdmin = {}) {
      const releases = (Array.isArray(registerFromAdmin.releases) ? registerFromAdmin.releases : []).map(cleanRelease).filter(Boolean);
      return store({ contact: text(registerFromAdmin.contact, 200), releases: releases.sort((a, b) => compareVersions(b.version, a.version)) });
    },
    /** The newest release offered to customers, or null. */
    latestOffered() {
      return load().releases.find(r => r.offered) || null;
    },
    /**
     * The answer a Customer app gets. `update` is null when the app already runs the newest offered release.
     * A critical release that the app has passed over (it runs something newer) is not reported.
     */
    answerFor({ version = "" } = {}) {
      const { contact } = load();
      const latest = this.latestOffered();
      if (!latest || !isNewer(latest.version, version)) return { update: null, contact, server_time: new Date().toISOString() };
      return { update: latest, contact, server_time: new Date().toISOString() };
    },
  };
}

// ---------------------------------------------------------------------------
// Customer app side: checking, caching, per-user choices and the build gate
// ---------------------------------------------------------------------------
export function createUpdateClient({ serviceDir, hosted, manifest = {}, version = "", log = console.log, fetchImpl = globalThis.fetch, dir: forcedDir, now = () => new Date() } = {}) {
  const settings = manifest.updates?.endpoint && manifest.updates?.token ? manifest.updates : null;
  // Sites hosted by MX Aero are updated by MX Aero when it publishes, so they show no notice and are never
  // blocked: their users could do nothing about it.
  const enabled = manifest.edition === "customer" && Boolean(settings) && !hosted;
  const dir = forcedDir || process.env.ISAF_UPDATE_DIR || (hosted ? path.join(os.tmpdir(), "isaf-updates") : path.join(serviceDir, "updates"));
  const file = path.join(dir, "updates.json");
  const current = version || manifest.version || "";
  let checking = null;

  const state = () => {
    const raw = readJson(file, {});
    return {
      update: raw.update ? cleanRelease(raw.update) : null,
      contact: text(raw.contact, 200),
      checked_at: typeof raw.checked_at === "string" ? raw.checked_at : "",
      reachable: raw.reachable !== false,
      first_seen: raw.first_seen && typeof raw.first_seen === "object" ? raw.first_seen : {},
      choices: raw.choices && typeof raw.choices === "object" ? raw.choices : {},
    };
  };
  const put = next => { try { writeJson(file, next); } catch (error) { log(`[ISAF updates] could not save the update state (${error.message}).`); } return next; };

  /** Ask the collector. Keeps the cached answer when it cannot be reached. */
  async function check({ force = false } = {}) {
    if (!enabled || !fetchImpl) return state();
    const before = state();
    if (!force && before.checked_at && now() - Date.parse(before.checked_at) < CHECK_EVERY_MS) return before;
    if (checking) return checking;
    checking = (async () => {
      const url = `${settings.endpoint}?license=${encodeURIComponent(manifest.license_id || "")}&version=${encodeURIComponent(current)}`;
      try {
        const response = await fetchImpl(url, { headers: { "x-isaf-usage-token": settings.token }, signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`answered ${response.status}`);
        const body = await response.json();
        const update = body?.update ? cleanRelease(body.update) : null;
        const first_seen = { ...before.first_seen };
        if (update && !first_seen[update.version]) first_seen[update.version] = new Date(now()).toISOString();
        return put({ ...before, update, contact: text(body?.contact, 200), checked_at: new Date(now()).toISOString(), reachable: true, first_seen });
      } catch (error) {
        log(`[ISAF updates] no answer from the update service (${error.message}); the last answer is kept.`);
        return put({ ...before, reachable: false });
      }
    })().finally(() => { checking = null; });
    return checking;
  }

  /** What this user should see. */
  function status(auth = {}) {
    const userId = text(auth?.user?.id, 40) || "app";
    const s = state();
    const update = s.update && isNewer(s.update.version, current) ? s.update : null;
    const choice = (s.choices[userId] || {})[update?.version] || {};
    const due = update ? blockDate(update, s.first_seen[update.version], new Date(now())) : "";
    const blocked = Boolean(due) && now() >= Date.parse(due);
    const postponed = !update?.critical && (choice.action === "skip" || (choice.later_until && now() < Date.parse(choice.later_until)));
    return {
      enabled, current,
      available: update?.version || "",
      critical: Boolean(update?.critical),
      summary: update?.summary || "", download: update?.download || "", notes_url: update?.notes_url || "",
      date: update?.date || "", contact: s.contact,
      due, daysLeft: due ? Math.max(0, Math.ceil((Date.parse(due) - now()) / DAY)) : null,
      blocked, show: Boolean(update) && !postponed, choice: choice.action || "",
      checked_at: s.checked_at, reachable: s.reachable,
    };
  }

  /** Record a user's answer to the notice. "install" only marks it as seen: the files are never changed here. */
  function choose(auth = {}, action = "later") {
    if (!UPDATE_CHOICES.includes(action)) { const e = new Error("Unknown choice."); e.status = 400; throw e; }
    const userId = text(auth?.user?.id, 40) || "app";
    const s = state();
    const version = s.update?.version;
    if (!version) return status(auth);
    if (s.update.critical && action === "skip") { const e = new Error("This is a critical update and cannot be skipped."); e.status = 409; throw e; }
    const forUser = { ...(s.choices[userId] || {}) };
    forUser[version] = { action, at: new Date(now()).toISOString(), ...(action === "later" ? { later_until: new Date(now().getTime() + LATER_DAYS * DAY).toISOString() } : {}) };
    put({ ...s, choices: { ...s.choices, [userId]: forUser } });
    return status(auth);
  }

  /** The build gate: a message when a critical update is past its deadline, otherwise "". */
  function buildBlockedMessage() {
    if (!enabled) return "";
    const s = status();
    if (!s.blocked) return "";
    const where = s.download ? ` Download it from ${s.download}.` : "";
    const who = s.contact ? ` For help, contact ${s.contact}.` : "";
    return `This ISAF app must be updated before it can build again. ISAF ${s.available} is a critical update and the period for installing it ended on ${s.due.slice(0, 10)}.${where}${who} Reading the configuration, Config Data and Documents still work.`;
  }

  return { enabled, dir, file, current, check, status, choose, buildBlockedMessage, state };
}
