// Admin-only customer register: licensed scope, deployments and patch history.
// Records are customer-confidential, so they live outside the application folder, in the
// folder that holds the Admin app folders and zips (or ISAF_ADMIN_DATA_DIR):
//   ISAF_Customer_Register.json           data used by the Customers tab
//   ISAF_Customer_Delivery_Register.xlsx  one row per Customer app created/published or license change
// They carry over from one Admin version to the next. Never commit them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";

export const CUSTOMER_OPTIONS = Object.freeze({
  license_type: ["Per user", "Company-wide"],
  license_term: ["Annual subscription", "Perpetual + maintenance"],
  usage_tracking: ["Online check-in", "Offline report", "Both"],
  program_types: ["Aircraft", "System", "LRU"],
  phases: ["CoDR", "SRR", "PDR", "SOI-1", "CDR", "SOI-2", "SOI-3", "TRR", "SOI-4", "TIA"],
  do160_revision: ["G"],
  primary_authority: ["FAA", "EASA", "TCCA", "ANAC", "CAAC", "OTHER"],
  cert_regime: ["CIVIL", "MILITARY"],
  cert_basis: ["TC", "STC", "TSO", "ETSO", "PMA", "OTHER"],
  requirements_integration: ["None", "DOORS ReqIF", "DOORS Next", "DOORS 9.0"],
  // What the Customer app's Import tab offers. Anything not licensed for this customer is not shown and its
  // routes are refused; with none of them licensed there is no Import tab at all. Ids only here, because a
  // saved record is filtered against this list; REQUIREMENTS_IMPORT below carries the names and what is ready.
  requirements_tools: ["doors_reqif", "doors_next", "doors_90", "files", "jama", "polarion"],
  plm_integration: ["None", "3DEXPERIENCE"],
  deployment_model: ["On-premise", "Hosted by MX Aero", "Desktop"],
});

/**
 * The requirements import catalog the Customers tab shows, in the order it shows it.
 *  - kind "files": the ReqIF, Excel and CSV import. DOORS exports ReqIF, so a DOORS customer is licensed
 *    through "DOORS ReqIF"; the entry also records that they are a DOORS shop.
 *  - kind "tool": a live connection (jama.js, polarion.js).
 *  - kind "planned": a live connection ISAF does not have yet. Listed so the licensed scope can be agreed
 *    with the customer now, but not selectable, so a license never records a capability that does not exist.
 */
export const REQUIREMENTS_IMPORT = Object.freeze([
  { id: "doors_reqif", label: "DOORS ReqIF", kind: "files", available: true, note: "ReqIF exported from DOORS or DOORS Next" },
  { id: "doors_next", label: "DOORS Next", kind: "planned", available: false, note: "live connection, not built yet" },
  { id: "doors_90", label: "DOORS 9.0", kind: "planned", available: false, note: "live connection, not built yet" },
  { id: "files", label: "Other ReqIF, Excel and CSV files", kind: "files", available: true, note: "any other tool's export" },
  { id: "jama", label: "Jama Connect (Jama Software)", kind: "tool", available: true, note: "live connection" },
  { id: "polarion", label: "Polarion (Siemens)", kind: "tool", available: true, note: "live connection" },
]);
/** The ids that actually switch something on, so a planned entry can never be saved as licensed. */
export const AVAILABLE_IMPORT_IDS = Object.freeze(REQUIREMENTS_IMPORT.filter(o => o.available).map(o => o.id));
/** File import is licensed by either file entry; DOORS customers get it through "DOORS ReqIF". */
export const FILE_IMPORT_IDS = Object.freeze(REQUIREMENTS_IMPORT.filter(o => o.kind === "files").map(o => o.id));

const TEXT_FIELDS = ["company", "address", "contact_name", "contact_email", "contact_role", "it_contact", "license_id", "license_type", "seats", "license_term", "license_start", "license_end", "maintenance_until", "usage_tracking", "do160_in_scope", "do160_revision", "tool_qualification", "primary_authority", "cert_regime", "cert_basis", "requirements_integration", "plm_integration", "deployment_model", "watermark_documents", "watermark_text", "publish_repository", "version_deployed", "deployed_date", "hosted_url", "notes", "demo_visible"];
const LIST_FIELDS = ["program_types", "phases", "requirements_tools"];
const clean = (v, max = 2000) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);

