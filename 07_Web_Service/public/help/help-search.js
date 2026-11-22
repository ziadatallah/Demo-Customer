// Search box for the Help and instruction pages (User Guide, Web App Guide, Connecting your
// requirements tool, and the Admin-only setup and architecture pages). Each page includes it with
// <script src="help-search.js" defer>. Release Notes has its own search, built into that page.
//
// A page is split into sections at its h2 headings. Typing shows only the sections that contain
// every word typed, highlights the matches, and Enter / Shift+Enter (or the arrows) step through
// them. Escape or Clear shows the whole page again.
(function () {
  'use strict';
  const firstH2 = [...document.querySelectorAll('h2')].find(h => !h.closest('nav, header, footer'));
  if (!firstH2) return;
  const container = firstH2.parentElement;

  const style = document.createElement('style');
  style.textContent = `
    .hs-bar{position:sticky;top:0;z-index:5;background:#fff;display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;
      padding:.65rem 0;margin:0 0 1rem;border-bottom:1px solid #D5DDE6}
    .hs-bar input{flex:1 1 18rem;font:inherit;font-size:.95rem;padding:.45rem .7rem;border:1px solid #9fb3c8;border-radius:6px}
    .hs-bar input:focus{outline:2px solid #9fc0e6;outline-offset:1px}
    .hs-bar button{font:inherit;font-size:.9rem;padding:.4rem .75rem;border:1px solid #D5DDE6;background:#fff;border-radius:6px;cursor:pointer}
    .hs-bar button:disabled{opacity:.45;cursor:default}
    .hs-count{flex-basis:100%;color:#5B6878;font-size:.88rem;min-height:1.2em}
    .hs-hidden{display:none!important}
    mark.hs-mark{background:#FFE58A;color:#1E2A38;padding:0 .05em;border-radius:2px}
    mark.hs-mark.hs-current{background:#F5A524}
    @media print{.hs-bar{display:none}}`;
  document.head.appendChild(style);

  // Group the container's children into sections: an intro before the first h2, then one per h2.
  const skip = el => el.matches('script, style, header, footer, nav, .toolbar, .hs-bar');
  const sections = [];
  let current = { heading: null, nodes: [] };
  for (const el of container.children) {
    if (skip(el)) continue;
    if (el.tagName === 'H2') { if (current.nodes.length) sections.push(current); current = { heading: el, nodes: [] }; }
    current.nodes.push(el);
  }
  if (current.nodes.length) sections.push(current);
  const toc = [...document.querySelectorAll('nav.toc')];

  const bar = document.createElement('div');
  bar.className = 'hs-bar';
  bar.setAttribute('role', 'search');
  bar.innerHTML = '<input type="search" placeholder="Search this page" aria-label="Search this page" autocomplete="off">'
    + '<button type="button" data-hs="prev" title="Previous match (Shift+Enter)" aria-label="Previous match">&#8593;</button>'
    + '<button type="button" data-hs="next" title="Next match (Enter)" aria-label="Next match">&#8595;</button>'
    + '<button type="button" data-hs="clear">Clear</button>'
    + '<div class="hs-count" aria-live="polite"></div>';
  const anchorEl = [...container.children].find(el => !el.matches('script, style, header, .toolbar'));
  container.insertBefore(bar, anchorEl || null);
  const input = bar.querySelector('input');
  const count = bar.querySelector('.hs-count');
  const prev = bar.querySelector('[data-hs="prev"]');
  const next = bar.querySelector('[data-hs="next"]');

  let marks = [];
  let at = -1;

  function unmark() {
    document.querySelectorAll('mark.hs-mark').forEach(m => {
      const parent = m.parentNode;
      m.replaceWith(document.createTextNode(m.textContent));
      parent.normalize();
    });
    marks = []; at = -1;
  }

  function mark(root, re) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement.closest('script, style, .hs-bar') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    for (const t of texts) {
      re.lastIndex = 0;
      if (!re.test(t.data)) continue;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0, m;
      while ((m = re.exec(t.data))) {
        frag.append(t.data.slice(last, m.index));
        const k = document.createElement('mark');
        k.className = 'hs-mark';
        k.textContent = m[0];
        frag.append(k);
        last = m.index + m[0].length;
      }
      frag.append(t.data.slice(last));
      t.replaceWith(frag);
    }
  }

  function go(step) {
    if (!marks.length) return;
    if (at >= 0) marks[at].classList.remove('hs-current');
    at = (at + step + marks.length) % marks.length;
    marks[at].classList.add('hs-current');
    marks[at].scrollIntoView({ block: 'center' });
    count.textContent = `${at + 1} of ${marks.length} match${marks.length === 1 ? '' : 'es'} in ${shown} section${shown === 1 ? '' : 's'}`;
  }

  let shown = 0;
  function run() {
    unmark();
    const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const searching = words.length > 0;
    toc.forEach(n => n.classList.toggle('hs-hidden', searching));
    shown = 0;
    if (!searching) {
      sections.forEach(s => s.nodes.forEach(n => n.classList.remove('hs-hidden')));
      count.textContent = '';
      prev.disabled = next.disabled = true;
      return;
    }
    const re = new RegExp(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
    for (const s of sections) {
      const text = s.nodes.map(n => n.textContent).join(' ').toLowerCase();
      const hit = words.every(w => text.includes(w));
      s.nodes.forEach(n => n.classList.toggle('hs-hidden', !hit));
      if (hit) { shown++; s.nodes.forEach(n => mark(n, re)); }
    }
    marks = [...document.querySelectorAll('mark.hs-mark')];
    prev.disabled = next.disabled = marks.length === 0;
    if (!shown) { count.textContent = 'No section of this page matches your search.'; return; }
    count.textContent = `${marks.length} match${marks.length === 1 ? '' : 'es'} in ${shown} section${shown === 1 ? '' : 's'}`;
  }

  function clear() { input.value = ''; run(); }
  input.addEventListener('input', run);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { clear(); }
  });
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  bar.querySelector('[data-hs="clear"]').addEventListener('click', () => { clear(); input.focus(); });
  // Following a contents or in-page link while searching would land on a hidden section.
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (a && input.value) clear();
  });
  prev.disabled = next.disabled = true;
})();
