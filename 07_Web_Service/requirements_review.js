/**
 * Requirements review for the Import tab (v5.3.28): automatic checks that ease the manual review.
 *
 * normalize(objects, mapping, level, relations) turns imported objects (requirements_import.py inspect) into
 * requirements; review(sets, options) checks them against common requirements-standard rules and the review criteria
 * of the standard for each level: DO-178C 6.3.1 / 6.3.2 for software, DO-254 5.1, 6.1, 6.2 and 10.3.1 for hardware,
 * ARP4754A 5.3 to 5.5 (with ARP4761A 3.5 for safety requirements) for system requirements. Each finding cites the
 * standard of its level (REFS). It builds the trace (system -> high-level -> low-level, requirements -> tests) and
 * prepares evidence for the review checklist. Judgment items (correctness, consistency, compatibility with the
 * target, algorithms) are left to the reviewer. The reviewer performs and signs the review.
 */

export const LEVELS = {
  system: { label: "System requirements", one: "system requirement", rank: 0, parents: [] },
  hlr: { label: "Software high-level requirements (HLRs)", one: "software high-level requirement", rank: 1, parents: ["system"] },
  hw: { label: "Hardware requirements", one: "hardware requirement", rank: 1, parents: ["system"] },
  llr: { label: "Software low-level requirements (LLRs)", one: "software low-level requirement", rank: 2, parents: ["hlr"] },
  // Verification cases are not one bucket: a test is written against requirements at one level,
  // and tracing it to another level is a real defect. DO-178C 6.4.4 expects test coverage of
  // high-level requirements and of low-level requirements separately; DO-254 the same for
  // hardware. So each test level carries the one parent level it may trace to.
  syst: { label: "System verification cases", one: "system verification case", rank: 3, parents: ["system"] },
  hlt: { label: "Software high-level tests (HLTs)", one: "high-level test", rank: 3, parents: ["hlr"] },
  hwt: { label: "Hardware verification cases", one: "hardware verification case", rank: 3, parents: ["hw"] },
  llt: { label: "Software low-level tests (LLTs)", one: "low-level test", rank: 4, parents: ["llr"] },
  // Kept so that requirements imported before the test levels existed still review exactly as
  // they did. It accepts any parent, which is the behaviour this release replaces.
  test: { label: "Verification cases (level not stated)", one: "verification case", rank: 5, parents: ["hlr", "llr", "hw", "system"] },
};
export const TEST_LEVELS = ["syst", "hlt", "hwt", "llt", "test"];
export const isTest = level => TEST_LEVELS.includes(level);
const anyTests = present => TEST_LEVELS.some(l => present.has(l));
export const DEFAULT_AMBIGUOUS = ["TBD", "TBC", "TBR", "and/or", "etc.", "as appropriate", "as required", "as necessary", "if possible", "if practical", "adequate", "sufficient", "user-friendly", "user friendly", "easy", "fast", "quickly", "rapidly", "minimize", "maximize", "optimize", "approximately", "about", "normally", "typically", "generally", "should", "may", "might", "could", "etc", "some", "several", "robust", "flexible", "efficient", "state of the art"];
export const DEFAULT_OPTIONS = { requireShall: true, singleShall: true, ambiguous: DEFAULT_AMBIGUOUS, checkUnits: true, checkTolerance: true, designDetail: true, requireVerification: true, requireRationaleForDerived: true, maxWords: 60 };