export function customerDataDir(environment = process.env) {
  // fileURLToPath decodes the URL, so folder names with spaces (for example "Cert Documents") resolve correctly.
  return environment.ISAF_ADMIN_DATA_DIR || path.dirname(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
}
export function customerDataFile(environment = process.env) { return path.join(customerDataDir(environment), "ISAF_Customer_Register.json"); }
export function deliveryRegisterFile(environment = process.env) { return path.join(customerDataDir(environment), "ISAF_Customer_Delivery_Register.xlsx"); }
export const LICENSE_FIELDS = ["license_id", "license_type", "seats", "license_term", "license_start", "license_end", "maintenance_until", "usage_tracking", "program_types", "phases", "do160_in_scope", "do160_revision", "tool_qualification", "primary_authority", "cert_regime", "cert_basis", "requirements_integration", "requirements_tools", "plm_integration"];
export function licenseChanged(before, after) { return !before || LICENSE_FIELDS.some(k => JSON.stringify(before[k] ?? "") !== JSON.stringify(after[k] ?? "")); }
const localStamp = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; // computer's local time
export function deliveryRow(customer, {event, entry = {}, commit = ""}) {
  const j = v => Array.isArray(v) ? v.join(", ") : (v ?? "");
  return {
    "Date / time": localStamp(), "Event": event, "Customer": customer.company,
    "License ID": customer.license_id, "License type": customer.license_type, "Seats": customer.seats, "Term": customer.license_term,
    "License start": customer.license_start, "Subscription end": customer.license_end, "Maintenance until": customer.maintenance_until,
    "Usage tracking": customer.usage_tracking, "Program types": j(customer.program_types), "Program phases": j(customer.phases),
    "DO-160 in scope": customer.do160_in_scope, "DO-160 revision": customer.do160_revision, "Tool qualification": customer.tool_qualification,
    "Primary authority": customer.primary_authority, "Certification regime": customer.cert_regime, "Certification basis": customer.cert_basis,
    "Requirements integration": customer.requirements_integration, "Requirements tool connections": j(customer.requirements_tools), "PLM integration": customer.plm_integration,
    "Deployment model": customer.deployment_model, "ISAF version": entry.version || customer.version_deployed, "Admin release commit": commit ? String(commit).slice(0, 12) : "",
    "File / hosted URL": entry.filename, "GitHub repository": entry.repository || "", "Baseline tag": entry.tag, "Package SHA-256": entry.sha256,
    "Watermark": entry.watermark, "Main contact": customer.contact_name, "Contact email": customer.contact_email, "Notes": customer.notes,
  };
}

// Starter configuration for a customer-specific app: the licensed scope and company details
// entered in the Customers tab, written into a copy of the blank configuration workbook.
// Access keys built into a Customer app: active named users, each with its own key (no key itself, only SHA-256).
export function appAccessKeys(customer = {}) {
  return (customer.users || []).filter(u => !u.disabled && /^[0-9a-f]{64}$/.test(u.key_sha256 || "")).map(u => ({ id: u.id, name: u.name, sha256: u.key_sha256 }));
}
export function starterModifications(customer = {}) {
  const m = {}, set = (key, value) => { const v = String(value ?? "").trim(); if (v) m[key] = v; };
  set("program.customer_name", customer.company); set("program.company_name", customer.company);
  set("intake.company_address", customer.address);
  const types = expandProgramTypes((customer.program_types || []).filter(Boolean));
  if (types.length === 1) set("program.type", String(types[0]).toUpperCase());
  set("program.target_authority_primary", customer.primary_authority);
  set("program.cert_regime", customer.cert_regime);
  set("program.cert_basis_type", customer.cert_basis);
  if (customer.do160_in_scope) set("program.do160_in_scope", customer.do160_in_scope === "Yes" ? "Yes" : "No");
  if (customer.do160_in_scope === "Yes") set("program.do160_revision", customer.do160_revision);
  // The workbook field names the tool the program uses, so "DOORS ReqIF" (how requirements reach ISAF) maps
  // to nothing, and "DOORS 9.0" to the wording the workbook offers.
  const doors = { "DOORS Next": "DOORS Next", "DOORS 9.0": "DOORS 9.x (classic)" }[customer.requirements_integration || ""];
  if (doors) set("dev_environment.requirements_tool_type", doors);
  return m;
}
// Default values in a customer app's starter configuration and new intakes. Unlike licensed values,
// the customer can change them.
export const CUSTOMER_DEFAULTS = Object.freeze({ "program.distribution_statement": "© Copyright - All rights reserved" });
// Program-type licenses are hierarchical (owner decision, v5.3.22): Aircraft includes System and LRU;
// System includes LRU.
export function expandProgramTypes(types = []) {
  const set = new Set(types);
  if (set.has("Aircraft")) { set.add("System"); set.add("LRU"); }
  if (set.has("System")) set.add("LRU");
  return CUSTOMER_OPTIONS.program_types.filter(t => set.has(t));
}
// Licensed program types as workbook values (AIRCRAFT, SYSTEM, LRU).
export function licensedProgramTypes(customer = {}) { return expandProgramTypes(customer.program_types || []).map(t => t.toUpperCase()); }
// Licensed phases as UI phase ids ("SOI-1" -> "soi1"). Empty = no phase restriction.
export function licensedPhaseIds(customer = {}) {
  return (customer.phases || []).filter(p => CUSTOMER_OPTIONS.phases.includes(p)).map(p => p.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/**
 * Values written by an older Admin version, renamed since. Without this a record keeps a value the Customers
 * tab no longer offers, the dropdown falls back to the first option, and the next save silently loses it.
 */
const RENAMED = { requirements_integration: { "DOORS 9.x (classic)": "DOORS 9.0" } };
function migrate(customer) {
  const out = { ...customer };
  for (const [field, map] of Object.entries(RENAMED)) if (out[field] in map) out[field] = map[out[field]];
  return out;
}

export class CustomerRegister {
  constructor(file = customerDataFile()) { this.file = file; }
  read() {
    try { const data = JSON.parse(fs.readFileSync(this.file, "utf8")); return (Array.isArray(data.customers) ? data.customers : []).map(migrate); }
    catch (error) { if (error.code === "ENOENT") return []; throw Object.assign(new Error("The customer register could not be read: " + error.message), { status: 500 }); }
  }
  write(customers) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), customers }, null, 2));
    fs.renameSync(tmp, this.file);
  }
  nextLicenseId(customers) {
    const year = new Date().getFullYear(), prefix = `MXA-ISAF-${year}-`;
    const used = customers.map(c => c.license_id).filter(id => String(id || "").startsWith(prefix)).map(id => Number(String(id).slice(prefix.length)) || 0);
    return prefix + String(Math.max(0, ...used) + 1).padStart(4, "0");
  }
  save(id, input = {}) {
    const customers = this.read();
    const existing = customers.find(c => c.id === id);
    const record = existing ? structuredClone(existing) : { id: "cust_" + crypto.randomUUID().slice(0, 8), createdAt: new Date().toISOString(), deployments: [], patches: [] };
    for (const key of TEXT_FIELDS) if (key in input) record[key] = clean(input[key], key === "notes" || key === "address" ? 4000 : 300);
    for (const key of LIST_FIELDS) if (key in input) record[key] = (Array.isArray(input[key]) ? input[key] : []).map(v => clean(v, 40)).filter(v => CUSTOMER_OPTIONS[key].includes(v));
    // A planned connection can be discussed, not licensed: only what ISAF can actually do is kept.
    if ("requirements_tools" in input) record.requirements_tools = (record.requirements_tools || []).filter(v => AVAILABLE_IMPORT_IDS.includes(v));
    if (Array.isArray(input.patches)) record.patches = input.patches.slice(0, 500).map(p => ({ date: clean(p.date, 20), version: clean(p.version, 40), problem: clean(p.problem, 1000), ported: clean(p.ported, 200) })).filter(p => p.date || p.version || p.problem);
    // Display order in the Admin Customers list (owner, 16 November 2026). Kept on the record
    // rather than in browser storage so the order the owner sets survives a new browser or machine.
    // A record without one sorts after those that have one, alphabetically, as before.
    if ("sort_order" in input) {
      const order = Number(input.sort_order);
      if (Number.isFinite(order)) record.sort_order = Math.max(0, Math.min(9999, Math.round(order)));
      else delete record.sort_order;
    }
    record.program_types = expandProgramTypes(record.program_types || []);
    if ((record.program_types || []).includes("Aircraft")) record.do160_in_scope = "Yes"; // Aircraft programs always include DO-160
    if (!record.company) throw Object.assign(new Error("Enter the customer company name."), { status: 400 });
    // A create is any save of the "new" placeholder, and before v5.3.39 each one appended a record
    // and burned a license id. A second click on Save, or a retry while the first request was still
    // in flight, produced two customers with consecutive license ids and no way to tell them apart.
    // Refusing a second customer of the same name closes that for every caller, not just the one
    // button; two genuinely separate records need names that tell them apart anyway.
    if (!existing) {
      const clash = customers.find(c => (c.company || "").trim().toLowerCase() === record.company.trim().toLowerCase());
      if (clash) throw Object.assign(new Error(
        `${clash.company} already exists (${clash.license_id}). If this is a second, separate customer, give it a name that distinguishes it, such as "${record.company} (EU)".`
      ), { status: 409 });
    }
    if (!record.license_id) record.license_id = this.nextLicenseId(customers);
    record.updatedAt = new Date().toISOString();
    const next = existing ? customers.map(c => (c.id === id ? record : c)) : [...customers, record];
    this.write(next);
    return record;
  }
  remove(id) {
    const customers = this.read();
    if (!customers.some(c => c.id === id)) throw Object.assign(new Error("Customer not found."), { status: 404 });
    this.write(customers.filter(c => c.id !== id));
  }
  // Only the SHA-256 of the customer's access key is kept; the key itself is shown once and never stored.
  setAccessKey(id, sha256) {
    const customers = this.read(), record = customers.find(c => c.id === id);
    if (!record) throw Object.assign(new Error("Customer not found."), { status: 404 });
    record.access_key_sha256 = sha256; record.access_key_set = new Date().toISOString().slice(0, 10); record.updatedAt = new Date().toISOString();
    this.write(customers);
    return record;
  }
  // Named users (per-user access keys, v5.3.28). Each user has a name, an optional email and the SHA-256 of
  // their own key; the key itself is shown once and never stored. Usage records name the user who unlocked
  // the app. Changes reach a Customer app when it is published (hosted) or created again (installed).
  setUser(id, { userId = "", name = "", email = "", sha256 = "", disabled } = {}) {
    const customers = this.read(), record = customers.find(c => c.id === id);
    if (!record) throw Object.assign(new Error("Customer not found."), { status: 404 });
    const users = Array.isArray(record.users) ? record.users : [];
    let user = userId ? users.find(u => u.id === userId) : null;
    if (userId && !user) throw Object.assign(new Error("User not found."), { status: 404 });
    const cleanName = clean(name, 120), cleanEmail = clean(email, 200);
    if (!user) {
      if (!cleanName) throw Object.assign(new Error("Enter the user's name."), { status: 400 });
      if (users.some(u => u.name.toLowerCase() === cleanName.toLowerCase() && !u.disabled)) throw Object.assign(new Error(`A user named ${cleanName} already exists.`), { status: 409 });
      user = { id: "usr_" + crypto.randomUUID().slice(0, 8), name: cleanName, email: cleanEmail, created: new Date().toISOString().slice(0, 10), disabled: false };
      users.push(user);
    } else {
      if (cleanName) user.name = cleanName;
      if (email !== undefined && email !== "") user.email = cleanEmail;
    }
    if (sha256) { if (!/^[0-9a-f]{64}$/.test(sha256)) throw Object.assign(new Error("Invalid key fingerprint."), { status: 400 }); if (users.some(u => u !== user && u.key_sha256 === sha256) || record.access_key_sha256 === sha256) throw Object.assign(new Error("That key is already used. Generate a new key."), { status: 409 }); user.key_sha256 = sha256; user.key_set = new Date().toISOString().slice(0, 10); }
    if (typeof disabled === "boolean") { user.disabled = disabled; user.disabled_on = disabled ? new Date().toISOString().slice(0, 10) : undefined; }
    record.users = users; record.updatedAt = new Date().toISOString();
    this.write(customers);
    return { record, user };
  }
  removeUser(id, userId) {
    const customers = this.read(), record = customers.find(c => c.id === id);
    if (!record) throw Object.assign(new Error("Customer not found."), { status: 404 });
    record.users = (record.users || []).filter(u => u.id !== userId); record.updatedAt = new Date().toISOString();
    this.write(customers);
    return record;
  }
  recordDeployment(id, entry) {
    const customers = this.read(), record = customers.find(c => c.id === id);
    if (!record) throw Object.assign(new Error("Customer not found."), { status: 404 });
    record.deployments = [...(record.deployments || []), { date: new Date().toISOString().slice(0, 10), ...entry }];
    record.version_deployed = entry.version; record.deployed_date = new Date().toISOString().slice(0, 10);
    record.updatedAt = new Date().toISOString();
    this.write(customers);
    return record;
  }
}

// Versions available to deploy, newest first, from the release index.
export function releaseVersions(root) {
  try {
    return [...fs.readFileSync(path.join(root, "RELEASES.md"), "utf8").matchAll(/^\|\s*(\d+\.\d+\.\d+)\s*\|\s*`([0-9a-f]{7,40})`/gm)].map(m => ({ version: m[1], commit: m[2] }));
  } catch { return []; }
}
