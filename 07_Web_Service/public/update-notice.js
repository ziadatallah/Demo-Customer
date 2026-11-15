/**
 * App update notice (v5.3.29) — the Customer app's "a newer ISAF is available" bar.
 *
 * Each user decides for themself, as in Microsoft Office: Get the update, Remind me later (a week) or Skip this
 * version. A Critical Update cannot be dismissed: the bar stays, counts down the days left, and once the grace
 * period has passed the app refuses to build until the update is installed (the server enforces that).
 * ISAF never replaces its own files: the bar says where to get the update and whom to contact.
 *
 * Shown only in Customer apps that were built with an update service (EDITION.json updates). Admin and Demo
 * apps have none, so nothing appears. Help → Check for Updates asks at once instead of waiting for the
 * six-hourly check.
 */
(() => {
  const $ = id => document.getElementById(id);
  const auth = () => (typeof authHeaders === 'function' ? authHeaders() : {});
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = iso => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); };
  let last = null, okTimer = 0;

  async function ask(url, options = {}) {
    const r = await fetch(url, { ...options, headers: { ...auth(), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'The update service could not be reached.');
    return body;
  }

  function hide() { $('updateNotice')?.classList.add('hidden'); }

  /** A short "you are up to date" line after Check for Updates, which disappears on its own. */
  function showOk(text) {
    const bar = $('updateNotice'); if (!bar) return;
    bar.className = 'update-notice update-notice-ok';
    bar.innerHTML = `<div class="update-notice-text">${esc(text)}</div><div class="update-notice-actions"><button type="button" class="secondary" id="updateNoticeClose">Close</button></div>`;
    $('updateNoticeClose').onclick = hide;
    clearTimeout(okTimer); okTimer = setTimeout(hide, 8000);
  }

  function render(s) {
    last = s;
    const bar = $('updateNotice'); if (!bar) return;
    if (!s?.enabled || !s.show) return hide();
    clearTimeout(okTimer);
    const critical = s.critical;
    bar.className = 'update-notice' + (critical ? ' update-notice-critical' : '');
    const where = s.download
      ? `<a href="${esc(s.download)}" target="_blank" rel="noopener" id="updateNoticeGet">Get the update</a>`
      : `<span class="update-notice-contact">${s.contact ? `Ask ${esc(s.contact)} for the update.` : 'Ask your ISAF representative for the update.'}</span>`;
    const notes = s.notes_url ? `<a href="${esc(s.notes_url)}" target="_blank" rel="noopener">What is new</a>` : '';
    const deadline = s.blocked
      ? `<b>Builds are stopped until this update is installed.</b>`
      : critical ? `Builds stop after ${esc(day(s.due))}${s.daysLeft === null ? '' : ` (${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left)`}.` : '';
    bar.innerHTML = `
      <div class="update-notice-text">
        <b>${critical ? 'Critical update' : 'Update available'}: ISAF ${esc(s.available)}</b>
        ${s.date ? `<span class="update-notice-date">released ${esc(day(s.date))}</span>` : ''}
        ${s.summary ? `<span class="update-notice-summary">${esc(s.summary)}</span>` : ''}
        ${critical ? `<span class="update-notice-must">This update affects a major function and must be installed. ${deadline}</span>` : '<span class="update-notice-summary">You can install it later; your work is not affected.</span>'}
        ${s.reachable ? '' : '<span class="update-notice-date">Shown from the last answer; the update service could not be reached just now.</span>'}
      </div>
      <div class="update-notice-actions">
        ${where}${notes}
        <button type="button" class="secondary" id="updateNoticeDone">I have installed it</button>
        ${critical ? '' : '<button type="button" class="secondary" id="updateNoticeLater">Remind me later</button><button type="button" class="secondary" id="updateNoticeSkip">Skip this version</button>'}
      </div>`;
    bar.classList.remove('hidden');
    $('updateNoticeDone').onclick = () => choose('install');
    if (!critical) {
      $('updateNoticeLater').onclick = () => choose('later');
      $('updateNoticeSkip').onclick = () => choose('skip');
    }
  }

  async function choose(action) {
    try {
      const s = await ask('/api/update/choice', { method: 'POST', body: JSON.stringify({ action }) });
      if (action === 'install') showOk(`Thank you. This notice returns if the app is still running ISAF ${s.current} the next time it is opened.`);
      else if (action === 'later') showOk('Reminder postponed for a week.');
      else showOk(`ISAF ${s.available || ''} skipped. You will be told about the next release.`.replace('  ', ' '));
      last = s;
    } catch (error) { showOk(error.message); }
  }

  /** Read the cached answer (no network) and show the bar. Not while the app is still locked. */
  async function refresh() {
    if (!$('accessCallout')?.classList.contains('hidden')) return;
    try { render(await ask('/api/update/status')); } catch { /* an app without an update service answers nothing */ }
  }

  /** Help → Check for Updates: ask the update service now. */
  async function check() {
    try {
      const s = await ask('/api/update/check', { method: 'POST' });
      if (!s.enabled) return showOk('This app has no update service: your ISAF representative tells you about new versions.');
      if (!s.available) return showOk(`ISAF ${s.current} is up to date.${s.reachable ? '' : ' (The update service could not be reached; this is the last answer it gave.)'}`);
      if (!s.show) { render({ ...s, show: true }); return; }  // asked for it, so show it even if postponed
      render(s);
    } catch (error) { showOk(error.message); }
  }

  window.updateNotice = { refresh, check, render, status: () => last };
  document.addEventListener('DOMContentLoaded', () => { setTimeout(refresh, 1200); });
})();
