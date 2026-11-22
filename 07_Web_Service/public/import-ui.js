/* Import tab (v5.3.28): requirements import (ReqIF, Excel, CSV), automatic review, trace, checklist evidence and
   the error report. A review aid: the reviewer performs and signs the requirements review. Files are read on the
   server and deleted; the imported requirements stay in this page only. */
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const auth = () => (typeof authHeaders === 'function' ? authHeaders() : {});
  const store = { get: k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  // Editing documents that were already generated is an Admin capability (owner, v5.3.38). A
  // Customer app has one route for imported requirements: attach them and build. /api/import/apply
  // refuses it there as well, so this is not a hidden button.
  const adminEdition = () => (window.isafEditionInfo?.edition || document.body.dataset.edition || 'full') === 'full';
  let defaults = null, files = [], result = null, rendered = false, busy = false;
  const FIELDS = [
    ['id', 'ID', true], ['text', 'Requirement text', true], ['title', 'Title / name', false], ['heading', 'Heading (rows to skip)', false],
    ['parents', 'Traces to (parent IDs)', false], ['derived', 'Derived (yes/no)', false], ['rationale', 'Rationale', false], ['verification', 'Verification method', false],
    ['validation', 'Validation method (system, derived hardware)', false], ['validationStatus', 'Validation conclusion / status', false], ['assumption', 'Assumption (yes/no)', false], ['safety', 'Safety-related (yes/no or FHA/PSSA ref.)', false], ['dal', 'DAL (A–E)', false], ['origin', 'Source of requirement (system)', false],
    ['typeAttr', 'Object type (optional filter)', false],
    // v5.3.39: a real DOORS module usually carries the requirements of several software and
    // hardware items. Mapping a column gives each row its own item; the Item box on the card above
    // is the fallback for rows that leave it empty.
    ['item', 'Item each row belongs to', false],
  ];
  const GUESS = {
    // A DOORS "IE" export carries the visible identifier as IE PUID and has no ReqIF.ForeignID
    // at all. \bid\b does not fire inside PUID, because U is a word character, so the required
    // ID column did not map and a real DOORS file stalled at the mapping step.
    id: [/^reqif\.foreignid$/i, /^(ie )?puid$/i, /^(object identifier|req(uirement)? ?id|id|identifier|key|document key|absolute number)$/i, /\bpuid\b/i, /\bid\b/i],
    text: [/^reqif\.text$/i, /^(object text|requirement text|requirement|text|statement|description)$/i, /text|description/i],
    title: [/^reqif\.name$/i, /^(title|name|summary)$/i],
    heading: [/chaptername/i, /^(object heading|heading)$/i],
    parents: [/^(traces? ?to|parent( id| ids| requirement)?s?|satisfies|derived from|upstream|parent)$/i, /trace|parent|satisf/i],
    derived: [/^derived( requirement)?\??$/i, /derived/i],
    rationale: [/rationale|justification/i],
    verification: [/verification( method)?|verif.*method|^vm$|test method/i],
    validation: [/^validation( method)?s?$/i, /valid.*method/i],
    validationStatus: [/^validation (status|conclusion|result)$/i, /valid.*(status|conclusion|result)|^validated\??$/i],
    assumption: [/^assumption\??$/i, /assumption/i],
    safety: [/^safety( related| relevant|-related)?\??$/i, /safety|fha|pssa/i],
    dal: [/^(f|i)?dal$/i, /assurance level|\bdal\b/i],
    origin: [/^(source|origin)( of requirement)?$/i, /requirement source|^source/i],
    // IE Object Type first: in a DOORS "IE" export it is the column that distinguishes
    // requirements from headings (Capability, Function), while (ReqIF object type) holds the
    // same type name on every row and gets auto-dropped as useless.
    typeAttr: [/^ie object type$/i, /^\(reqif object type\)$/i, /^(object type|type|category|kind)$/i],
    item: [/^(item|lru|unit|software item|hardware item|subsystem|component|equipment)$/i, /^(allocated to|allocation|applies to|assigned to|owner|module)$/i, /\b(lru|subsystem|allocat)\w*/i],
  };
  const word = w => new RegExp(`(^|[^a-z])(${w})(?=[^a-z]|$)`, 'i');
  // Decide "is this a test specification?" first. Checking the requirement patterns first put
  // "Software High-Level Tests" into high-level requirements, because High-Level matched before
  // the test patterns were ever reached, and every correctly traced test then came back as a
  // finding. The name says what it is; the word "test" has to win.
  const guessLevel = name => {
    if (word('tests?|cases?|procedures?|verification|svcp|tc|hlt|llt').test(name)) {
      return word('llt|low[ _-]?level|unit|sdd').test(name) ? 'llt'
        : word('hw|hardware').test(name) ? 'hwt'
        : /(^|[^a-z])sys/i.test(name) ? 'syst'
        : 'hlt';
    }
    return /(^|[^a-z])sys/i.test(name) || word('srd').test(name) ? 'system'
      : word('llr|low[ _-]?level|sdd').test(name) ? 'llr'
      : word('hlr|high[ _-]?level|srs|swrd').test(name) ? 'hlr'
      : word('hw|hardware|hrd').test(name) ? 'hw'
      : 'hlr';
  };

  // A worked example written from the file actually loaded, because an abstract one explains
  // the words without explaining the decision. It names this file's own specifications, their
  // real counts, what ISAF will do with each, and what goes wrong if the level is set wrongly.
  const PARENT_OF = { hlr: 'a system requirement', llr: 'a high-level requirement', hw: 'a system requirement', test: 'the requirement it verifies' };
  function specExample(f, levels) {
    const entries = Object.entries(f.specLevels || {});
    if (!entries.length) return '';
    const rows = n => f.objects.filter(o => o['(Specification)'] === n).length;
    const name = lv => levels[lv] || lv;
    const sample = (programItems()[0] || {}).id || '';
    const sentence = ([sp, lv]) => {
      const where = lv === 'system' ? 'they describe the unit as a whole, so Item can stay empty'
        : `Item names the ${lv === 'hw' ? 'hardware' : 'software'} item they belong to${sample ? `, for example <code>${esc(sample)}</code>` : ''}`;
      const checked = PARENT_OF[lv] ? `, and ISAF will expect each one to trace up to ${PARENT_OF[lv]}` : '';
      return `“${esc(sp)}” holds ${rows(sp)} requirement${rows(sp) === 1 ? '' : 's'}, so Level is <b>${esc(name(lv))}</b>${checked}; ${where}.`;
    };
    const wrong = entries.find(([, lv]) => lv === 'hlr');
    const warning = wrong ? ` If you set “${esc(wrong[0])}” to <b>${esc(name('llr'))}</b> instead, ISAF would expect every one of those to trace to a high-level requirement rather than a system one, and nearly all of them would come back as findings — same file, different answer.` : '';
    return `<b>For this file:</b> ${entries.slice(0, 2).map(sentence).join(' ')}${warning}`;
  }

  function guessMapping(f) {
    const names = f.attributes.map(a => a.name), filled = n => (f.attributes.find(a => a.name === n)?.filled || 0);
    const signature = names.slice().sort().join('|'), saved = store.get('isaf_import_map:' + signature);
    if (saved) return saved;
    const m = {};
    for (const [key, patterns] of Object.entries(GUESS)) {
      for (const re of patterns) { const hit = names.filter(n => re.test(n) && filled(n)).sort((a, b) => filled(b) - filled(a))[0]; if (hit) { m[key] = hit; break; } }
    }
    if (!m.id && names.includes('(ReqIF identifier)')) m.id = '(ReqIF identifier)';
    if (m.typeAttr) {
      const values = [...new Set(f.objects.map(o => String(o[m.typeAttr] || '').trim()).filter(Boolean))];
      const req = values.filter(v => /requirement|req\b|shall/i.test(v));
      m.typeValues = req.length && req.length < values.length ? req : [];
      if (!m.typeValues.length) delete m.typeAttr;
    }
    return m;
  }
  // Bookkeeping a DOORS export always carries and ISAF deliberately leaves alone: audit
  // metadata and the columns the importer synthesizes itself. Everything else that is filled
  // but unmapped is shown to the user, because an unrecognized column is either something to
  // map or something MX Aero should be told about - never something to swallow silently.
  const KNOWN_UNUSED = [
    /^\(reqif (identifier|object type)\)$/i, /^\(specification\)$/i, /^\(outline level\)$/i,
    /^reqif\.foreign(createdby|createdon|modifiedby|modifiedon|state|deleted)$/i,
    /^reqif\.(prefix|description|category)$/i, /^ie object type$/i,
    /^(created|modified|last modified) (by|on)$/i,
  ];
  function unrecognizedColumns(f) {
    const used = new Set(Object.values(f.mapping || {}).filter(v => typeof v === 'string'));
    const sample = name => {
      const seen = [];
      for (const o of f.objects) {
        const v = String(o[name] ?? '').trim();
        if (v && !seen.includes(v)) { seen.push(v); if (seen.length === 2) break; }
      }
      return seen;
    };
    return f.attributes
      .filter(a => a.filled > 0 && !used.has(a.name) && !KNOWN_UNUSED.some(p => p.test(a.name)))
      .map(a => ({ name: a.name, filled: a.filled, samples: sample(a.name) }));
  }

  // Program items (configuration loaded on the Build tab): an imported file belongs to one software or hardware
  // item, so its requirements go into that item's documents.
  function programItems() {
    const c = typeof configData !== 'undefined' ? configData : null;
    const m = (arr, kind) => (Array.isArray(arr) ? arr : []).map(x => ({ id: String(x?.id || ''), name: String(x?.name || x?.id || ''), kind })).filter(x => x.id);
    return c ? [...m(c.software_items, 'sw'), ...m(c.hardware_items, 'hw'), ...m(c.systems, 'sys')] : [];
  }
  function defaultItem(level) {
    if (level === 'system') return '';
    const of = programItems().filter(i => i.kind === (level === 'hw' ? 'hw' : 'sw'));
    return of.length === 1 ? of[0].id : '';
  }
  function typeValues(f) { return f.mapping.typeAttr ? [...new Set(f.objects.map(o => String(o[f.mapping.typeAttr] || '').trim()).filter(Boolean))].slice(0, 30) : []; }

  async function api(url, opts = {}) {
    const r = await fetch(url, { ...opts, headers: { ...auth(), ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Request failed (${r.status}).`);
    return d;
  }

  function shell() {
    const host = $('importHost'); if (!host) return;
    host.innerHTML = `<style>
      .imp-card{border:1px solid var(--border,#dde3ea);border-radius:10px;padding:.8rem 1rem;margin:.7rem 0;background:var(--surface,#fff);}
      /* A connector panel says which tool it is, in the summary and again once open. */
      .imp-tool{border-left:4px solid #2f5496;}
      .imp-tool-name{font-size:1.02rem;}
      .imp-tool-heading{margin:.1rem 0 .5rem;font-size:1rem;color:#2f5496;}
      .imp-head{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;justify-content:space-between;}
      .imp-map{display:grid;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr));gap:.5rem .8rem;margin-top:.6rem;}
      /* The level names carry the abbreviation engineers use, so the column has to be wide
         enough to show it: a truncated "Software high-level requirements (HLR…" helps nobody. */
      .imp-spec{grid-column:span 2;border:1px solid var(--border,#dde3ea);border-radius:8px;padding:.55rem .7rem;background:#fbfcfe;display:flex;flex-direction:column;gap:.4rem;}
      .imp-spec-name{font-weight:600;}
      .imp-spec label{display:flex;flex-direction:column;gap:.15rem;font-size:.88rem;}
      .imp-spec select{min-width:20rem;}
      .imp-example{background:#f1f6fb;border-left:3px solid #2f5496;padding:.5rem .7rem;border-radius:0 6px 6px 0;}
      .imp-unrecognized{margin-top:.6rem;font-size:.86rem;background:#fff8e7;border:1px solid #e3c766;border-radius:6px;padding:.55rem .75rem;}
      .imp-unrecognized ul{margin:.35rem 0 0;padding-left:1.2rem;}
      .imp-unrecognized code{background:#f6ecd4;padding:.05rem .3rem;border-radius:3px;}
      .imp-deleted{color:#875c13;}
      .imp-map label{display:flex;flex-direction:column;font-size:.85rem;gap:.2rem;}
      .imp-map select,.imp-map input{font:inherit;padding:.3rem .4rem;}
      .imp-totals{display:flex;gap:.7rem;flex-wrap:wrap;margin:.6rem 0;}
      .imp-totals div{border:1px solid var(--border,#dde3ea);border-radius:8px;padding:.5rem .8rem;min-width:8rem;}
      .imp-totals b{display:block;font-size:1.4rem;}
      .imp-err b{color:#b3261e}.imp-warn b{color:#8a5a00}
      .imp-table{width:100%;border-collapse:collapse;font-size:.86rem;margin:.4rem 0;}
      .imp-table th,.imp-table td{border:1px solid var(--border,#dde3ea);padding:.3rem .45rem;text-align:left;vertical-align:top;}
      .imp-table th{background:#1f3a5f;color:#fff;}
      .imp-sev-Error{background:#f8d7da}.imp-sev-Warning{background:#fff3cd}.imp-sev-Info{background:#e7f1ff}
      .imp-filters{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin:.4rem 0;}
      .imp-scroll{overflow-x:auto;}
      .imp-status-Findings{color:#b3261e;font-weight:600}.imp-status-No\\ findings{color:#1e6b34;font-weight:600}.imp-status-Reviewer{color:#5a6b7e;font-weight:600}
    </style>
    <section class="build-section"><span class="build-section-title">Import requirements</span>
      <p class="hint">Add the requirements files exported from your requirements tool (ReqIF from DOORS, Polarion or Jama) or kept in Excel/CSV: system requirements, software high-level and low-level requirements, hardware requirements and verification cases. ISAF checks them against common requirements-standard rules and the DO-178C review criteria, builds the trace, and prepares the evidence for the review checklist. It eases the manual work; the reviewer performs and signs the review. Files are read and deleted; nothing is kept on the server. <a href="help/connect-requirements-tool.html" target="_blank" rel="noopener">What the file should look like, and connecting a requirements tool</a>.</p>
      <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;"><button type="button" id="impAdd">Add requirements files…</button><input type="file" id="impFile" accept=".reqif,.reqifz,.xml,.xlsx,.xlsm,.csv" multiple hidden><span class="hint" id="impStatus" role="status"></span></div>
      <div id="impTools"></div>
      <div id="impFiles"></div>
      <details class="imp-card" id="impOptions"><summary><b>Review options</b></summary><div id="impOptionsBody"></div></details>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;"><button type="button" id="impRun" disabled>Run review</button><button type="button" class="secondary" id="impReport" disabled>Download error report (Excel)</button></div>
    </section>
    <div id="impResults"></div>
    <section class="build-section hidden" id="impDocs"><span class="build-section-title">Use these requirements in your documents</span>
      <p class="hint">A build writes the reviewed requirements into the documents as it generates them. HLR, LLR, hardware requirements (HRD) and system requirements (REQ-Sys) get a requirements table and a derived-requirements (or downward trace) table; Trace gets the trace matrix and a gap register; SVCP gets the verification cases; the PR-SWRD, PR-SDD, PR-HRD and Sys-SRR review checklists get evidence in Finding / Notes. Pass / Fail stays with the reviewer. Each file goes to the documents of its Item, and a later import replaces this content while anything you wrote outside it is kept.</p>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;">
        <button type="button" id="impLinkSave">Use these requirements in every build</button>
        <button type="button" class="secondary hidden" id="impLinkClear">Stop using them</button>
      </div>
      <p class="hint" id="impLinkStatus" role="status"></p>
      ${adminEdition() ? `<details class="imp-card" id="impDocsManual"><summary><b>Documents that were already generated</b></summary>
        <p class="hint">For documents you already have, when you want to change <b>only</b> the requirements tables in them. A build regenerates the whole document from the current configuration, so everything else in it moves on too; this edits the blocks marked "ISAF import" and leaves the rest of the document exactly as it was issued. It is also the only route for documents that are not in a repository to rebuild into.</p>
        <p class="hint" id="impDocsMode" style="margin-top:.55rem;font-weight:600;"></p>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;">
          <button type="button" id="impDocsFolder" class="hidden">Update documents in working folder</button>
          <button type="button" class="secondary hidden" id="impDocsChooseFolder">Choose working folder…</button>
          <button type="button" class="secondary" id="impDocsFiles">Choose documents (ZIP back)…</button>
          <button type="button" class="secondary" id="impDocsDir">Choose a folder of documents (ZIP back)…</button>
          <input type="file" id="impDocsFilesInput" accept=".docx" multiple hidden><input type="file" id="impDocsDirInput" webkitdirectory multiple hidden>
        </div>
        <p class="hint" id="impDocsStatus" role="status"></p>
      </details>` : ''}
    </section>
    <datalist id="impItemList"></datalist>`;
    $('impAdd').onclick = () => $('impFile').click();
    $('impFile').onchange = e => { const list = [...(e.target.files || [])]; e.target.value = ''; addFiles(list); };
    // A customer licensed only for a live tool connection gets no file import, and the other way round.
    const caps=window.isafImportCapabilities;
    if(Array.isArray(caps)&&caps.length&&window.isafFileImport!==true){
      $('impAdd').classList.add('hidden');
      $('impAdd').insertAdjacentHTML('afterend','<p class="hint">Importing requirements from a ReqIF, Excel or CSV file is not part of this ISAF license. MX Aero can add it.</p>');
    }
    loadTools();
    $('impRun').onclick = run;
    $('impReport').onclick = downloadReport;
    $('impLinkSave').onclick = attachToBuilds;
    $('impLinkClear').onclick = detachFromBuilds;
    // The whole block is absent outside the Admin app, so every control in it is optional here.
    if (adminEdition()) {
      $('impDocsFolder').onclick = updateFolder;
      $('impDocsChooseFolder').onclick = async () => { try { await window.workingFolder.choose(); } catch (e) { if (e?.name !== 'AbortError') $('impDocsStatus').textContent = e.message; } };
      $('impDocsFiles').onclick = () => $('impDocsFilesInput').click();
      $('impDocsDir').onclick = () => $('impDocsDirInput').click();
      for (const id of ['impDocsFilesInput', 'impDocsDirInput']) $(id).onchange = e => { const list = [...(e.target.files || [])]; e.target.value = ''; updateZip(list); };
    }
    window.workingFolder?.onChange(h => {
      const ok = window.workingFolder.supported();
      const folderButton = $('impDocsFolder'); if (!folderButton) return;
      folderButton.classList.toggle('hidden', !h); $('impDocsChooseFolder').classList.toggle('hidden', !ok || !!h);
      if (h) folderButton.textContent = `Update documents in "${h.name}"`;
      renderDocsMode();
    });
    renderDocsMode();
    renderOptions();
    loadLinkState();
    rendered = true;
  }

  function renderOptions() {
    const o = { ...(defaults?.options || {}), ...(store.get('isaf_import_options') || {}) };
    $('impOptionsBody').innerHTML = `<div class="imp-map">
      <label><span><input type="checkbox" data-opt="requireShall" ${o.requireShall ? 'checked' : ''}> Each requirement uses "shall"</span></label>
      <label><span><input type="checkbox" data-opt="singleShall" ${o.singleShall ? 'checked' : ''}> One "shall" per requirement</span></label>
      <label><span><input type="checkbox" data-opt="checkUnits" ${o.checkUnits ? 'checked' : ''}> Numeric values need units</span></label>
      <label><span><input type="checkbox" data-opt="requireVerification" ${o.requireVerification ? 'checked' : ''}> Verification method required</span></label>
      <label><span><input type="checkbox" data-opt="requireRationaleForDerived" ${o.requireRationaleForDerived ? 'checked' : ''}> Derived requirements need a rationale</span></label>
      <label><span><input type="checkbox" data-opt="checkTolerance" ${o.checkTolerance ? 'checked' : ''}> Measured values need a tolerance (hardware, system)</span></label>
      <label><span><input type="checkbox" data-opt="designDetail" ${o.designDetail ? 'checked' : ''}> Flag possible design solutions (hardware, system)</span></label>
      <label>Flag requirements longer than (words)<input type="number" min="0" max="500" data-opt="maxWords" value="${esc(o.maxWords ?? 60)}"></label></div>
      <label style="display:block;margin-top:.6rem;font-size:.85rem;">Ambiguous or open terms (one per line; from your requirements standard)<textarea data-opt="ambiguous" rows="5" style="width:100%;font:inherit;">${esc((o.ambiguous || []).join('\n'))}</textarea></label>
      <button type="button" class="secondary" id="impOptReset">Restore defaults</button>`;
    $('impOptionsBody').oninput = $('impOptionsBody').onchange = () => store.set('isaf_import_options', readOptions());
    $('impOptReset').onclick = () => { store.set('isaf_import_options', null); renderOptions(); };
  }
  function readOptions() {
    const o = {};
    for (const el of document.querySelectorAll('#impOptionsBody [data-opt]')) {
      const k = el.dataset.opt;
      o[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) || 0 : k === 'ambiguous' ? el.value.split('\n').map(x => x.trim()).filter(Boolean) : el.value;
    }
    return o;
  }

  async function addFiles(list) {
    for (const file of list) {
      $('impStatus').textContent = `Reading ${file.name}…`;
      try {
        const fd = new FormData(); fd.append('file', file, file.name);
        const d = await api('/api/import/inspect', { method: 'POST', body: fd });
        const specName = d.specifications?.length === 1 ? d.specifications[0].name : '';
        const f = { uid: Math.random().toString(36).slice(2), name: d.name, format: d.format, objects: d.objects, relations: d.relations || [], attributes: d.attributes, specifications: d.specifications || [], deleted: d.deleted || 0, level: guessLevel(file.name + ' ' + specName) };
        f.mapping = guessMapping(f);
        if (f.specifications.length > 1) f.specLevels = Object.fromEntries(f.specifications.map(sp => [sp.name, guessLevel(sp.name)]));
        f.item = defaultItem(f.level);
        if (f.specLevels) f.specItems = Object.fromEntries(Object.entries(f.specLevels).map(([sp, lv]) => [sp, defaultItem(lv)]));
        files.push(f);
        $('impStatus').textContent = `${file.name}: ${d.count} rows read.`;
      } catch (e) { $('impStatus').textContent = e.message; }
    }
    renderFiles();
  }

  // ---------------------------------------------------------------- requirements tools
  // Jama Connect and Siemens Polarion are read straight into the list above: each item type (Jama) or work
  // item type (Polarion) becomes one source, with the tool's own field names as its columns and the tool's
  // links as its trace links, so everything below (level, mapping, review, report, Update documents) works
  // exactly as it does for a file. Read-only: ISAF writes nothing back. The connection is kept by the server
  // and the secret never comes back to this page. One panel serves every tool, from /api/tools.
  let tools = [], conns = [], connFile = '';
  const tState = {};   // per tool: {connection, projects, project, types, chosen, query}
  const st = id => (tState[id] ||= { connection: '', projects: [], project: '', types: [], chosen: [], query: '' });
  const tSay = (id, m) => { const el = $(`impTool_${id}_status`); if (el) el.textContent = m; };
  const modeOf = (tool, id) => tool.modes.find(m => m.id === id) || tool.modes[0];

  async function loadTools() {
    try { const d = await api('/api/tools'); tools = d.tools || []; conns = d.connections || []; connFile = d.file || ''; }
    catch { tools = []; }
    const host = $('impTools'); if (!host) return;
    // Rebuilding the list must not shut a panel the person is working in, so whatever was open stays open.
    const wasOpen = new Set([...host.querySelectorAll(':scope > details')].filter(d => d.open).map(d => d.id));
    // The tool's own name leads, because two connector panels look alike once open and the owner
    // has to be able to tell at a glance which one he is in.
    host.innerHTML = tools.map(t => `<details class="imp-card imp-tool" id="impTool_${t.id}"><summary><b class="imp-tool-name">${esc(t.label)}</b>${t.vendor ? ` <span class="hint">${esc(t.vendor)}</span>` : ''} <span class="hint">— read requirements through its API</span></summary><div id="impTool_${t.id}_body"><h4 class="imp-tool-heading">${esc(t.label)}</h4><p class="hint">Loading…</p></div></details>`).join('');
    for (const t of tools) {
      const panel = $(`impTool_${t.id}`);
      // A toggle event is delivered later, not while open is being set, so re-opening a panel here would
      // redraw it a second time and wipe whatever the caller is about to report. Mark that one and skip it.
      if (wasOpen.has(panel.id)) { panel.dataset.reopened = '1'; panel.open = true; await renderTool(t.id); }
      panel.addEventListener('toggle', e => {
        if (!e.target.open) return;
        if (panel.dataset.reopened) { delete panel.dataset.reopened; return; }
        renderTool(t.id);
      });
    }
  }

  async function renderTool(id) {
    const tool = tools.find(t => t.id === id); const body = $(`impTool_${id}_body`); if (!tool || !body) return;
    const s = st(id);
    const mine = conns.filter(c => c.tool === id);
    if (!s.connection) s.connection = mine[0]?.id || '';
    const c = mine.find(x => x.id === s.connection) || null;
    const mode = modeOf(tool, c?.mode);
    const tested = c?.lastTest ? `Last test ${new Date(c.lastTest.at).toLocaleString()}: ${c.lastTest.ok ? `worked, ${c.lastTest.projects} project${c.lastTest.projects === 1 ? '' : 's'} visible` : 'failed'}.` : '';
    body.innerHTML = `<h4 class="imp-tool-heading">${esc(tool.label)}</h4>
      <p class="hint">ISAF reads the requirements of a ${esc(tool.label)} project through its API, with the credentials your ${esc(tool.label)} administrator provides. It only reads: nothing in ${esc(tool.label)} is changed. A large project takes a few minutes. <a href="help/connect-requirements-tool.html" target="_blank" rel="noopener">What you need, step by step</a>.</p>
      ${mine.length ? `<div class="imp-map">
        <label>Connection<select data-t="conn" data-tool="${id}">${mine.map(x => `<option value="${esc(x.id)}" ${x.id === s.connection ? 'selected' : ''}>${esc(x.name)}${x.fromEnvironment ? ' (set on the server)' : ''}</option>`).join('')}</select></label>
        <label>Project<select data-t="project" data-tool="${id}">${s.projects.length ? s.projects.map(p => `<option value="${esc(String(p.id))}" ${String(p.id) === String(s.project) ? 'selected' : ''}>${esc(p.name)}${p.key && p.key !== p.name ? ` (${esc(p.key)})` : ''}</option>`).join('') : '<option value="">— load the projects first —</option>'}</select></label>
       </div>
       <p class="hint">${esc(c?.baseUrl || '')} · ${esc(mode.label)}${tested ? ` · ${esc(tested)}` : ''}</p>
       <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin:.4rem 0;">
         <button type="button" class="secondary" data-t="test" data-tool="${id}">Test connection</button>
         <button type="button" data-t="load" data-tool="${id}">Load projects</button>
         ${s.types.length ? `<button type="button" data-t="pull" data-tool="${id}">Read requirements</button>` : ''}
         <span class="hint" id="impTool_${id}_status" role="status"></span>
       </div>
       ${s.types.length ? `<div class="imp-map">${s.types.map(t => `<label style="flex-direction:row;align-items:center;gap:.4rem;"><input type="checkbox" value="${esc(String(t.id))}" data-t="type" data-tool="${id}" ${s.chosen.map(String).includes(String(t.id)) ? 'checked' : ''}> ${esc(t.name)} <span class="hint">${esc(t.key && t.key !== t.name ? t.key : '')}${t.seen ? ` ${t.seen} seen` : ''}</span></label>`).join('')}</div>
       <p class="hint">${esc(tool.groupHelp || '')}${s.types[0]?.sampled ? ` ISAF read the first ${s.types[0].sampled} work items of ${s.types[0].projectTotal} to find these types; a type used only further down may be missing, and the search below can reach it.` : ''}</p>
       <label>Extra search (optional)<input data-t="query" data-tool="${id}" value="${esc(s.query)}" placeholder="${id === 'polarion' ? 'status:approved AND severity:must_have' : 'not used for this tool'}" ${id === 'polarion' ? '' : 'disabled'}></label>` : ''}`
      : `<p class="hint">No ${esc(tool.label)} connection is set up yet. Add one below.</p>`}
      <details class="imp-card" data-t="setup" ${mine.length ? '' : 'open'}><summary>${esc(tool.label)} connection settings</summary>
        <div class="imp-map">
          <label>Name<input data-t="name" data-tool="${id}" value="${esc(c?.fromEnvironment ? '' : c?.name || '')}" placeholder="${esc(tool.label)}"></label>
          <label>Service address<input data-t="url" data-tool="${id}" value="${esc(c?.fromEnvironment ? '' : c?.baseUrl || '')}" placeholder="${esc(tool.addressExample)}"></label>
          ${tool.modes.length > 1 ? `<label>Sign in with<select data-t="mode" data-tool="${id}">${tool.modes.map(m => `<option value="${esc(m.id)}" ${m.id === mode.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>` : ''}
          ${mode.fields.map(f => `<label>${esc(f.label)}<input data-t="field" data-field="${esc(f.key)}" data-tool="${id}" ${f.secret ? 'type="password"' : ''} autocomplete="off" value="${esc(f.secret ? '' : c?.values?.[f.key] || '')}" placeholder="${esc(f.secret && c?.hasSecret ? 'kept on this server — leave empty to keep it' : f.help || '')}"></label>`).join('')}
        </div>
        <p class="hint">${esc(tool.addressHelp || '')} ${mode.help ? esc(mode.help) : ''} Kept by this ISAF server only (${esc(connFile)}, readable by its owner), outside the app folder so an app update does not lose it, and never sent back to this page. A server can supply it instead through ${esc((tool.environment || []).slice(0, 2).join(', '))}, which a hosted site should use.</p>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;"><button type="button" data-t="save" data-tool="${id}">Save connection</button>${c && !c.fromEnvironment ? `<button type="button" class="secondary" data-t="remove" data-tool="${id}">Remove</button>` : ''}<span class="hint" data-t="setupStatus" data-tool="${id}" role="status"></span></div>
      </details>`;
    wireTool(id);
  }

  function wireTool(id) {
    const tool = tools.find(t => t.id === id), s = st(id), body = $(`impTool_${id}_body`);
    const pick = what => body.querySelector(`[data-t="${what}"]`);
    const setupStatus = m => { const el = pick('setupStatus'); if (el) el.textContent = m; };
    pick('mode')?.addEventListener('change', () => renderTool(id));
    pick('conn')?.addEventListener('change', e => { Object.assign(s, { connection: e.target.value, projects: [], project: '', types: [], chosen: [] }); renderTool(id); });
    pick('project')?.addEventListener('change', async e => { s.project = e.target.value; s.types = []; s.chosen = []; await loadTypes(id); });
    pick('query')?.addEventListener('change', e => { s.query = e.target.value; });
    pick('save')?.addEventListener('click', async () => {
      const mode = modeOf(tool, pick('mode')?.value);
      const values = {};
      for (const el of body.querySelectorAll('[data-t="field"]')) values[el.dataset.field] = el.value;
      const current = conns.find(x => x.id === s.connection);
      try {
        const saved = await api('/api/tools/connections', { method: 'PUT', body: JSON.stringify({ tool: id, id: current?.fromEnvironment ? '' : current?.id || '', name: pick('name').value.trim(), baseUrl: pick('url').value.trim(), mode: mode.id, values }) });
        s.connection = saved.id; s.projects = []; s.types = [];
        await loadTools(); setupStatus('Saved.');
      } catch (e) { setupStatus(e.message); }
    });
    pick('remove')?.addEventListener('click', async () => {
      const current = conns.find(x => x.id === s.connection);
      if (!current || !confirm(`Remove the connection "${current.name}"? The requirements already imported are not affected.`)) return;
      try { await api(`/api/tools/connections/${encodeURIComponent(current.id)}`, { method: 'DELETE' }); Object.assign(s, { connection: '', projects: [], project: '', types: [], chosen: [] }); await loadTools(); }
      catch (e) { setupStatus(e.message); }
    });
    pick('test')?.addEventListener('click', async () => {
      tSay(id, `Asking ${tool.label}…`);
      try { const r = await api(`/api/tools/connections/${encodeURIComponent(s.connection)}/test`, { method: 'POST' }); await loadTools(); tSay(id, `${tool.label} answered: ${r.projects} project${r.projects === 1 ? '' : 's'} visible${r.example ? `, for example ${r.example}` : ''}.`); }
      catch (e) { tSay(id, e.message); }
    });
    pick('load')?.addEventListener('click', async () => {
      tSay(id, 'Reading the projects…');
      try {
        const r = await api(`/api/tools/connections/${encodeURIComponent(s.connection)}/projects`);
        s.projects = r.projects || [];
        if (!s.projects.length) return tSay(id, `This ${tool.label} user sees no project. Ask the ${tool.label} administrator for read access to the project.`);
        s.project = s.projects[0].id;
        await loadTypes(id);
      } catch (e) { tSay(id, e.message); }
    });
    pick('pull')?.addEventListener('click', () => pullTool(id));
    for (const box of body.querySelectorAll('[data-t="type"]')) box.onchange = () => { s.chosen = [...body.querySelectorAll('[data-t="type"]:checked')].map(b => b.value); };
  }

  async function loadTypes(id) {
    const tool = tools.find(t => t.id === id), s = st(id);
    tSay(id, `Reading the ${(tool.groupLabel || 'item type').toLowerCase()}s…`);
    try {
      const r = await api(`/api/tools/connections/${encodeURIComponent(s.connection)}/itemtypes?project=${encodeURIComponent(s.project)}`);
      s.types = r.itemTypes || [];
      s.chosen = s.types.filter(t => /requirement|spec|test|verification|case/i.test(`${t.name} ${t.key}`)).map(t => String(t.id));
      await renderTool(id);
      tSay(id, `${s.types.length} ${(tool.groupLabel || 'type').toLowerCase()}s. ${s.chosen.length ? 'The requirement types are ticked.' : 'Choose the types to import.'}`);
    } catch (e) { tSay(id, e.message); }
  }

  async function pullTool(id) {
    const tool = tools.find(t => t.id === id), s = st(id);
    if (!s.chosen.length) return tSay(id, 'Tick at least one type.');
    tSay(id, `Reading the requirements from ${tool.label}. A large project takes a few minutes…`);
    try {
      const r = await api(`/api/tools/connections/${encodeURIComponent(s.connection)}/pull`, { method: 'POST', body: JSON.stringify({ project: s.project, itemTypes: s.chosen, query: s.query }) });
      const project = s.projects.find(p => String(p.id) === String(s.project));
      let added = 0, truncated = false;
      for (const d of r.files || []) {
        if (!d.objects?.length) continue;
        const f = { uid: Math.random().toString(36).slice(2), name: `${d.name}${project ? ` — ${project.name}` : ''}`, format: d.format || id,
          objects: d.objects, relations: d.relations || [], attributes: d.attributes || [], specifications: d.specifications || [], deleted: d.deleted || 0, level: guessLevel(d.name) };
        f.mapping = guessMapping(f);
        // Engineers know an item by its key (VC-SYS-12 or WI-42), not by an internal number.
        if (d.objects[0]?.['(Document key)'] !== undefined) f.mapping.id = '(Document key)';
        f.item = defaultItem(f.level);
        files.push(f); added += d.objects.length; truncated = truncated || d.truncated === true;
      }
      renderFiles();
      tSay(id, added ? `${added} requirements read from ${tool.label} in ${r.files.filter(f => f.objects?.length).length} type${r.files.length === 1 ? '' : 's'}, with ${r.relationsRead} link${r.relationsRead === 1 ? '' : 's'} as trace links. Check the level and the columns below, then run the review.${truncated ? ' Not every item was read: the project is larger than one import.' : ''}`
        : 'Those types hold no items.');
    } catch (e) { tSay(id, e.message); }
  }


  function renderFiles() {
    const levels = defaults?.levels || {};
    $('impFiles').innerHTML = files.map(f => {
      // Each option carries one real value from that column. Without it the lists are 24 names with
      // nothing to tell them apart, and the only way to find the right column is to open the file.
      const sample = a => {
        if (!a.filled) return ' (empty)';
        const v = (a.samples || []).map(x => String(x).replace(/\s+/g, ' ').trim()).find(Boolean);
        return v ? ` — ${v.length > 30 ? v.slice(0, 30) + '…' : v}` : '';
      };
      const opts = ['<option value="">— not used —</option>', ...f.attributes.map(a => `<option value="${esc(a.name)}">${esc(a.name)}${esc(sample(a))}</option>`)].join('');
      const tv = typeValues(f);
      return `<div class="imp-card" data-uid="${f.uid}"><div class="imp-head"><div><b>${esc(f.name)}</b> <span class="hint">${esc(f.format.toUpperCase())} · ${f.objects.length} rows${f.relations.length ? ` · ${f.relations.length} links` : ''}${f.specifications.length > 1 ? ` · ${f.specifications.length} specifications` : ''}${f.deleted ? ` · <span class="imp-deleted">${f.deleted} deleted in DOORS, not imported</span>` : ''}</span></div>
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">${f.specLevels ? '' : `<label title="The software or hardware item these requirements belong to; they go into that item's documents. Used for rows whose Item column is empty, or for every row when no Item column is mapped. Leave empty when they apply to all items.">Item <input data-f="item" list="impItemList" placeholder="All items" value="${esc(f.item || '')}" style="width:10rem;"></label>`}${f.specLevels ? '' : `<label>Level <select data-f="level">${Object.entries(levels).map(([k, v]) => `<option value="${k}" ${f.level === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`}<button type="button" class="secondary" data-f="remove">Remove</button></div></div>
        ${f.specLevels ? '' : `<p class="hint imp-level-help"><b>Level</b> is where these requirements sit in the certification hierarchy, and it decides which trace checks run: high-level requirements (DO-178C 5.1) are expected to trace up to system requirements, low-level requirements (DO-178C 5.2) to high-level ones, hardware requirements (DO-254) to system requirements, and verification cases to whatever they verify. Labeling a file as the wrong level changes every trace finding. <b>Item</b> is the LRU, software item or hardware item whose documents these belong in; leave it empty when they apply to every item.</p>`}
        ${f.specLevels ? `<div class="imp-map"><span class="hint" style="grid-column:1/-1;">This file holds several specifications, so each one gets its own level and item instead of one setting for the whole file. <b>Level</b> decides which trace checks run against that specification: high-level requirements (DO-178C 5.1) are expected to trace up to system requirements, low-level requirements (DO-178C 5.2) to high-level ones, hardware requirements (DO-254) to system requirements, and verification cases to whatever they verify. <b>Item</b> is the LRU, software item or hardware item whose documents those requirements belong in. Set a specification to “not imported” to leave it out.</span>
          <span class="hint imp-example" style="grid-column:1/-1;">${specExample(f, levels)}</span>
          ${Object.entries(f.specLevels).map(([sp, lv]) => `<div class="imp-spec"><div class="imp-spec-name">${esc(sp)} <span class="hint">${f.objects.filter(o => o['(Specification)'] === sp).length} requirements</span></div><label>Level <select data-spec="${esc(sp)}">${Object.entries(levels).map(([k, v]) => `<option value="${k}" ${lv === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}<option value="" ${lv === '' ? 'selected' : ''}>— not imported —</option></select></label><label>Item <input data-spec-item="${esc(sp)}" list="impItemList" placeholder="All items" value="${esc(f.specItems?.[sp] || '')}" title="The software or hardware item of this specification; its requirements go into that item's documents."></label></div>`).join('')}</div>` : ''}
        <div class="imp-map"><span class="hint" style="grid-column:1/-1;">Each box asks <b>which column of your file</b> holds that field, so every list shows the same ${f.attributes.length} columns with one of their values beside each. ISAF fills in the names it recognizes; leave a field on <i>not used</i> when your file has no column for it. Only ID and Requirement text are required.</span>
        ${FIELDS.map(([k, label, req]) => `<label>${esc(label)}${req ? ' *' : ''}<select data-map="${k}">${opts}</select></label>`).join('')}
        ${tv.length ? `<label>Keep only these object types<select data-map="typeValues" multiple size="${Math.min(5, tv.length)}">${tv.map(v => `<option value="${esc(v)}" ${(f.mapping.typeValues || []).includes(v) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>` : ''}</div>
        ${(u => u.length ? `<div class="imp-unrecognized"><b>Columns ISAF did not recognize.</b> <span class="hint">They feed no check and no document. If one belongs in a field above, pick it there; otherwise tell MX Aero what it is, so a future version can map it automatically.</span><ul>${u.map(c => `<li><code>${esc(c.name)}</code> <span class="hint">${c.filled} of ${f.objects.length} filled${c.samples.length ? ` — e.g. ${c.samples.map(s => `“${esc(s.length > 42 ? s.slice(0, 42) + '…' : s)}”`).join(', ')}` : ''}</span></li>`).join('')}</ul></div>` : '')(unrecognizedColumns(f))}
        <p class="hint" data-f="preview"></p></div>`;
    }).join('');
    for (const card of document.querySelectorAll('#impFiles .imp-card')) {
      const f = files.find(x => x.uid === card.dataset.uid);
      for (const sel of card.querySelectorAll('select[data-map]')) if (sel.dataset.map !== 'typeValues') sel.value = f.mapping[sel.dataset.map] || '';
      card.addEventListener('change', e => {
        const t = e.target;
        if (t.dataset.f === 'level') { f.level = t.value; if (!f.itemTouched) { f.item = defaultItem(f.level); card.querySelector('[data-f="item"]').value = f.item; } }
        if (t.dataset.f === 'item') { f.item = t.value.trim(); f.itemTouched = true; }
        if (t.dataset.spec !== undefined) { f.specLevels[t.dataset.spec] = t.value; const inp = card.querySelector(`[data-spec-item="${CSS.escape(t.dataset.spec)}"]`); if (inp && !inp.dataset.touched) { inp.value = f.specItems[t.dataset.spec] = defaultItem(t.value); } }
        if (t.dataset.specItem !== undefined) { f.specItems[t.dataset.specItem] = t.value.trim(); t.dataset.touched = '1'; }
        if (t.dataset.map === 'typeValues') f.mapping.typeValues = [...t.selectedOptions].map(o => o.value);
        else if (t.dataset.map) { f.mapping[t.dataset.map] = t.value || undefined; if (t.dataset.map === 'typeAttr') { f.mapping.typeValues = []; renderFiles(); return; } }
        store.set('isaf_import_map:' + f.attributes.map(a => a.name).sort().join('|'), f.mapping);
        preview(card, f); result = null; renderResults();
      });
      card.querySelector('[data-f="remove"]').onclick = () => { files = files.filter(x => x !== f); result = null; renderFiles(); renderResults(); };
      preview(card, f);
    }
    $('impRun').disabled = !files.length || busy;
  }
  function preview(card, f) {
    const first = f.objects.find(o => f.mapping.text && String(o[f.mapping.text] || '').trim());
    const p = card.querySelector('[data-f="preview"]');
    if (!f.mapping.id || !f.mapping.text) { p.textContent = 'Choose the ID and Requirement text columns.'; return; }
    p.innerHTML = first ? `Example: <b>${esc(first[f.mapping.id] || '(no ID)')}</b> ${esc(String(first[f.mapping.text]).slice(0, 200))}${f.mapping.parents && first[f.mapping.parents] ? ` <i>→ ${esc(first[f.mapping.parents])}</i>` : ''}` : 'No row has text in the chosen column.';
  }

  async function run() {
    if (busy) return;
    const missing = files.filter(f => !f.mapping.id || !f.mapping.text);
    if (missing.length) { $('impStatus').textContent = `Choose the ID and Requirement text columns for ${missing.map(f => f.name).join(', ')}.`; return; }
    busy = true; $('impRun').disabled = true; $('impRun').textContent = 'Reviewing…';
    try {
      result = await api('/api/import/review', { method: 'POST', body: JSON.stringify({ files: files.flatMap(f => f.specLevels
        ? Object.entries(f.specLevels).filter(([, lv]) => lv).map(([sp, lv]) => ({ name: `${f.name} / ${sp}`, level: lv, item: f.specItems?.[sp] || '', mapping: f.mapping, objects: f.objects.filter(o => o['(Specification)'] === sp), relations: f.relations }))
        : [{ name: f.name, level: f.level, item: f.item, mapping: f.mapping, objects: f.objects, relations: f.relations }]), options: readOptions(), items: programItems().map(i => i.id), program: (typeof configData !== 'undefined' && configData?.program?.name) || '' }) });
      $('impStatus').textContent = `Review complete: ${result.totals.requirements} requirements.`;
    } catch (e) { $('impStatus').textContent = e.message; result = null; }
    finally { busy = false; $('impRun').disabled = !files.length; $('impRun').textContent = 'Run review'; renderResults(); }
  }

  let filter = { severity: '', level: '', text: '' };
  function renderResults() {
    const host = $('impResults'); if (!host) return;
    $('impReport').disabled = !result;
    $('impDocs').classList.toggle('hidden', !result);
    renderLinkState();
    if (!result) { host.innerHTML = ''; return; }
    const t = result.totals;
    host.innerHTML = `<section class="build-section"><span class="build-section-title">Review results</span>
      <div class="imp-totals"><div><b>${t.requirements}</b>requirements</div><div class="imp-err"><b>${t.errors}</b>errors</div><div class="imp-warn"><b>${t.warnings}</b>warnings</div><div><b>${t.info}</b>notes</div></div>
      <div class="imp-scroll"><table class="imp-table"><thead><tr><th>Level</th><th>Requirements</th><th>Errors</th><th>Warnings</th><th>Traced to parent</th><th>Developed further</th><th>With tests</th></tr></thead><tbody>${result.stats.map(s => `<tr><td>${esc(s.label)}</td><td>${s.requirements}</td><td>${s.errors}</td><td>${s.warnings}</td><td>${esc(s.tracedText || '—')}</td><td>${esc(s.childrenText || '—')}</td><td>${esc(s.testsText || '—')}</td></tr>`).join('')}</tbody></table></div>
      <h4>Review checklist evidence</h4><p class="hint">Objective questions are answered from the checks; questions that need engineering judgment are marked Reviewer. The reviewer confirms every answer.</p>
      <div class="imp-scroll"><table class="imp-table"><thead><tr><th>Area</th><th>Review question</th><th>Reference</th><th>Result</th><th>Evidence</th></tr></thead><tbody>${result.checklist.map(c => `<tr><td>${esc(c.area || '')}</td><td>${esc(c.question)}</td><td>${esc(c.ref)}</td><td class="imp-status-${esc(c.status)}">${esc(c.status)}</td><td>${esc(c.evidence)}</td></tr>`).join('')}</tbody></table></div>
      <h4>Findings</h4><div class="imp-filters"><select id="impFSev"><option value="">All severities</option><option>Error</option><option>Warning</option><option>Info</option></select><select id="impFLevel"><option value="">All levels</option>${result.stats.map(s => `<option value="${s.level}">${esc(s.label)}</option>`).join('')}</select><input type="search" id="impFText" placeholder="Search ID, check or text"><span class="hint" id="impFCount"></span></div>
      <div class="imp-scroll" id="impFindings"></div></section>`;
    $('impFSev').value = filter.severity; $('impFLevel').value = filter.level; $('impFText').value = filter.text;
    const apply = () => { filter = { severity: $('impFSev').value, level: $('impFLevel').value, text: $('impFText').value.trim().toLowerCase() }; renderFindings(); };
    $('impFSev').onchange = $('impFLevel').onchange = apply; $('impFText').oninput = apply;
    renderFindings();
  }
  function renderFindings() {
    const list = result.findings.filter(f => (!filter.severity || f.severity === filter.severity) && (!filter.level || f.level === filter.level) && (!filter.text || `${f.reqId} ${f.check} ${f.message} ${f.text}`.toLowerCase().includes(filter.text)));
    $('impFCount').textContent = `${list.length} of ${result.findings.length}${list.length > 300 ? ' (first 300 shown; the Excel report has all)' : ''}`;
    $('impFindings').innerHTML = list.length ? `<table class="imp-table"><thead><tr><th>Severity</th><th>Requirement</th><th>Check</th><th>Finding</th><th>Text</th><th>Reference</th></tr></thead><tbody>${list.slice(0, 300).map(f => `<tr><td class="imp-sev-${esc(f.severity)}">${esc(f.severity)}</td><td>${esc(f.reqId)}<br><span class="hint">${esc(f.levelLabel)}</span></td><td>${esc(f.check)}</td><td>${esc(f.message)}</td><td>${esc(String(f.text).slice(0, 220))}</td><td>${esc(f.ref)}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No findings match.</p>';
  }

  async function downloadReport() {
    if (!result) return;
    const b = $('impReport'), label = b.textContent; b.disabled = true; b.textContent = 'Preparing…';
    try {
      const r = await fetch('/api/import/report', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'The report could not be prepared.');
      const name = (r.headers.get('Content-Disposition') || '').match(/filename="?([^";]+)"?/)?.[1] || 'ISAF_Requirements_Check.xlsx';
      const url = URL.createObjectURL(await r.blob()), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { $('impStatus').textContent = e.message; }
    finally { b.disabled = false; b.textContent = label; }
  }

  // ------------------------------------------------------------ Requirements used by every build
  // Before v5.3.38 an import ended here, and the owner had to hand the generated documents back to
  // "Update documents" after every build. Attaching the review is now the normal path: a build
  // writes the requirements into the documents it generates, so there is nothing to do afterwards.
  //
  // The attached review is held twice on purpose. The copy in this browser is sent with the build,
  // which is the only route a hosted trial has (it keeps nothing between sessions). The copy saved
  // with the program covers the builds this browser does not start: a background build, a build
  // from another browser or user, and the API.
  const LINK_KEY = 'isaf_import_link';
  let linkState = { storable: true, reason: '', link: null };
  const linkProgramId = () => String(window.repoUI?.current()?.id || '');
  const localLink = () => { const l = store.get(LINK_KEY); return l?.review?.requirements?.length ? l : null; };
  // meta.sources carries one entry per specification ("file.reqif / Software High-Level Requirements"),
  // so printing it whole repeats the file name once per specification. The file names are the part
  // worth naming here; the specifications are listed above, in the file cards.
  const sourceFiles = list => [...new Set((list || []).map(x => String(x).split(' / ')[0].trim()).filter(Boolean))];
  const namedSources = list => { const f = sourceFiles(list); return !f.length ? 'this import' : f.length <= 2 ? f.join(' and ') : `${f.slice(0, 2).join(', ')} and ${f.length - 2} more`; };

  async function loadLinkState() {
    try {
      const r = await fetch('/api/import/link?programId=' + encodeURIComponent(linkProgramId()), { headers: auth() });
      if (r.ok) linkState = await r.json();
    } catch {}
    renderLinkState();
  }
  function renderLinkState() {
    const save = $('impLinkSave'), clear = $('impLinkClear'), status = $('impLinkStatus');
    if (!save) return;
    const local = localLink(), saved = linkState.link;
    const attached = local || saved;
    save.textContent = attached ? 'Replace the requirements used in builds' : 'Use these requirements in every build';
    save.disabled = !result;
    clear.classList.toggle('hidden', !attached);
    if (!attached) { status.textContent = result ? 'Nothing is attached yet, so a build generates documents without these requirements.' : ''; return; }
    const parts = [];
    if (local) parts.push(`${local.review.requirements.length} requirements from ${namedSources(local.sources)} are attached in this browser and are sent with every build you start here.`);
    if (saved) parts.push(`Saved with the program on ${saved.savedAt.slice(0, 10)}${saved.actor ? ` by ${saved.actor}` : ''}: ${saved.requirements} requirements. Background builds, other users and the API use this copy.`);
    else if (!linkState.storable) parts.push(linkState.reason || 'This app keeps nothing between sessions, so the requirements are held in this browser only.');
    else if (local && !linkProgramId()) parts.push('Choose a repository program in the Build tab to save them with the program as well, so background builds and other users get them too.');
    status.textContent = parts.join(' ');
  }
  async function attachToBuilds() {
    if (!result) return;
    const review = { ...result, meta: { ...(result.meta || {}) } };
    store.set(LINK_KEY, { review, sources: review.meta.sources || [], savedAt: new Date().toISOString() });
    const programId = linkProgramId();
    if (linkState.storable && programId) {
      try {
        const r = await fetch('/api/import/link', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ programId, review }) });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw Error(body.error || 'The requirements could not be saved with the program.');
        linkState.link = body.link;
      } catch (error) { $('impLinkStatus').textContent = `Attached in this browser. Not saved with the program: ${error.message}`; renderLinkState(); return; }
    }
    renderLinkState();
  }
  async function detachFromBuilds() {
    store.set(LINK_KEY, null);
    const programId = linkProgramId();
    if (linkState.link && programId) {
      try { await fetch('/api/import/link', { method: 'DELETE', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ programId }) }); } catch {}
      linkState.link = null;
    }
    renderLinkState();
  }
  // Read by the Build tab: what to send with a build, and what to tell the owner before one starts.
  window.isafRequirements = {
    attached: () => { const l = localLink(); return l && { requirements: l.review.requirements.length, sources: sourceFiles(l.sources), savedAt: l.savedAt || '' }; },
    forBuild: () => localLink()?.review || null,
    reload: () => loadLinkState(),
  };

  // What this block will actually do, said before the owner clicks. With a working folder it is one
  // click and the documents are rewritten where they are; without one the browser cannot write into
  // a folder, so a ZIP comes back and the files have to be put back by hand. Which of the two you
  // get was previously discoverable only by clicking.
  function renderDocsMode() {
    const line = $('impDocsMode'); if (!line) return;
    const wf = window.workingFolder, name = wf?.name?.() || '';
    if (name) line.textContent = `Working folder "${name}": one click rewrites the documents in that folder in place. The previous copies and the import report are kept with the program on the ISAF server (Admins see them in Program Documents → Support records), so the folder holds documents only.`;
    else if (wf?.supported?.()) line.textContent = 'Choose a working folder and this becomes one click, with the documents rewritten where they are. Without one the updated documents come back as a ZIP that you unpack and put back yourself.';
    else line.textContent = 'This browser cannot write into a folder (Chrome or Edge can), so the updated documents come back as a ZIP that you unpack and put back yourself. Where a rebuild is possible, it is less work.';
  }

  // ------------------------------------------------------------ Update documents already generated
  const targets = () => new Set(defaults?.documents || []);
  async function applyBatch(docs, zip) {
    const fd = new FormData();
    fd.append('review', JSON.stringify(result));
    fd.append('paths', JSON.stringify(docs.map(d => d.path)));
    // The replaced copies and the report are kept with the loaded program's register (support record).
    const program = window.repoUI?.current?.();
    if (program?.id) { fd.append('programId', program.id); fd.append('actor', window.repoUI.actor()); fd.append('title', 'Import update: requirements tables'); }
    for (const d of docs) fd.append('documents', d.file, d.file.name);
    const r = await fetch('/api/import/apply' + (zip ? '?format=zip' : ''), { method: 'POST', headers: auth(), body: fd });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `The documents could not be updated (${r.status}).`);
    return zip ? r : r.json();
  }
  // Batches keep each request well under upload limits.
  function batches(docs, maxFiles = 40, maxBytes = 60 * 1024 * 1024) {
    const out = []; let cur = [], size = 0;
    for (const d of docs) { if (cur.length && (cur.length >= maxFiles || size + d.file.size > maxBytes)) { out.push(cur); cur = []; size = 0; } cur.push(d); size += d.file.size; }
    if (cur.length) out.push(cur);
    return out;
  }
  async function updateFolder() {
    const wf = window.workingFolder, st = $('impDocsStatus'), b = $('impDocsFolder');
    if (!result || !wf?.handle) return;
    if (!(await wf.ready())) { st.textContent = 'ISAF needs your permission to use the working folder. Select the button again and allow access.'; return; }
    b.disabled = true;
    try {
      st.textContent = `Looking for ISAF documents in "${wf.name()}"…`;
      const want = targets(), found = [];
      for (const d of await wf.documents()) { const id = await wf.identity(d.file); if (id && want.has(id.doc)) found.push({ path: d.path, file: await d.file.arrayBuffer().then(buf => new File([buf], d.file.name)) }); }
      if (!found.length) { st.textContent = `No ISAF documents that take requirements (${[...want].join(', ')}) were found in "${wf.name()}". Build SOI 2 and SOI 3 into the working folder first.`; return; }
      const results = []; let report = '', kept = true;
      for (const [i, group] of batches(found).entries()) { st.textContent = `Updating documents (${Math.min((i + 1) * 40, found.length)} of ${found.length})…`; const r = await applyBatch(group, false); results.push(...r.results); report += (report ? '\n' : '') + r.report; if (!r.recordKept && r.results.some(x => x.changed)) kept = false; }
      const changed = results.filter(r => r.changed);
      const bin = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      // Kept on the server: no _ISAF_backup copy and no report in the folder. Otherwise (no program register) as before.
      const saved = await wf.writeFiles([...changed.map(r => ({ path: r.name, data: bin(r.data) })), ...(kept ? [] : [{ path: 'Import_Report.txt', data: report }])], { kept: kept || null });
      const skipped = results.filter(r => !r.changed);
      st.innerHTML = `${esc(changed.length)} document${changed.length === 1 ? '' : 's'} updated in "${esc(wf.name())}"${saved.backup ? `; previous versions in ${esc(saved.backup)}` : ''}.${kept ? ' The previous copies and the report are kept with the program (Program Documents → Support records).' : ' Details: Import_Report.txt in the folder.'}${skipped.length ? ` ${skipped.length} not changed (${esc([...new Set(skipped.map(r => r.skipped))].slice(0, 3).join('; '))}).` : ''}${saved.failed.length ? ` <b>${saved.failed.length} could not be written</b> (close them in Word and try again): ${esc(saved.failed.map(f => f.path).join(', '))}.` : ''}`;
    } catch (e) { st.textContent = e.message; }
    finally { b.disabled = false; }
  }
  async function updateZip(list) {
    const st = $('impDocsStatus');
    const docs = list.filter(f => /\.docx$/i.test(f.name) && !f.name.startsWith('~$')).map(f => ({ path: f.webkitRelativePath || f.name, file: f }));
    if (!result || !docs.length) { st.textContent = 'Choose Word documents (.docx) generated by ISAF.'; return; }
    try {
      st.textContent = 'Reading the documents…';
      const copies = await Promise.all(docs.map(async d => ({ path: d.path, file: new File([await d.file.arrayBuffer()], d.file.name) })));
      let filtered = copies;
      if (window.workingFolder) { filtered = []; const want = targets(); for (const d of copies) { const id = await window.workingFolder.identity(d.file); if (id && want.has(id.doc)) filtered.push(d); } }
      if (!filtered.length) { st.textContent = `None of the chosen documents takes requirements (${[...targets()].join(', ')}).`; return; }
      if (filtered.length > 300) filtered = filtered.slice(0, 300);
      st.textContent = `Updating ${filtered.length} document${filtered.length === 1 ? '' : 's'}…`;
      const r = await applyBatch(filtered, true);
      const name = (r.headers.get('Content-Disposition') || '').match(/filename="?([^";]+)"?/)?.[1] || 'ISAF_Import_Documents.zip';
      const url = URL.createObjectURL(await r.blob()), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      st.textContent = r.headers.get('X-ISAF-Record-Kept') === 'yes' ? `The updated documents are downloading as ${name}. The original copies and the report are kept with the program (Program Documents → Support records).` : `The updated documents are downloading as ${name}, with Import_Report.txt.`;
    } catch (e) { st.textContent = e.message; }
  }

  async function render() {
    if (!rendered) shell();
    const dl = $('impItemList'); if (dl) dl.innerHTML = programItems().map(i => `<option value="${esc(i.id)}">${esc(i.name)} (${i.kind === 'sw' ? 'software' : i.kind === 'hw' ? 'hardware' : 'system'})</option>`).join('');
    if (!defaults) { try { defaults = await api('/api/import/defaults'); renderOptions(); renderFiles(); } catch (e) { $('impStatus').textContent = e.message; } }
  }
  window.importUI = { render, state: () => ({ files, result }) };
})();
