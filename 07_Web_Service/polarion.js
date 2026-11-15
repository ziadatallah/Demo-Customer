/**
 * Siemens Polarion requirements import — v5.3.29.
 *
 * Reads work items and their links out of Polarion so the Import tab can review them and put them into ISAF
 * documents. Read-only: nothing is written back to Polarion.
 *
 * Like the Jama import (jama.js), what it produces is the same shape as a requirements file read by
 * requirements_import.py, so the Import tab's level and column mapping, the review, the Excel report and
 * Update documents all work on a Polarion pull unchanged: one import source per work item type, the Polarion
 * field names as the columns, and the Polarion links as the trace links.
 *
 * API (Siemens' Polarion REST reference, developer.siemens.com/polarion, confirmed 11 November 2026):
 *  - Base address <polarion site>/polarion/rest/v1. Polarion is normally hosted by the customer.
 *  - Sign-in: a personal access token, sent as "Authorization: Bearer <token>". The person creates it in
 *    Polarion (My Account → Personal Access Tokens); it expires, so it has to be renewed. Polarion also
 *    accepts JWT and Teamcenter tokens, which ISAF does not use.
 *  - JSON:API: answers carry data[] with {type, id, attributes, relationships}, optional included[], and
 *    meta.totalCount. Paging is page[size] and page[number] (page numbers start at 1; the default size is 100
 *    and a site can cap it). Fields are chosen with fields[workitems]=..., and work items are filtered with
 *    Polarion's own query syntax, as in query=type:systemRequirement.
 *  - GET /projects, GET /projects/{projectId}/workitems, and the links of one work item at
 *    GET /projects/{projectId}/workitems/{workItemId}/linkedworkitems. A link resource's id carries the whole
 *    link: project/WI-1/role/targetProject/WI-2. ISAF first asks for the links alongside the list
 *    (include=linkedWorkItems), and only if a site does not answer that way does it ask per work item.
 */
import { htmlToText } from "./jama.js";

export const DEFAULT_PAGE = 100;
export const RETRY_WAITS = [3000, 5000, 8000, 13000];
export const DEFAULT_MAX_ITEMS = 20000;
export const REQUEST_TIMEOUT_MS = 60000;
export const SAMPLE_FOR_TYPES = 400;      // how many work items are read to find out which types a project uses

const text = (v, max = 400) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const titleCase = s => String(s || "").replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim()
  .replace(/^./, c => c.toUpperCase());