/** Reference for each check by level group: [software (hlr, llr, test), hardware, system]. Section numbers only. */
export const REFS = {
  "Missing ID": ["Requirements standard", "DO-254 5.1.1(1); 10.3.1", "ARP4754A 5.4.7.2a"],
  "Duplicate ID": ["Requirements standard", "DO-254 5.1.1(1); 10.3.1", "ARP4754A 5.4.7.2a"],
  "Empty text": ["Requirements standard", "DO-254 5.1.1(1)", "ARP4754A 5.4.3a(2)"],
  "No \"shall\"": ["Requirements standard", "DO-254 5.1.1(1)", "ARP4754A 5.4.3a(2) (identifiable as a requirement)"],
  "Compound requirement": ["DO-178C 6.3.1d / 6.3.2d (verifiability)", "DO-254 6.2.2(1,3) (verification, traceability)", "ARP4754A 5.4.3a(13) (multiple characteristics)"],
  "Ambiguous or open term": ["DO-178C 6.3.1b / 6.3.2b (accuracy, verifiability)", "DO-254 6.1.2(5) (correct: no ambiguity)", "ARP4754A 5.4.3a(1) (unambiguous)"],
  "Value without unit": ["DO-178C 6.3.1b (accuracy)", "DO-254 5.1.2(6) (quantitative terms)", "ARP4754A 5.4.3a(9) (tolerances)"],
  "No tolerance": ["", "DO-254 5.1.2(6) (tolerances)", "ARP4754A 5.4.3a(9) (specific tolerances)"],
  "Possible design detail": ["", "DO-254 5.1.2(6) (no design or verification solutions)", "ARP4754A 5.4.3a(7) (what and how well, not how)"],
  "Negative requirement": ["DO-178C 6.3.1d (verifiability)", "DO-254 6.2.2(2) (verification methods)", "ARP4754A 5.4.3a(10) (verifiable)"],
  "Long requirement": ["Requirements standard", "Requirements standard", "ARP4754A 5.4.3a(13)"],
  "No verification method": ["DO-178C 6.3.1d / 6.4", "DO-254 6.2.2(1,2)", "ARP4754A 5.4.3a(10); 5.5.5"],
  "Duplicate text": ["DO-178C 6.3.1b (consistency)", "DO-254 6.1.2(5) (correctness)", "ARP4754A 5.4.3a(3) (redundant)"],
  "Broken trace link": ["DO-178C 6.3.1f / 6.3.2f (traceability)", "DO-254 5.1.2(8) (traceability)", "ARP4754A 5.4.3a(12) (source identified)"],
  "Trace to unexpected level": ["Plans: trace structure", "Plans: trace structure", "Plans: trace structure"],
  "Not traced": ["DO-178C 6.3.1f / 6.3.2f (traceability)", "DO-254 5.1.2(8) (traceability)", "ARP4754A 5.4.3a(12)"],
  "Derived requirement": ["DO-178C 5.1.1b / 5.2.1b", "DO-254 5.1.1(2); 5.1.2(5); 6.1.2(3)", "ARP4754A 5.3.1.4; ARP4761A 3.5"],
  "Derived without rationale": ["DO-178C 5.1.2h / 5.2.2f", "DO-254 6.1 (validated against the design decision)", "ARP4754A 5.3.1.4; 5.4.3a(11)"],
  "Derived not validated": ["", "DO-254 6.1.1(1); 6.1.2(1,2)", "ARP4754A 5.4.6; 5.4.7.2e-g"],
  "No validation method": ["", "DO-254 6.1.2(2)", "ARP4754A 5.4.6; 5.4.7.2e"],
  "Not yet validated": ["", "DO-254 6.1.2(2)", "ARP4754A 5.4.7.2g (validation conclusion)"],
  "No validation data": ["", "DO-254 6.1.2(1,2,6)", "ARP4754A 5.4.7.2 (validation matrix)"],
  "Based on an assumption": ["", "DO-254 6.1 (assumptions validated as derived requirements)", "ARP4754A 5.4.2d (management of assumptions)"],
  "Source not identified": ["", "", "ARP4754A 5.4.3a(12); 5.4.7.2b"],
  "Safety requirement without DAL": ["", "DO-254 5.1.2(2a)", "ARP4754A 5.4.7.2d; ARP4761A 3.5"],
  "Safety requirement not allocated": ["", "", "ARP4761A 3.5 (allocation to items); ARP4754A 5.3"],
  "Invalid DAL": ["", "DO-254 5.1.2(2a)", "ARP4754A 5.4.7.2d"],
  "Not developed further": ["DO-178C 6.3.1f / 6.3.2f (traceability)", "DO-254 5.1.2(8)", "ARP4754A 5.3 (allocation); 5.4.4 (completeness)"],
  "No test": ["DO-178C 6.4.4a (requirements-based test coverage)", "DO-254 6.2.2(4a) (verification coverage)", "ARP4754A 5.5 (implementation verification)"],
  "Test not traced": ["DO-178C 6.4.4 / 6.5; DO-254 6.2.1(2)", "DO-254 6.2.1(2)", "ARP4754A 5.5"],
};
const GROUP = { system: 2, syst: 2, hw: 1, hwt: 1 };
export const refFor = (check, level) => { const r = REFS[check]; return r ? (r[GROUP[level] ?? 0] || r[0] || r[1] || r[2]) : ""; };
const VALID = /^(valid|validated|accepted|approved|complete|completed|closed|yes|y|ok|passed?)$/i;
const NOT = /^(|n|no|false|0|-|—|none|n\/a|na)$/i;
const DAL = /^(?:(?:F|I)?DAL\s*|level\s*)?([A-E])$/i;
const PHYS = "(?:%|°|deg|degC|°C|°F|K|V|mV|kV|A|mA|µA|uA|W|mW|kW|Hz|kHz|MHz|GHz|s|ms|µs|us|ns|min|h|hr|hours?|minutes?|seconds?|m|mm|cm|km|ft|in|nm|NM|kt|kts|knots?|g|kg|lb|lbs|N|Nm|Pa|kPa|psi|psia|psig|bar|dB|dBm|rpm|Ω|ohm|ohms|uF|µF|pF|nF|mH|lux|cd|feet|meters?|percent|Mbps|kbps|bps)";
const MEASURE = new RegExp(`\\d(?:[\\d.,]*)\\s*${PHYS}(?![A-Za-z])`);
const TOLERANCE = /±|\+\/-|\+\/−|\bwithin\b|\bat (?:least|most)\b|\bno (?:more|less|greater|fewer|later|earlier|higher|lower) than\b|\bnot (?:to )?exceed|\bexceed|\b(?:minimum|maximum|min\.?|max\.?)\b|\b(?:less|greater|more|lower|higher|longer|shorter|faster|slower) than\b|\bup to\b|\bbetween\b|\bfrom\b[^.;]{1,40}\bto\b|\d\s*(?:to|-|–|\.\.)\s*\d|[≤≥<>]|\btolerance\b|\baccuracy\b|\bor (?:less|more|better|greater|lower|higher)\b|\brange\b|\bnominal\b/i;
const DESIGN = /\b(by means of|implemented (?:in|with|by|using|as)|by using|shall use|shall be implemented|using an?|via an?)\b/i;
const ASSUME = /\bassum(?:e|ed|es|ing|ption|ptions)\b/i;

