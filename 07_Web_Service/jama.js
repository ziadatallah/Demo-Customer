/**
 * Jama Connect (Jama Software) requirements import — v5.3.29.
 *
 * Reads requirements and their relationships out of Jama Connect so the Import tab can review them and put them
 * into ISAF documents. Read-only: nothing is written back to Jama in this phase.
 *
 * What it produces is deliberately the same shape as a requirements file read by requirements_import.py
 * ({format, objects, relations, specifications, attributes, count}), so the Import tab's level and column
 * mapping, the review, the Excel report and Update documents all work on a Jama pull with no change: one
 * "specification" per Jama item type, Jama field labels as the column names, and the Jama relationships as
 * the trace links.
 *
 * API (Jama's REST reference, rest.jamasoftware.com, confirmed 10 November 2026):
 *  - Base address <instance>/rest/v1 (Jama Cloud: https://<company>.jamacloud.com/rest/v1; self-hosted often
 *    https://<host>/contour/rest/v1). /rest/latest also exists; ISAF asks for the version the owner entered.
 *  - Sign-in: OAuth client credentials (POST /rest/oauth/token, Basic client id and secret,
 *    grant_type=client_credentials, access token valid about an hour, no refresh token), or Basic
 *    authentication with a user name and password, which Jama does not allow with single sign-on.
 *  - GET /projects, GET /itemtypes, GET /projects/{id}/itemtypes, GET /items?project=,
 *    GET /abstractitems?project=&itemType= (the only way to ask for one item type), GET /relationships?project=,
 *    GET /picklists/{id}/options. Paging is startAt and maxResults, at most 50 a page, and the answer carries
 *    meta.pageInfo {startIndex, resultCount, totalResults}.
 *  - Jama throttles above about 10 requests a second (HTTP 429) and asks for a growing wait; RETRY_WAITS
 *    follows the waits Jama's own guidance suggests.
 *
 * Credentials never go in the repository: they are kept by the server that uses them (the Admin app on the
 * owner's computer, or the customer's own app), with the secret write-only — it is never sent back to a browser.
 */

export const MAX_PAGE = 50;                               // Jama's documented maximum page size
export const RETRY_WAITS = [3000, 5000, 8000, 13000];     // the waits Jama's guidance suggests for 429
export const DEFAULT_MAX_ITEMS = 20000;
export const REQUEST_TIMEOUT_MS = 60000;

const text = (v, max = 400) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
// Named HTML entities seen in requirement text: the basics, then the symbols, units and Greek letters that
// engineering requirements actually use. Anything else is left as written rather than guessed at.
const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", shy: "",
  plusmn: "±", minus: "−", times: "×", divide: "÷", lowast: "∗", sdot: "⋅", middot: "·", bull: "•",
  le: "≤", ge: "≥", ne: "≠", equiv: "≡", asymp: "≈", cong: "≅", prop: "∝", infin: "∞", radic: "√",
  sum: "∑", prod: "∏", int: "∫", part: "∂", nabla: "∇", plusmnsign: "±", permil: "‰", percnt: "%",
  deg: "°", micro: "µ", ohm: "Ω", acute: "´", prime: "′", Prime: "″", sup1: "¹", sup2: "²", sup3: "³",
  frac12: "½", frac14: "¼", frac34: "¾", frac13: "⅓", frac23: "⅔",
  mdash: "—", ndash: "–", horbar: "―", hellip: "…", lsquo: "‘", rsquo: "’", sbquo: "‚",
  ldquo: "“", rdquo: "”", bdquo: "„", laquo: "«", raquo: "»", dagger: "†", Dagger: "‡", sect: "§", para: "¶",
  larr: "←", rarr: "→", uarr: "↑", darr: "↓", harr: "↔", rArr: "⇒", hArr: "⇔",
  copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", yen: "¥", cent: "¢", curren: "¤",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", iota: "ι",
  kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", sigmaf: "ς", tau: "τ",
  upsilon: "υ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Alpha: "Α", Beta: "Β", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Pi: "Π", Sigma: "Σ", Phi: "Φ",
  Psi: "Ψ", Omega: "Ω", agrave: "à", aacute: "á", auml: "ä", eacute: "é", egrave: "è", euml: "ë", iacute: "í",
  oacute: "ó", ouml: "ö", uacute: "ú", uuml: "ü", ccedil: "ç", ntilde: "ñ", szlig: "ß", aring: "å", oslash: "ø", ae: "æ",
};