/** The address of a Polarion REST service, as a customer would type it. */
export function normalizeBaseUrl(input, { allowHttp = false } = {}) {
  const raw = text(input, 500);
  if (!raw) { const e = new Error("Enter the address of your Polarion REST service."); e.status = 400; throw e; }
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { const e = new Error("That does not look like a web address."); e.status = 400; throw e; }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname);
  if (url.protocol !== "https:" && !(allowHttp && local)) { const e = new Error("The Polarion address must start with https:// so the token is not sent in the clear."); e.status = 400; throw e; }
  let base = `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  if (/\/rest\/v\d+$/i.test(base)) return base;
  if (/\/rest$/i.test(base)) return `${base}/v1`;
  if (/\/polarion$/i.test(base)) return `${base}/rest/v1`;
  return `${base}/polarion/rest/v1`;
}

/** A link id is project/WI-1/role/targetProject/WI-2; the ends and the role come straight out of it. */
export function parseLinkId(id) {
  const parts = String(id || "").split("/");
  if (parts.length < 5) return null;
  const [project, from, role, targetProject, to] = parts;
  return { project, from, role, targetProject, to, crossProject: project !== targetProject };
}

export function createPolarionClient({ baseUrl, auth = {}, fetchImpl = globalThis.fetch, log = () => {}, allowHttp = false, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const base = normalizeBaseUrl(baseUrl, { allowHttp });
  const origin = new URL(base).origin;
  const fail = (message, status = 502) => Object.assign(new Error(message), { status });
  const token = String(auth.token ?? "");

  async function get(route, params = {}) {
    if (!token) throw fail("Enter the Polarion personal access token (Polarion creates it under My Account).", 400);
    const url = new URL(base + "/" + String(route).replace(/^\//, ""));
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetchImpl(url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (error) {
        if (attempt < RETRY_WAITS.length) { log(`[ISAF Polarion] ${route}: ${error.message}; waiting ${RETRY_WAITS[attempt] / 1000}s`); await sleep(RETRY_WAITS[attempt]); continue; }
        throw fail(`ISAF could not reach Polarion at ${origin} (${error.message}). A Polarion inside the company network is only reachable from a server on that network.`, 504);
      }
      if ((response.status === 429 || response.status >= 500) && attempt < RETRY_WAITS.length) {
        log(`[ISAF Polarion] ${route}: Polarion answered ${response.status}; waiting ${RETRY_WAITS[attempt] / 1000}s`);
        await sleep(RETRY_WAITS[attempt]);
        continue;
      }
      if (response.status === 401) throw fail("Polarion refused the personal access token. It may have expired: Polarion tokens are renewed in My Account → Personal Access Tokens.", 401);
      if (response.status === 403) throw fail("Polarion accepted the token but the user may not read this project. Ask the Polarion administrator for read access to it.", 403);
      if (response.status === 404) throw fail(`Polarion has no ${route} at ${base}. Check the address: it usually ends with /polarion/rest/v1.`, 404);
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        let why = "";
        try { const parsed = JSON.parse(body); why = text(parsed?.errors?.[0]?.detail || parsed?.errors?.[0]?.title, 200); } catch { why = text(body, 200); }
        throw fail(`Polarion answered ${response.status}${why ? `: ${why}` : ""}.`, response.status === 400 ? 400 : 502);
      }
      return response.json();
    }
  }

  /** Every page of a JSON:API list, up to a limit. Keeps the included[] resources, which carry the links. */
  async function all(route, params = {}, { max = DEFAULT_MAX_ITEMS, onProgress } = {}) {
    const rows = [], included = [];
    let total = null;
    for (let number = 1; number <= 10000; number++) {
      const body = await get(route, { ...params, "page[size]": DEFAULT_PAGE, "page[number]": number });
      const page = Array.isArray(body?.data) ? body.data : [];
      rows.push(...page);
      if (Array.isArray(body?.included)) included.push(...body.included);
      total = Number(body?.meta?.totalCount ?? total ?? rows.length);
      onProgress?.({ read: rows.length, total });
      if (page.length < DEFAULT_PAGE || rows.length >= max || (Number.isFinite(total) && rows.length >= total)) break;
    }
    return { rows: rows.slice(0, max), included, total: Number.isFinite(total) ? total : rows.length, truncated: rows.length >= max };
  }

  /** Polarion puts a work item's own id in attributes.id (WI-123); the resource id is project/WI-123. */
  const itemKey = item => text(item?.attributes?.id, 80) || String(item?.id || "").split("/").slice(1).join("/") || String(item?.id || "");

  /** Attributes are mostly plain values; custom fields arrive as a list of {key, value}. */
  function columns(item) {
    const out = {};
    const attributes = item?.attributes || {};
    for (const [name, value] of Object.entries(attributes)) {
      if (name === "customFields" || value === null || value === undefined) continue;
      let shown = value;
      if (typeof value === "object") {
        if (Array.isArray(value)) shown = value.map(v => (v && typeof v === "object" ? v.id ?? v.value ?? JSON.stringify(v) : v)).join(", ");
        else if (value.type === "text/html" || typeof value.value === "string") shown = value.value;
        else shown = JSON.stringify(value);
      }
      out[titleCase(name)] = htmlToText(shown).slice(0, 20000);
    }
    const custom = attributes.customFields;
    if (Array.isArray(custom)) {
      for (const field of custom) {
        const key = text(field?.key || field?.id, 120);
        if (!key) continue;
        let value = field?.value;
        if (value && typeof value === "object") value = value.value ?? value.id ?? JSON.stringify(value);
        out[titleCase(key)] = htmlToText(value).slice(0, 20000);
      }
    } else if (custom && typeof custom === "object") {
      for (const [key, value] of Object.entries(custom)) out[titleCase(key)] = htmlToText(value && typeof value === "object" ? value.value ?? JSON.stringify(value) : value).slice(0, 20000);
    }
    return out;
  }

  return {
    base, mode: "token",
    async testConnection() {
      const body = await get("projects", { "page[size]": 1 });
      const count = Number(body?.meta?.totalCount ?? (Array.isArray(body?.data) ? body.data.length : 0));
      const first = Array.isArray(body?.data) ? body.data[0] : null;
      return { ok: true, base, mode: "token", projects: count, example: first ? text(first.attributes?.name || first.attributes?.id, 120) : "" };
    },
    async projects() {
      const { rows } = await all("projects", {}, { max: 500 });
      return rows.map(p => ({ id: text(p.attributes?.id, 120) || String(p.id || ""), name: text(p.attributes?.name, 200) || text(p.attributes?.id, 120) || String(p.id || ""), key: text(p.attributes?.id, 60) }))
        .filter(p => p.id).sort((a, b) => a.name.localeCompare(b.name));
    },

    /**
     * Polarion has no list of the work item types a project uses, so ISAF reads a sample of the project and
     * reports the types it finds, with how many of each. The pull then asks for whole types by query.
     */
    async itemTypes(projectId) {
      const project = text(projectId, 120);
      if (!project) throw fail("Choose a Polarion project.", 400);
      const { rows, total } = await all(`projects/${encodeURIComponent(project)}/workitems`, { "fields[workitems]": "id,type,title" }, { max: SAMPLE_FOR_TYPES });
      const counts = new Map();
      for (const item of rows) {
        const type = item?.attributes?.type;
        const id = typeof type === "object" ? text(type?.id, 80) : text(type, 80);
        if (!id) continue;
        counts.set(id, (counts.get(id) || 0) + 1);
      }
      return [...counts.entries()].map(([id, seen]) => ({ id, key: id, name: titleCase(id), seen }))
        .sort((a, b) => b.seen - a.seen || a.name.localeCompare(b.name))
        .map(t => ({ ...t, sampled: rows.length, projectTotal: total }));
    },

    /** Read the work items of the chosen types, with their links, as one import source per type. */
    async pull({ project, itemTypes: wanted = [], query = "", max = DEFAULT_MAX_ITEMS, onProgress = () => {} } = {}) {
      const projectId = text(project, 120);
      if (!projectId) throw fail("Choose a Polarion project.", 400);
      const types = (Array.isArray(wanted) ? wanted : []).map(t => text(t, 80)).filter(Boolean);
      if (!types.length) throw fail("Choose at least one Polarion work item type to import.", 400);
      const extra = text(query, 300);
      const route = `projects/${encodeURIComponent(projectId)}/workitems`;

      const keyOf = new Map();            // resource id (project/WI-1) -> the work item id a person reads
      const sources = [];
      const links = [];
      let askedPerItem = false;

      let sawLinkData = false;
      for (const type of types) {
        onProgress({ stage: "items", type });
        const { rows, included, total, truncated } = await all(route, {
          query: `type:${type}${extra ? ` AND (${extra})` : ""}`,
          "fields[workitems]": "@all", "fields[linkedworkitems]": "@all", include: "linkedWorkItems",
          sort: "id",
        }, { max, onProgress: p => onProgress({ stage: "items", type, ...p }) });

        for (const item of rows) keyOf.set(String(item.id), itemKey(item));
        for (const resource of included) if (String(resource?.type) === "linkedworkitems") { links.push(resource); sawLinkData = true; }
        for (const item of rows) {
          const related = item?.relationships?.linkedWorkItems?.data;
          if (Array.isArray(related) && related.length) {
            sawLinkData = true;
            for (const r of related) if (r?.id) links.push({ id: r.id, type: "linkedworkitems" });
          }
        }
        sources.push({ type, rows, total, truncated });
      }

      // Nothing came back with the list: either this project has no links, or this site does not answer
      // include= on a list. One work item settles it, and only then is every item asked.
      if (!sawLinkData) {
        const every = sources.flatMap(s => s.rows);
        const askLinks = async item => {
          const one = await all(`${route}/${encodeURIComponent(itemKey(item))}/linkedworkitems`, { "fields[linkedworkitems]": "@all" }, { max: 200 });
          return one.rows;
        };
        try {
          const probe = every[0] ? await askLinks(every[0]) : [];
          if (probe.length) {
            askedPerItem = true;
            links.push(...probe);
            onProgress({ stage: "links", of: every.length });
            for (const [index, item] of every.slice(1, 2000).entries()) {
              links.push(...await askLinks(item));
              if (index % 25 === 0) onProgress({ stage: "links", read: index + 2, of: every.length });
            }
          }
        } catch (error) { log(`[ISAF Polarion] links not read (${error.message}); the import continues without them`); }
      }

      // The link id carries both ends and the role, so no further request is needed to build the trace.
      const seen = new Set();
      const relations = [];
      for (const link of links) {
        const parsed = parseLinkId(link?.id);
        if (!parsed) continue;
        const stamp = `${parsed.from}>${parsed.to}:${parsed.role}`;
        if (seen.has(stamp)) continue;
        seen.add(stamp);
        relations.push({
          source: parsed.from, target: parsed.to,
          type: titleCase(text(link?.attributes?.role, 80) || parsed.role),
          suspect: link?.attributes?.suspect === true,
          crossProject: parsed.crossProject || undefined,
        });
      }

      return {
        project: projectId, relationsRead: relations.length, askedPerItem,
        files: sources.map(({ type, rows, total, truncated }) => {
          const name = titleCase(type);
          const objects = rows.map(item => {
            const key = itemKey(item);
            const fields = columns(item);
            return {
              "(Document key)": key, "(Polarion ID)": key, "(Work item type)": name, "(Specification)": name,
              "(Outline level)": String(String(fields["Outline Number"] || "").split(".").filter(Boolean).length || 1),
              "(Outline number)": fields["Outline Number"] || "", "(Last changed)": fields.Updated || fields.Created || "",
              ...fields,
            };
          });
          const attrs = new Map();
          for (const o of objects) for (const [name, value] of Object.entries(o)) {
            const a = attrs.get(name) || { name, filled: 0, samples: [] };
            if (String(value || "").trim()) { a.filled++; if (a.samples.length < 3) a.samples.push(String(value).slice(0, 120)); }
            attrs.set(name, a);
          }
          const keys = new Set(objects.map(o => o["(Document key)"]));
          return {
            format: "polarion", name: `${name} (Polarion)`, itemTypeId: type, itemTypeKey: type,
            objects, count: objects.length, total, truncated,
            relations: relations.filter(r => keys.has(r.source) || keys.has(r.target)),
            specifications: [{ name, objects: objects.length }],
            attributes: [...attrs.values()],
          };
        }),
      };
    },
  };
}