const truthy = v => /^(y|yes|true|1|x|derived|✓)$/i.test(String(v || "").trim());
const splitIds = v => String(v || "").split(/[\s,;|\n]+/).map(x => x.trim()).filter(Boolean);

/**
 * mapping: { id, text, title, heading, parents, derived, rationale, verification, validation, validationStatus, assumption,
 * safety, dal, origin, typeAttr, typeValues: [..] }
 * (attribute names). Objects that are headings (heading attribute filled and no text) or whose type is not in
 * typeValues are kept out. ReqIF relations between objects are returned as links by ReqIF identifier.
 */
export function normalize(objects = [], mapping = {}, level = "hlr", sourceName = "") {
  const out = [];
  const want = new Set((mapping.typeValues || []).map(v => String(v).trim().toLowerCase()).filter(Boolean));
  for (const o of objects) {
    const get = key => key ? String(o[key] ?? "").trim() : "";
    const text = get(mapping.text), heading = get(mapping.heading);
    if (mapping.typeAttr && want.size && !want.has(get(mapping.typeAttr).toLowerCase())) continue;
    if (!text && heading) continue;
    if (!text && !get(mapping.id)) continue;
    out.push({
      // The key links an object to the relations of its source: the ReqIF identifier, or the Jama document key.
      // item: v5.3.39. One DOORS module can hold the requirements of several software and hardware
      // items, so the item is a column like any other. The caller supplies its own default for rows
      // that leave it empty (the Item box on the file card).
      key: o["(ReqIF identifier)"] || o["(Document key)"] || "", id: get(mapping.id), text, title: get(mapping.title), level, source: sourceName, item: get(mapping.item),
      parents: splitIds(get(mapping.parents)), derived: truthy(get(mapping.derived)), rationale: get(mapping.rationale), verification: get(mapping.verification),
      validation: get(mapping.validation), validationStatus: get(mapping.validationStatus), assumption: get(mapping.assumption), safety: get(mapping.safety), dal: get(mapping.dal), origin: get(mapping.origin),
      mapped: ["validation", "validationStatus", "assumption", "safety", "dal", "origin", "parents"].filter(k => mapping[k]),
    });
  }
  return out;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const UNIT = "(?:%|°|deg|degC|°C|°F|K|V|mV|kV|A|mA|µA|uA|W|mW|kW|Hz|kHz|MHz|GHz|s|ms|µs|us|ns|min|h|hr|hours?|minutes?|seconds?|m|mm|cm|km|ft|in|inch|inches|nm|NM|kt|kts|knots?|g|kg|lb|lbs|N|Pa|kPa|psi|psia|psig|bar|dB|dBm|bit|bits|byte|bytes|B|kB|KB|MB|GB|Mbps|kbps|bps|rpm|Ω|ohm|ohms|F|uF|µF|pF|nF|H|mH|lux|cd|feet|meters?|percent|cycles?|frames?|samples?|words?|times|counts?|items?|messages?|channels?|entr(?:y|ies)|elements?|records?|lines?|characters?|chars?|pixels?|px|steps?|retries|attempts?|cells?|rows?|columns?|digits?|decimals?|places|users?|tasks?|threads?|packets?|pages?|blocks?|sectors?|sensors?|inputs?|outputs?|levels?)";
const NUMBER_NO_UNIT = new RegExp(`(?<![A-Za-z0-9_.\\-/])(\\d+(?:\\.\\d+)?)(?!\\s*${UNIT}\\b)(?![\\d\\-/:A-Za-z_]|\\.\\d)`, "g");

/** Review requirement sets. sets: [{ level, name, requirements }]. Returns findings, statistics, trace and checklist evidence. */
export function review(sets = [], options = {}) {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const all = [];
  for (const s of sets) for (const r of s.requirements || []) all.push({ ...r, level: r.level || s.level, source: r.source || s.name, children: [], tests: [] });
  const findings = [];
  const add = (r, severity, check, message, ref = refFor(check, r?.level)) => findings.push({ severity, check, level: r?.level || "", levelLabel: LEVELS[r?.level]?.label || "", reqId: r?.id || "(no ID)", item: r?.item || "", message, text: r?.text || "", ref });
  // Identification
  const byId = new Map(), byKey = new Map();
  for (const r of all) {
    if (r.key) byKey.set(r.key, r);
    if (!r.id) { add(r, "Error", "Missing ID", "The requirement has no identifier."); continue; }
    if (byId.has(r.id)) add(r, "Error", "Duplicate ID", `The identifier ${r.id} is used more than once.`);
    else byId.set(r.id, r);
  }
  // An item named in the file that this program does not have would send its requirements to a
  // document that is never generated, so they would vanish without a word. knownItems is the
  // program's software, hardware and system item ids; an empty list switches the check off.
  const known = new Set((options.knownItems || []).map(x => String(x).trim()).filter(Boolean));
  if (known.size) {
    const unknown = new Map();
    for (const r of all) { const i = String(r.item || '').trim(); if (i && !known.has(i)) unknown.set(i, (unknown.get(i) || 0) + 1); }
    for (const r of all) {
      const i = String(r.item || '').trim();
      if (i && !known.has(i)) add(r, "Error", "Item not in this program", `Item "${i}" is not a software, hardware or system item of this program (${unknown.get(i)} requirement${unknown.get(i) === 1 ? '' : 's'}). Its requirements reach no document. Correct the item column, or map it to one of: ${[...known].slice(0, 8).join(', ')}${known.size > 8 ? '…' : ''}.`);
    }
  }
  // Links from ReqIF relations: the item at the lower level traces to the item at the higher level.
  for (const s of sets) for (const link of s.relations || []) {
    const a = byKey.get(link.source), b = byKey.get(link.target);
    if (!a || !b || a === b) continue;
    const [child, parent] = LEVELS[a.level].rank >= LEVELS[b.level].rank ? [a, b] : [b, a];
    if (parent.id && !child.parents.includes(parent.id)) child.parents.push(parent.id);
  }
  // Wording and content
  const ambiguous = (opt.ambiguous || []).filter(Boolean).map(t => ({ t, re: new RegExp(`(^|[^A-Za-z0-9])${escapeRe(t)}(?=$|[^A-Za-z0-9])`, "i") }));
  const seenText = new Map();
  for (const r of all) {
    const isTestCase = isTest(r.level);
    if (!r.text) { add(r, "Error", "Empty text", "The requirement has no text."); continue; }
    if (!isTestCase) {
      const shalls = (r.text.match(/\bshall\b/gi) || []).length;
      if (opt.requireShall && !shalls) add(r, "Warning", "No \"shall\"", "The text does not state a requirement with \"shall\".");
      if (opt.singleShall && shalls > 1) add(r, "Warning", "Compound requirement", `The text has ${shalls} "shall" statements; split it so each can be verified and traced separately.`);
      const hits = ambiguous.filter(a => a.re.test(r.text)).map(a => a.t);
      if (hits.length) add(r, hits.some(h => /^TB[DCR]$/i.test(h)) ? "Error" : "Warning", "Ambiguous or open term", `Contains: ${[...new Set(hits)].join(", ")}.`);
      if (opt.checkUnits) {
        const bare = [...r.text.matchAll(NUMBER_NO_UNIT)].map(m => m[1]).filter(n => !(r.id && r.id.includes(n)) && !/^(0|1|2)$/.test(n));
        if (bare.length) add(r, "Warning", "Value without unit", `Value${bare.length > 1 ? "s" : ""} ${[...new Set(bare)].slice(0, 5).join(", ")} ${bare.length > 1 ? "have" : "has"} no unit or tolerance stated.`);
      }
      if (/\bshall not\b/i.test(r.text)) add(r, "Info", "Negative requirement", "\"shall not\" requirements are hard to verify by test; state how it will be verified.");
      const words = r.text.split(/\s+/).length;
      if (opt.maxWords && words > opt.maxWords) add(r, "Info", "Long requirement", `${words} words; consider splitting.`);
      if (opt.requireVerification && r.level !== "system" && !r.verification) add(r, "Warning", "No verification method", "No verification method (test, analysis, inspection or review) is recorded.");
      if (r.level === "hw" || r.level === "system") {
        if (opt.checkTolerance && MEASURE.test(r.text) && !TOLERANCE.test(r.text)) add(r, "Warning", "No tolerance", "A measured value is stated without a tolerance or limit (±, within, at least, no more than, a range).");
        if (opt.designDetail && DESIGN.test(r.text)) add(r, "Info", "Possible design detail", `"${r.text.match(DESIGN)[1]}" may describe a design solution rather than a requirement; a deliberate design constraint is acceptable.`);
        if (truthy(r.assumption) || ASSUME.test(r.text)) add(r, "Info", "Based on an assumption", r.level === "system" ? "Based on an assumption: state it explicitly, justify it and validate it; resolve it by certification." : "Based on an assumption: validate it as a derived requirement.");
        if (r.mapped?.includes("dal") && r.dal && !DAL.test(r.dal)) add(r, "Warning", "Invalid DAL", `DAL "${r.dal}" is not A to E.`);
        if (r.mapped?.includes("safety") && !NOT.test(r.safety) && r.mapped.includes("dal") && !r.dal) add(r, "Warning", "Safety requirement without DAL", "A safety-related requirement has no development assurance level.");
      }
    }
    const norm = r.text.toLowerCase().replace(/\s+/g, " ").trim();
    const twin = seenText.get(r.level + "|" + norm);
    if (twin && twin.id !== r.id) add(r, "Warning", "Duplicate text", `Same text as ${twin.id}.`);
    else seenText.set(r.level + "|" + norm, r);
  }
  // Traceability
  const levelsPresent = new Set(all.map(r => r.level));
  for (const r of all) {
    const allowed = LEVELS[r.level]?.parents || [];
    for (const pid of r.parents) {
      const p = byId.get(pid);
      if (!p) { add(r, levelsPresent.size > 1 || r.level === "system" ? "Error" : "Warning", "Broken trace link", `Traces to ${pid}, which is not in the imported requirements.`); continue; }
      // Tests used to short-circuit here, so a low-level test traced to a high-level requirement
      // was accepted silently. They now go through the same check as everything else; the legacy
      // "test" level still lists all four parents, so old imports are unaffected.
      if (allowed.includes(p.level)) (isTest(r.level) ? p.tests : p.children).push(r.id);
      else add(r, "Warning", "Trace to unexpected level", `Traces to ${pid} (${LEVELS[p.level].label}); expected ${allowed.map(l => LEVELS[l].label).join(" or ")}.`);
    }
    const parentLevelImported = allowed.some(l => levelsPresent.has(l));
    if (r.level !== "system" && !isTest(r.level)) {
      const traced = r.parents.some(pid => byId.has(pid));
      if (!traced && !r.derived && parentLevelImported) add(r, "Error", "Not traced", `Does not trace to a ${allowed.map(l => LEVELS[l].one).join(" or ")} and is not marked derived.`);
      if (r.derived) {
        add(r, "Info", "Derived requirement", r.level === "hw" ? "Derived: feed it back to the system safety assessment and validate it if it affects safety or constrains later design." : "Derived: provide it to the system safety assessment process.");
        if (opt.requireRationaleForDerived && !r.rationale) add(r, "Error", "Derived without rationale", "A derived requirement needs a rationale.");
      }
    }
    if (isTest(r.level) && !r.parents.length) add(r, "Warning", "Test not traced", `The ${LEVELS[r.level].one} does not trace to a ${LEVELS[r.level].parents.map(l => LEVELS[l].one).join(" or ")}.`);
    if (r.level === "system") {
      if (r.derived) {
        add(r, "Info", "Derived requirement", "Derived: identify the aircraft function it supports, assign the failure condition classification, validate it and review its safety impact.");
        if (opt.requireRationaleForDerived && !r.rationale) add(r, "Error", "Derived without rationale", "A derived requirement needs a rationale or a reference to the design standard.");
      }
      if (r.mapped?.includes("origin") && !r.origin && !r.parents.length && !r.derived) add(r, "Warning", "Source not identified", "The source of the requirement (customer, regulation, aircraft function, safety assessment) is not recorded.");
    }
    // Validation: system requirements (ARP4754A) and derived hardware requirements (DO-254 6.1).
    if (r.level === "system" || (r.level === "hw" && r.derived)) {
      const hasMethod = r.mapped?.includes("validation"), hasStatus = r.mapped?.includes("validationStatus");
      if (hasMethod || hasStatus) {
        if (r.level === "hw" && !r.validation && !(r.validationStatus && VALID.test(r.validationStatus))) add(r, "Warning", "Derived not validated", "No validation method or conclusion is recorded for this derived hardware requirement.");
        else if (r.level === "system" && hasMethod && !r.validation) add(r, "Warning", "No validation method", "No validation method (traceability, analysis, modeling, test, similarity, engineering review) is recorded.");
        if (hasStatus && !VALID.test(r.validationStatus) && (r.level === "system" || r.validation)) add(r, "Info", "Not yet validated", `Validation conclusion: ${r.validationStatus || "(empty)"}.`);
      }
    }
  }
  // Validation data missing for a whole level (one note per level).
  for (const level of ["system", "hw"]) {
    const rs = all.filter(r => r.level === level && (level === "system" || r.derived));
    if (rs.length && !rs.some(r => r.mapped?.includes("validation") || r.mapped?.includes("validationStatus")))
      add({ level, id: level === "system" ? "(all system requirements)" : "(derived hardware requirements)", text: "" }, "Info", "No validation data", `No validation method or conclusion column is mapped for ${rs.length} ${level === "system" ? "system requirements" : "derived hardware requirements"}; map one to fill the validation matrix.`);
  }
  // Coverage downwards (only when the lower level was imported)
  for (const r of all) {
    const lower = Object.entries(LEVELS).filter(([, v]) => v.parents.includes(r.level) && v.rank > LEVELS[r.level].rank && v.rank < 3).map(([k]) => k).filter(k => levelsPresent.has(k));
    if (lower.length && !r.children.length && !isTest(r.level)) {
      if (r.level === "system" && r.mapped?.includes("safety") && !NOT.test(r.safety)) add(r, "Warning", "Safety requirement not allocated", `Safety requirement not allocated: no ${lower.map(l => LEVELS[l].one).join(" or ")} traces to it.`);
      else add(r, "Warning", "Not developed further", `No ${lower.map(l => LEVELS[l].one).join(" or ")} traces to it.`);
    }
    if (anyTests(levelsPresent) && !isTest(r.level) && r.level !== "system" && !r.tests.length && !r.children.length) add(r, "Warning", "No test", "No verification case traces to it.");
  }
  // Statistics, requirement rows and trace rows
  const count = {};
  for (const f of findings) { const k = f.reqId + "|" + f.level; count[k] = (count[k] || 0) + 1; }
  const stats = Object.keys(LEVELS).filter(l => levelsPresent.has(l)).map(l => {
    const rs = all.filter(r => r.level === l), fs = findings.filter(f => f.level === l);
    const traced = rs.filter(r => r.parents.some(p => byId.has(p)) || r.derived).length, kids = rs.filter(r => r.children.length).length, tests = rs.filter(r => r.tests.length).length;
    const pct = (n, d) => d ? `${n} of ${d} (${Math.round(100 * n / d)}%)` : "";
    return { level: l, label: LEVELS[l].label, requirements: rs.length, errors: fs.filter(f => f.severity === "Error").length, warnings: fs.filter(f => f.severity === "Warning").length, info: fs.filter(f => f.severity === "Info").length,
      traced, tracedText: l === "system" ? "" : pct(traced, rs.length), withChildren: kids, childrenText: l === "llr" || isTest(l) ? "" : pct(kids, rs.length), withTests: tests, testsText: anyTests(levelsPresent) && !isTest(l) ? pct(tests, rs.length) : "" };
  });
  const requirements = all.map(r => ({ level: r.level, levelLabel: LEVELS[r.level]?.label || r.level, id: r.id, text: r.text, parents: r.parents, children: r.children, tests: r.tests, derived: r.derived, rationale: r.rationale, verification: r.verification, validation: r.validation || "", validationStatus: r.validationStatus || "", assumption: truthy(r.assumption) || ASSUME.test(r.text || ""), safety: r.safety && !NOT.test(r.safety) ? r.safety : "", dal: r.dal || "", origin: r.origin || "", source: r.source, item: r.item || "", findingCount: count[r.id + "|" + r.level] || 0 }));
  const trace = [];
  for (const r of all) for (const pid of r.parents) { const p = byId.get(pid); if (p) trace.push({ parentLevel: LEVELS[p.level].label, parent: p.id, childLevel: LEVELS[r.level].label, child: r.id }); }
  const order = { Error: 0, Warning: 1, Info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || LEVELS[a.level].rank - LEVELS[b.level].rank || String(a.reqId).localeCompare(String(b.reqId), undefined, { numeric: true }));
  return { findings, stats, requirements, trace, checklist: checklistEvidence(findings, stats, levelsPresent), totals: { requirements: all.length, errors: findings.filter(f => f.severity === "Error").length, warnings: findings.filter(f => f.severity === "Warning").length, info: findings.filter(f => f.severity === "Info").length } };
}

/** Evidence for the requirements review checklist: objective items get a result; judgment items are left to the reviewer.
    Questions follow the standard of each imported level: DO-178C (software), DO-254 (hardware), ARP4754A / ARP4761A (system). */
function checklistEvidence(findings, stats, levels) {
  const list = [];
  const make = (lv, area) => {
    const fs = findings.filter(f => lv.includes(f.level));
    const n = check => fs.filter(f => f.check === check).length;
    const ids = check => [...new Set(fs.filter(f => f.check === check).map(f => f.reqId))];
    const total = stats.filter(s => lv.includes(s.level)).reduce((a, s) => a + s.requirements, 0);
    const item = (question, ref, checks, okText) => { const k = checks.reduce((a, c) => a + n(c), 0); return { area, question, ref, status: k ? "Findings" : "No findings", evidence: k ? `${k} finding${k === 1 ? "" : "s"} (${checks.filter(c => n(c)).map(c => `${c}: ${n(c)}`).join("; ")}). See the Findings sheet.` : okText }; };
    const reviewer = (question, ref, hint) => ({ area, question, ref, status: "Reviewer", evidence: hint });
    return { n, ids, total, item, reviewer };
  };
  if (levels.has("hlr") || levels.has("llr")) {
    const { n, total, item, reviewer } = make(["hlr", "llr", "hlt", "llt", "test"], "Software (DO-178C)");
    list.push(
      item("Is each requirement uniquely identified?", "Requirements standard", ["Missing ID", "Duplicate ID"], `All ${total} requirements have a unique identifier.`),
      item("Does each requirement state one verifiable requirement (\"shall\")?", "DO-178C 6.3.1d / 6.3.2d", ["No \"shall\"", "Compound requirement", "Empty text"], "Each requirement has exactly one \"shall\" statement."),
      item("Are requirements free of ambiguous or open terms (TBD, TBC, and/or …)?", "DO-178C 6.3.1b / 6.3.2b", ["Ambiguous or open term"], "No ambiguous or open terms found."),
      item("Do numeric values state units?", "DO-178C 6.3.1b", ["Value without unit"], "Numeric values have units."),
      item("Is a verification method recorded for each requirement?", "DO-178C 6.3.1d / 6.4", ["No verification method"], "Each requirement has a verification method."),
      item("Does each requirement trace to its parent, or is it identified as derived?", "DO-178C 6.3.1f / 6.3.2f", ["Not traced", "Broken trace link", "Trace to unexpected level"], "All requirements trace to a parent or are derived."),
      item("Do derived requirements have a rationale and were they provided to the safety assessment?", "DO-178C 5.1.2h / 5.2.2f", ["Derived without rationale"], `Derived requirements have a rationale (${n("Derived requirement")} derived; confirm they were provided to the safety assessment).`),
      item("Is every parent requirement developed by lower-level requirements?", "DO-178C 6.3.1f / 6.3.2f", ["Not developed further"], "Every parent requirement is developed by at least one lower-level requirement."));
    if (anyTests(levels)) list.push(item("Is every requirement covered by a verification case?", "DO-178C 6.4.4a", ["No test", "Test not traced"], "Every requirement has a verification case."));
    list.push(
      reviewer("Are the requirements accurate, unambiguous and consistent with each other?", "DO-178C 6.3.1b / 6.3.2b", "Reviewer judgment. Use the duplicate-text and ambiguous-term findings as a starting point."),
      reviewer("Do the requirements comply with the parent (system or high-level) requirements?", "DO-178C 6.3.1a / 6.3.2a", "Reviewer judgment against the parent requirements listed in the Requirements and Trace sheets."),
      reviewer("Are the requirements compatible with the target computer / hardware?", "DO-178C 6.3.1c / 6.3.2c", "Reviewer judgment (timing, memory, interfaces)."),
      reviewer("Do the requirements conform to the requirements standard?", "DO-178C 6.3.1e / 6.3.2e", "Partly checked above (identification, wording, units, verification method). Remaining rules of the standard: reviewer."),
      reviewer("Are algorithms accurate and their behavior correct?", "DO-178C 6.3.1g / 6.3.2g", "Reviewer judgment."));
  }
  if (levels.has("hw")) {
    const { n, ids, total, item, reviewer } = make(["hw"], "Hardware (DO-254)");
    const assumed = ids("Based on an assumption");
    list.push(
      item("Are the hardware requirements identified, defined and documented?", "DO-254 5.1.1(1); 10.3.1", ["Missing ID", "Duplicate ID", "Empty text", "No \"shall\""], `All ${total} hardware requirements are identified and stated.`),
      item("Are requirements stated in quantitative terms, with tolerances where applicable, and without design solutions?", "DO-254 5.1.2(6)", ["Value without unit", "No tolerance", "Possible design detail", "Ambiguous or open term"], "Measured values have units and tolerances; no design wording found."),
      item("Do the requirements trace to the next higher level (system requirements)?", "DO-254 5.1.2(8)", ["Not traced", "Broken trace link", "Trace to unexpected level"], "Every hardware requirement traces to a system requirement or is derived."),
      item("Are derived requirements identified, given a rationale and fed back to the safety assessment?", "DO-254 5.1.1(2); 5.1.2(4,5)", ["Derived without rationale"], `${n("Derived requirement")} derived requirements, each with a rationale. Confirm they were fed back to the system safety assessment.`),
      item("Are derived requirements that need validation validated (method and conclusion recorded)?", "DO-254 6.1.1(1); 6.1.2(1,2)", ["Derived not validated", "No validation data"], "A validation method or conclusion is recorded for each derived requirement."),
      item("Are safety requirements from the PSSA identified with their design assurance level?", "DO-254 5.1.2(2)", ["Safety requirement without DAL", "Invalid DAL"], "Safety-related requirements carry a valid DAL (if a safety column was mapped; otherwise: reviewer)."),
      item("Is a verification method recorded for each requirement?", "DO-254 6.2.2(1,2)", ["No verification method"], "Each hardware requirement has a verification method."),
      reviewer("Are assumptions and design decisions that constrain later design validated as derived requirements?", "DO-254 6.1", assumed.length ? `${assumed.length} requirement${assumed.length === 1 ? "" : "s"} based on an assumption: ${assumed.slice(0, 10).join(", ")}. Reviewer to confirm each is validated.` : "No assumption found in the text or the assumption column. Reviewer to confirm."),
      reviewer("Are derived requirements correct and complete with respect to the allocated system requirements, and evaluated for safety impact?", "DO-254 6.1.2(3,4,5)", "Reviewer judgment."));
  }
  if (levels.has("system")) {
    const { n, ids, total, item, reviewer } = make(["system"], "System (ARP4754A / ARP4761A)");
    const assumed = ids("Based on an assumption");
    list.push(
      item("Is each system requirement uniquely identified and identifiable as a requirement?", "ARP4754A 5.4.3a(2); 5.4.7.2a", ["Missing ID", "Duplicate ID", "Empty text", "No \"shall\""], `All ${total} system requirements are identified and stated as requirements.`),
      item("Is each requirement unambiguous, single and verifiable, with specific tolerances?", "ARP4754A 5.4.3a(1,9,10,13)", ["Ambiguous or open term", "Compound requirement", "Value without unit", "No tolerance", "Negative requirement"], "No ambiguous terms, compound statements or values without tolerance found."),
      item("Does each requirement state what and how well, rather than how?", "ARP4754A 5.4.3a(7)", ["Possible design detail"], "No design-solution wording found."),
      item("Is the requirement set free of redundant requirements?", "ARP4754A 5.4.3a(3)", ["Duplicate text"], "No duplicate requirement texts."),
      item("Is the source of each requirement identified?", "ARP4754A 5.4.3a(12); 5.4.7.2b", ["Source not identified", "Broken trace link"], "Each requirement has a source, a parent or is derived (if a source column was mapped)."),
      item("Do derived requirements have a rationale and were they reviewed for safety impact?", "ARP4754A 5.3.1.4; 5.4.3a(11)", ["Derived without rationale"], `${n("Derived requirement")} derived system requirements, each with a rationale. Confirm the safety review.`),
      item("Is a validation method and conclusion recorded for each requirement (validation matrix)?", "ARP4754A 5.4.6; 5.4.7.2", ["No validation method", "Not yet validated", "No validation data"], "Each system requirement has a validation method and a valid conclusion."),
      item("Do safety requirements carry a development assurance level and are they allocated to items?", "ARP4761A 3.5; ARP4754A 5.4.7.2d", ["Safety requirement without DAL", "Safety requirement not allocated", "Invalid DAL"], "Safety requirements have a valid DAL and are allocated (if a safety column was mapped; otherwise: reviewer)."),
      item("Is every system requirement allocated to software or hardware requirements?", "ARP4754A 5.3; 5.4.4", ["Not developed further", "Safety requirement not allocated"], "Every system requirement is developed by software or hardware requirements."),
      reviewer("Are assumptions explicitly stated, disseminated and justified?", "ARP4754A 5.4.2d", assumed.length ? `${assumed.length} requirement${assumed.length === 1 ? "" : "s"} based on an assumption: ${assumed.slice(0, 10).join(", ")}. Reviewer to confirm each is justified and tracked to resolution.` : "No assumption found in the text or the assumption column. Reviewer to confirm."),
      reviewer("Is the requirement set complete (all requirement types, modes and lifecycle phases)?", "ARP4754A 5.4.4", "Reviewer judgment, for example against the requirement types of ARP4754A 5.3.1."),
      reviewer("Does the requirement set reflect the safety analyses (FHA / PSSA)?", "ARP4754A 5.4.3d; ARP4761A 3.5", "Reviewer judgment against the FHA and PSSA."));
  }
  return list;
}