/** Jama rich-text fields are HTML. Keep the words, the line breaks and the list items; drop the markup. */
export function htmlToText(value) {
  let s = String(value ?? "");
  if (!/[<&]/.test(s)) return s.trim();
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/tr)\s*\/?>/gi, "\n");
  s = s.replace(/<\s*li[^>]*>/gi, "\n• ").replace(/<\s*\/\s*(li|td|th)\s*>/gi, " ");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, name) => {
    if (ENTITIES[name] !== undefined) return ENTITIES[name];
    const key = name.toLowerCase();
    if (ENTITIES[key] !== undefined) return ENTITIES[key];
    if (/^#x/i.test(name)) { const n = Number.parseInt(name.slice(2), 16); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    if (/^#/.test(name)) { const n = Number.parseInt(name.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return m;
  });
  return s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").split("\n").map(l => l.trim()).join("\n").trim();
}

/** The address of a Jama REST service, as the owner or customer entered it. */
export function normalizeBaseUrl(input, { allowHttp = false } = {}) {
  const raw = text(input, 500);
  if (!raw) { const e = new Error("Enter the address of your Jama Connect REST service."); e.status = 400; throw e; }
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { const e = new Error("That does not look like a web address."); e.status = 400; throw e; }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname);
  if (url.protocol !== "https:" && !(allowHttp && local)) { const e = new Error("The Jama address must start with https:// so the credentials are not sent in the clear."); e.status = 400; throw e; }
  let base = `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  if (!/\/rest(\/(v\d+|latest))?$/i.test(base)) base += "/rest/v1";   // a bare site address gets the usual path
  else if (/\/rest$/i.test(base)) base += "/v1";
  return base;
}

/** Field names Jama gives custom fields carry the item type id, as in verification_method$42. */
export const plainFieldName = name => String(name ?? "").replace(/\$\d+$/, "");

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------
export function createJamaClient({ baseUrl, auth = {}, fetchImpl = globalThis.fetch, log = () => {}, allowHttp = false, sleep = ms => new Promise(r => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  const base = normalizeBaseUrl(baseUrl, { allowHttp });
  const origin = new URL(base).origin;
  const mode = auth.mode === "basic" ? "basic" : "oauth";
  let token = null, tokenExpires = 0;

  const fail = (message, status = 502, extra = {}) => Object.assign(new Error(message), { status, ...extra });

  /** An OAuth access token, kept until a minute before it expires. */
  async function accessToken() {
    if (token && now() < tokenExpires - 60000) return token;
    const id = text(auth.clientId, 200), secret = String(auth.clientSecret ?? "");
    if (!id || !secret) throw fail("Enter the Jama API client ID and secret (your Jama user profile creates them).", 400);
    const response = await fetchImpl(`${origin}/rest/oauth/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 401) throw fail("Jama refused the API client ID or secret.", 401);
    if (!response.ok) throw fail(`Jama did not give an access token (it answered ${response.status}).`);
    const body = await response.json().catch(() => ({}));
    if (!body?.access_token) throw fail("Jama did not give an access token.");
    token = String(body.access_token);
    tokenExpires = now() + (Number(body.expires_in) || 3600) * 1000;
    return token;
  }

  async function headers() {
    if (mode === "basic") {
      const user = text(auth.username, 200), password = String(auth.password ?? "");
      if (!user || !password) throw fail("Enter the Jama user name and password, or use an API client ID and secret.", 400);
      return { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` };
    }
    return { Authorization: `Bearer ${await accessToken()}` };
  }

  /** One GET, with Jama's throttling and a short outage waited out rather than passed on. */
  async function get(route, params = {}) {
    const url = new URL(base + "/" + String(route).replace(/^\//, ""));
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetchImpl(url, { headers: { Accept: "application/json", ...(await headers()) }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (error) {
        if (attempt < RETRY_WAITS.length) { log(`[ISAF Jama] ${route}: ${error.message}; waiting ${RETRY_WAITS[attempt] / 1000}s`); await sleep(RETRY_WAITS[attempt]); continue; }
        throw fail(`ISAF could not reach Jama at ${origin} (${error.message}).`, 504);
      }
      if ((response.status === 429 || response.status >= 500) && attempt < RETRY_WAITS.length) {
        log(`[ISAF Jama] ${route}: Jama answered ${response.status}; waiting ${RETRY_WAITS[attempt] / 1000}s`);
        await sleep(RETRY_WAITS[attempt]);
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        token = null;
        throw fail(mode === "basic"
          ? "Jama refused the user name and password. A Jama site with single sign-on does not allow them: use an API client ID and secret instead."
          : "Jama refused the API client, or it may not see this project. Check the client ID and secret and the user's project access.", 401);
      }
      if (response.status === 404) throw fail(`Jama has no ${route} at ${base}. Check the service address (Jama Cloud uses https://<company>.jamacloud.com/rest/v1).`, 404);
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        let why = "";
        try { why = text(JSON.parse(body)?.meta?.message, 200); } catch { why = text(body, 200); }
        throw fail(`Jama answered ${response.status}${why ? `: ${why}` : ""}.`, response.status === 400 ? 400 : 502);
      }
      return response.json();
    }
  }

  /** Every page of a list endpoint, up to a limit, so one big project cannot fill the memory. */
  async function all(route, params = {}, { max = DEFAULT_MAX_ITEMS, onProgress } = {}) {
    const out = [];
    let startAt = 0, total = null;
    for (;;) {
      const body = await get(route, { ...params, startAt, maxResults: MAX_PAGE });
      const page = Array.isArray(body?.data) ? body.data : [];
      out.push(...page);
      const info = body?.meta?.pageInfo || {};
      total = Number(info.totalResults ?? total ?? out.length);
      onProgress?.({ read: out.length, total });
      if (!page.length || out.length >= max || (Number.isFinite(total) && out.length >= total)) break;
      startAt += page.length;
    }
    return { rows: out.slice(0, max), total: Number.isFinite(total) ? total : out.length, truncated: out.length >= max };
  }

  return {
    base, mode,
    /** Is the address and sign-in right? Asks for one project, the smallest useful request. */
    async testConnection() {
      const body = await get("projects", { maxResults: 1 });
      const count = Number(body?.meta?.pageInfo?.totalResults ?? (Array.isArray(body?.data) ? body.data.length : 0));
      const first = Array.isArray(body?.data) ? body.data[0] : null;
      return { ok: true, base, mode, projects: count, example: first ? text(first.fields?.name || first.fields?.projectKey, 120) : "" };
    },
    async projects() {
      const { rows } = await all("projects", {}, { max: 500 });
      return rows.map(p => ({ id: p.id, name: text(p.fields?.name, 200) || `Project ${p.id}`, key: text(p.fields?.projectKey, 40), folder: p.isFolder === true }))
        .filter(p => !p.folder).sort((a, b) => a.name.localeCompare(b.name));
    },
    /** The item types in one project, with their fields, so the Import tab can offer real column names. */
    async itemTypes(projectId) {
      const id = Number.parseInt(projectId, 10);
      if (!Number.isFinite(id)) throw fail("Choose a Jama project.", 400);
      const { rows } = await all(`projects/${id}/itemtypes`, {}, { max: 500 });
      return rows.map(t => ({
        id: t.id, key: text(t.typeKey, 40), name: text(t.display, 120) || text(t.typeKey, 40) || `Type ${t.id}`,
        plural: text(t.displayPlural, 120), category: text(t.category, 60),
        fields: (Array.isArray(t.fields) ? t.fields : []).map(f => ({ name: text(f.name, 120), label: text(f.label, 160) || plainFieldName(f.name), type: text(f.fieldType, 40), picklist: f.pickList ?? null })),
      })).sort((a, b) => a.name.localeCompare(b.name));
    },

    /**
     * Read the items of the chosen item types, with their relationships, as one import source per item type.
     * Returns the same shape as a requirements file, so the rest of the Import tab is unchanged.
     */
    async pull({ project, itemTypes: wanted = [], max = DEFAULT_MAX_ITEMS, onProgress = () => {} } = {}) {
      const projectId = Number.parseInt(project, 10);
      if (!Number.isFinite(projectId)) throw fail("Choose a Jama project.", 400);
      const types = await this.itemTypes(projectId);
      const chosen = wanted.length ? types.filter(t => wanted.map(Number).includes(t.id)) : types;
      if (!chosen.length) throw fail("Choose at least one Jama item type to import.", 400);

      // Pick-list options so a field shows its value ("Analysis") rather than an option number.
      const options = new Map();
      for (const list of new Set(chosen.flatMap(t => t.fields.map(f => f.picklist)).filter(v => Number.isFinite(Number(v))))) {
        try {
          const { rows } = await all(`picklists/${Number(list)}/options`, {}, { max: 500 });
          for (const o of rows) options.set(Number(o.id), text(o.name, 160));
        } catch (error) { log(`[ISAF Jama] pick list ${list} not read (${error.message})`); }
      }

      const labels = new Map();                       // field name -> the label a Jama user sees
      for (const t of chosen) for (const f of t.fields) if (f.name) labels.set(f.name, f.label || plainFieldName(f.name));
      const keyById = new Map();                      // item id -> document key, for the trace links
      const sources = [];
      let read = 0;

      for (const type of chosen) {
        onProgress({ stage: "items", type: type.name, read });
        const { rows, total, truncated } = await all("abstractitems", { project: projectId, itemType: type.id }, {
          max, onProgress: p => onProgress({ stage: "items", type: type.name, read: read + p.read, total: p.total }),
        });
        read += rows.length;
        const objects = rows.map(item => {
          const key = text(item.documentKey, 60) || String(item.id);
          keyById.set(Number(item.id), key);
          const row = {
            "(Jama ID)": String(item.id), "(Document key)": key, "(Global ID)": text(item.globalId, 60),
            "(Item type)": type.name, "(Specification)": type.name,
            "(Outline level)": String(String(item.location?.sequence || "").split(".").length || 1),
            "(Sequence)": text(item.location?.sequence, 40), "(Parent ID)": String(item.location?.parent?.item ?? ""),
            "(Last changed)": text(item.modifiedDate || item.lastActivityDate, 40),
          };
          for (const [name, value] of Object.entries(item.fields || {})) {
            const label = labels.get(name) || plainFieldName(name);
            let shown = value;
            if (value && typeof value === "object") shown = Array.isArray(value) ? value.map(v => options.get(Number(v)) ?? v).join(", ") : JSON.stringify(value);
            else if (Number.isFinite(Number(value)) && options.has(Number(value))) shown = options.get(Number(value));
            row[label] = htmlToText(shown).slice(0, 20000);
          }
          return row;
        });
        sources.push({ type, objects, total, truncated });
      }

      // Relationships for the whole project, turned into document-key pairs the review understands.
      onProgress({ stage: "relations", read });
      const relations = [];
      try {
        const typeNames = new Map();
        try { const { rows } = await all("relationshiptypes", {}, { max: 200 }); for (const r of rows) typeNames.set(Number(r.id), text(r.name, 120)); } catch { /* names are a nicety */ }
        let lastId = 0;
        for (let page = 0; page < 2000; page++) {
          const before = lastId;
          const body = await get("relationships", { project: projectId, lastId, maxResults: MAX_PAGE });
          const rows = Array.isArray(body?.data) ? body.data : [];
          if (!rows.length) break;
          for (const r of rows) {
            const from = keyById.get(Number(r.fromItem)), to = keyById.get(Number(r.toItem));
            if (from && to) relations.push({ source: from, target: to, type: typeNames.get(Number(r.relationshipType)) || "Relationship", suspect: r.suspect === true });
            lastId = Math.max(lastId, Number(r.id) || 0);
          }
          if (rows.length < MAX_PAGE || lastId === before) break;   // a service that ignores lastId must not loop
        }
      } catch (error) {
        log(`[ISAF Jama] relationships not read (${error.message})`);
        relations.length = 0;
      }

      // One import source per item type, shaped like an inspected requirements file.
      return {
        project: projectId,
        relationsRead: relations.length,
        files: sources.map(({ type, objects, total, truncated }) => {
          const attrs = new Map();
          // Jama returns a field only where it has a value, so start from the item type's own fields: a column
          // that is empty everywhere can still be mapped, and the reviewer sees it is empty.
          for (const f of type.fields) if (f.label) attrs.set(f.label, { name: f.label, filled: 0, samples: [] });
          for (const o of objects) for (const [name, value] of Object.entries(o)) {
            const a = attrs.get(name) || { name, filled: 0, samples: [] };
            if (String(value || "").trim()) { a.filled++; if (a.samples.length < 3) a.samples.push(String(value).slice(0, 120)); }
            attrs.set(name, a);
          }
          return {
            format: "jama", name: `${type.name} (Jama)`, itemTypeId: type.id, itemTypeKey: type.key,
            objects, count: objects.length, total, truncated,
            relations: relations.filter(r => objects.some(o => o["(Document key)"] === r.source) || objects.some(o => o["(Document key)"] === r.target)),
            specifications: [{ name: type.name, objects: objects.length }],
            attributes: [...attrs.values()],
          };
        }),
      };
    },
  };
}
