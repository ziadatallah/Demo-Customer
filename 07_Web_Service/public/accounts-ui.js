// Admin app user accounts (v6.0.0): first setup of the Owner account, sign-in, the temporary-password change,
// Account → Change Password and Account → Accounts (Owner only). The server side is auth/accounts.js and
// auth/account_routes.js. In Demo apps, and Customer apps without MX Aero's seat key, /api/account/status answers
// {enabled:false} and nothing here runs.
//
// Customer apps with login accounts (owner, 22 November 2026; status.seatCodeRequired): setting up accounts is
// optional until done, from Administration → Login accounts, and needs the Admin seat code from MX Aero. The first
// account is the Customer Admin (role "owner", shown as "Admin"); the Accounts window shows the seats in use and
// takes more seat codes. One session per login: a sign-in elsewhere signs this computer out, and the sign-in
// screen says so.
(() => {
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  async function api(url, {method = 'GET', body} = {}) {
    const r = await fetch(url, {method, credentials: 'same-origin', headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = Error(data.error || 'The request failed.'); e.status = r.status; throw e; }
    return data;
  }
  const ROLE = {owner: 'Owner', admin: 'Admin', user: 'User'};
  let status = null;
  const customer = () => !!status?.seatCodeRequired;
  const roleName = r => customer() ? (r === 'user' ? 'User' : 'Admin') : ROLE[r] || 'User';
  const appName = () => customer() ? 'ISAF' : 'ISAF Admin';

  const style = document.createElement('style');
  style.textContent = `
    .acct-gate{position:fixed;inset:0;z-index:10000;background:#e9eef4;display:flex;align-items:center;justify-content:center;padding:1rem;overflow:auto}
    .acct-card{background:#fff;border:1px solid #c7d2df;border-radius:10px;box-shadow:0 8px 30px rgba(30,42,56,.12);width:min(440px,94vw);padding:1.6rem 1.7rem;box-sizing:border-box}
    .acct-card h2{margin:0 0 .3rem;font-size:1.3rem;color:#1F3A5F}
    .acct-card .acct-sub{margin:0 0 1rem;color:#5B6878;font-size:.92rem;line-height:1.45}
    .acct-form label{display:flex;flex-direction:column;gap:.3rem;font-size:.9rem;font-weight:600;color:#25364a;margin:0 0 .75rem}
    .acct-form input,.acct-form select{font:inherit;font-weight:400;height:2.4rem;padding:0 .65rem;border:1px solid #9fb3c8;border-radius:6px;width:100%;box-sizing:border-box;background:#fff}
    .acct-form .acct-hint{font-weight:400;color:#5B6878;font-size:.82rem}
    .acct-form button[type=submit]{font:inherit;font-weight:600;padding:.55rem 1.1rem;border:0;border-radius:6px;background:#1F3A5F;color:#fff;cursor:pointer;margin-top:.2rem}
    .acct-form button[type=submit]:disabled{opacity:.6;cursor:default}
    .acct-error{color:#b42318;font-size:.9rem;min-height:1.2em;margin:.2rem 0 .6rem}
    .acct-note{color:#5B6878;font-size:.84rem;margin:.9rem 0 0}
    dialog.acct-dialog{margin:auto;width:min(980px,94vw);box-sizing:border-box;border:1px solid #c7d2df;border-radius:10px;padding:1.3rem 1.4rem}
    dialog.acct-dialog.acct-small{width:min(460px,94vw)}
    .acct-dialog h3{margin:0 0 .6rem;color:#1F3A5F}
    .acct-dialog .acct-close{float:right}
    .acct-add{display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) auto;gap:.6rem;align-items:end;margin:.4rem 0 .8rem}
    .acct-add label{margin:0;justify-content:flex-end}
    .acct-add button[type=submit]{height:2.4rem;margin:0}
    .acct-table{width:100%;border-collapse:collapse;font-size:.9rem}
    .acct-table th,.acct-table td{border-bottom:1px solid #e1e7ef;padding:.45rem .5rem;text-align:left;vertical-align:middle}
    .acct-table th{background:#f4f7fa;font-weight:600}
    .acct-table td button,.acct-table td select{font:inherit;font-size:.85rem;padding:.25rem .55rem;margin-right:.3rem}
    .acct-temp{background:#fff8e1;border:1px solid #e6c46a;border-radius:6px;padding:.6rem .8rem;margin:.2rem 0 .8rem;font-size:.9rem}
    .acct-temp code{font-size:1.05rem;font-weight:700;letter-spacing:.04em;user-select:all}
    .acct-muted{color:#5B6878}
    @media(max-width:760px){.acct-add{grid-template-columns:1fr 1fr}}`;
  document.head.appendChild(style);

  // Full-screen gate (setup, sign-in, temporary password): nothing else in the app can be used until it is done.
  function gate(title, sub, fields, submitLabel, onSubmit, note = '', cancellable = false) {
    document.getElementById('acctGate')?.remove();
    const g = document.createElement('div');
    g.id = 'acctGate'; g.className = 'acct-gate'; g.setAttribute('role', 'dialog'); g.setAttribute('aria-modal', 'true'); g.setAttribute('aria-labelledby', 'acctGateTitle');
    g.innerHTML = `<div class="acct-card"><h2 id="acctGateTitle">${esc(title)}</h2><p class="acct-sub">${sub}</p>
      <form class="acct-form" novalidate>${fields}<p class="acct-error" role="alert"></p><button type="submit">${esc(submitLabel)}</button>${cancellable ? ' <button type="button" class="secondary acct-cancel">Cancel</button>' : ''}</form>
      ${note ? `<p class="acct-note">${note}</p>` : ''}</div>`;
    document.body.appendChild(g);
    const form = g.querySelector('form'), error = g.querySelector('.acct-error'), button = form.querySelector('button[type=submit]');
    g.querySelector('.acct-cancel')?.addEventListener('click', () => g.remove());
    form.addEventListener('submit', async e => {
      e.preventDefault(); error.textContent = ''; button.disabled = true;
      try { await onSubmit(Object.fromEntries(new FormData(form)), error); }
      catch (err) { error.textContent = err.message; }
      finally { button.disabled = false; }
    });
    setTimeout(() => form.querySelector('input')?.focus(), 0);
    return g;
  }
  const field = (name, label, type = 'text', extra = '', hint = '') =>
    `<label>${esc(label)}<input name="${name}" type="${type}" ${extra}>${hint ? `<span class="acct-hint">${hint}</span>` : ''}</label>`;
  const passwordHint = () => `At least ${status?.minPassword || 8} characters.`;
  function samePasswords(data) { if (data.password !== data.confirm) throw Error('The two passwords do not match.'); delete data.confirm; }

  function showSetup() {
    if (customer()) {
      gate('Set up login accounts',
        'Create the first <b>Admin</b> account of this ISAF app. You need the <b>Admin seat code</b> from MX Aero. After this, everyone signs in with their own username and password; the Admin adds accounts within the seats MX Aero has issued, and personal access keys stop working.',
        field('seatCode', 'Admin seat code from MX Aero', 'text', 'autocomplete="off" spellcheck="false" required', 'Paste the whole code; it starts with ISAF-SEAT.') +
        field('username', 'Username', 'text', 'autocomplete="username" required', 'Letters, digits, dots or dashes, for example jsmith.') +
        field('name', 'Full name', 'text', 'autocomplete="name" required') +
        field('email', 'Email (optional)', 'email', 'autocomplete="email"') +
        field('password', 'Password', 'password', 'autocomplete="new-password" required', passwordHint()) +
        field('confirm', 'Confirm password', 'password', 'autocomplete="new-password" required'),
        'Create Admin account',
        async data => { samePasswords(data); await api('/api/account/setup', {method: 'POST', body: data}); location.reload(); }, '', true);
      return;
    }
    gate('Create the Owner account',
      'This ISAF Admin has no accounts yet. The first account is the <b>Owner</b>: the Owner signs in to the Admin app and creates the accounts of other Admins.',
      field('username', 'Username', 'text', 'autocomplete="username" required', 'Letters, digits, dots or dashes, for example ziad.') +
      field('name', 'Full name', 'text', 'autocomplete="name" required') +
      field('email', 'Email (optional)', 'email', 'autocomplete="email"') +
      field('password', 'Password', 'password', 'autocomplete="new-password" required', passwordHint()) +
      field('confirm', 'Confirm password', 'password', 'autocomplete="new-password" required') +
      (status.setupCodeRequired ? field('setupCode', 'Setup code', 'text', 'autocomplete="off" required', 'Shown in the server log when ISAF starts.') : ''),
      'Create Owner account',
      async data => { samePasswords(data); await api('/api/account/setup', {method: 'POST', body: data}); location.reload(); });
  }

  function showSignIn() {
    const elsewhere = status.signedInElsewhere ? '<b>You were signed out because your account signed in on another computer.</b> One login can be used on one computer at a time. ' : '';
    gate(`Sign in to ${appName()}`, elsewhere + 'Enter your ISAF username and password.',
      field('username', 'Username', 'text', 'autocomplete="username" required') +
      field('password', 'Password', 'password', 'autocomplete="current-password" required'),
      'Sign in',
      async data => { await api('/api/account/signin', {method: 'POST', body: data}); location.reload(); },
      customer() ? 'Forgot your password? Ask your ISAF Admin to reset it.' : 'Forgot your password? Ask an Owner to reset it.');
  }

  function showMustChange() {
    gate('Choose your own password', `You signed in with a temporary password. Choose your own password to continue, ${esc(status.user.name)}.`,
      field('current', 'Temporary password', 'password', 'autocomplete="current-password" required') +
      field('password', 'New password', 'password', 'autocomplete="new-password" required', passwordHint()) +
      field('confirm', 'Confirm new password', 'password', 'autocomplete="new-password" required'),
      'Save password',
      async data => { samePasswords(data); await api('/api/account/password', {method: 'POST', body: data}); location.reload(); });
  }

  function dialog(id, title, html, small = false) {
    let d = document.getElementById(id);
    if (!d) { d = document.createElement('dialog'); d.id = id; document.body.appendChild(d); }
    d.className = 'acct-dialog' + (small ? ' acct-small' : '');
    d.innerHTML = `<button type="button" class="secondary acct-close">Close</button><h3>${esc(title)}</h3>${html}`;
    d.querySelector('.acct-close').onclick = () => d.close();
    if (!d.open) d.showModal();
    return d;
  }

  // Account → Change Password.
  function changePassword() {
    const d = dialog('acctPasswordDialog', 'Change password',
      `<form class="acct-form" novalidate>${field('current', 'Current password', 'password', 'autocomplete="current-password" required')}
       ${field('password', 'New password', 'password', 'autocomplete="new-password" required', passwordHint())}
       ${field('confirm', 'Confirm new password', 'password', 'autocomplete="new-password" required')}
       <p class="acct-error" role="alert"></p><button type="submit">Save password</button></form>`, true);
    const form = d.querySelector('form'), error = d.querySelector('.acct-error');
    form.querySelector('input').focus();
    form.onsubmit = async e => {
      e.preventDefault(); error.textContent = '';
      try { const data = Object.fromEntries(new FormData(form)); samePasswords(data); await api('/api/account/password', {method: 'POST', body: data});
        d.querySelector('form').outerHTML = '<p>Your password has been changed.</p>'; }
      catch (err) { error.textContent = err.message; }
    };
  }

  // Account → Accounts (Owner): add Admins and Owners, reset passwords, disable accounts, change roles.
  async function manageAccounts() {
    const roleChoices = customer() ? ['user', 'owner'] : ['user', 'admin', 'owner'];
    const intro = customer()
      ? 'Admins manage accounts and seats; Users work on programs. Each active account uses one seat; disabling an account frees its seat for someone else. One login can be signed in on one computer at a time. A new account gets a temporary password that the person changes at first sign-in. Account changes are recorded in the usage report. Instructions: Help → Managing Users.'
      : 'Owners manage accounts; Admins use everything else in the Admin app; Users work on programs only (no customers, demos or administration). A new account gets a temporary password that the person changes at first sign-in.';
    const d = dialog('acctManageDialog', 'Accounts',
      `<p class="acct-muted" style="margin:0 0 .6rem">${intro}</p>${customer() ? '<div id="acctSeats"></div>' : ''}
       <form class="acct-form acct-add" novalidate>
        ${field('username', 'Username', 'text', 'autocomplete="off" required')}
        ${field('name', 'Full name', 'text', 'autocomplete="off" required')}
        ${field('email', 'Email (optional)', 'email', 'autocomplete="off"')}
        <label>Role<select name="role">${roleChoices.map(r => `<option value="${r}">${roleName(r)}</option>`).join('')}</select></label>
        <button type="submit">Add account</button></form>
       <p class="acct-error" role="alert"></p><div id="acctTemp"></div><div id="acctList"><p class="acct-muted">Loading…</p></div>`);
    const error = d.querySelector('.acct-error');
    const showTemp = (username, password) => {
      d.querySelector('#acctTemp').innerHTML = `<div class="acct-temp">Temporary password for <b>${esc(username)}</b>: <code>${esc(password)}</code><br>
        Give it to the person; they choose their own password at first sign-in. It is not shown again.</div>`;
    };
    async function renderSeats() {
      if (!customer()) return;
      const seats = await api('/api/account/seats'), host = d.querySelector('#acctSeats');
      host.innerHTML = `<p style="margin:.2rem 0 .4rem"><b>Seats in use: ${seats.used} of ${seats.total}</b>${seats.used >= seats.total ? ' — all seats are in use. Disable an account, or add a seat code from MX Aero.' : ''}</p>
        <details><summary>Seat codes entered (${seats.codes.length})</summary><table class="acct-table"><thead><tr><th>Seats</th><th>Kind</th><th>Issued by MX Aero</th><th>Entered</th><th>By</th></tr></thead><tbody>${seats.codes.map(c => `<tr><td>${c.seats}</td><td>${c.admin ? 'Admin seat code' : 'Seat code'}</td><td>${esc(c.issuedAt)}</td><td>${esc(new Date(c.addedAt).toLocaleDateString())}</td><td>${esc(c.addedBy)}</td></tr>`).join('')}</tbody></table></details>
        <form class="acct-form acct-seat" novalidate style="display:flex;gap:.6rem;align-items:flex-end;margin:.5rem 0 .8rem"><label style="flex:1;margin:0">Add a seat code from MX Aero<input name="code" autocomplete="off" spellcheck="false" placeholder="ISAF-SEAT.…"></label><button type="submit" style="height:2.4rem;margin:0">Add seat code</button></form>`;
      host.querySelector('form').onsubmit = async e => {
        e.preventDefault(); error.textContent = '';
        try { await api('/api/account/seats', {method: 'POST', body: {code: new FormData(e.target).get('code')}}); await renderSeats(); }
        catch (err) { error.textContent = err.message; }
      };
    }
    async function render() {
      renderSeats().catch(err => { error.textContent = err.message; });
      const list = await api('/api/account/users');
      const me = status.user.id;
      const host = d.querySelector('#acctList');
      host.innerHTML = `<table class="acct-table"><thead><tr><th>Username</th><th>Full name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th>Actions</th></tr></thead><tbody>${list.map(a => `
        <tr data-id="${esc(a.id)}"><td>${esc(a.username)}${a.id === me ? ' <span class="acct-muted">(you)</span>' : ''}</td><td>${esc(a.name)}</td><td>${esc(a.email)}</td>
        <td><select data-act="role" aria-label="Role of ${esc(a.username)}">${roleChoices.map(r => `<option value="${r}"${a.role === r ? ' selected' : ''}>${roleName(r)}</option>`).join('')}</select></td>
        <td>${a.disabled ? 'Disabled' : a.locked ? 'Locked (wrong passwords)' : a.mustChange ? 'Temporary password' : 'Active'}</td>
        <td>${a.lastSignInAt ? esc(new Date(a.lastSignInAt).toLocaleString()) : '—'}</td>
        <td><button type="button" class="secondary" data-act="reset">Reset password</button>${a.id === me ? '' : `<button type="button" class="secondary" data-act="${a.disabled ? 'enable' : 'disable'}">${a.disabled ? 'Enable' : 'Disable'}</button>`}</td></tr>`).join('')}</tbody></table>`;
    }
    const patch = async (id, body) => api('/api/account/users/' + encodeURIComponent(id), {method: 'PATCH', body});
    d.querySelector('form').onsubmit = async e => {
      e.preventDefault(); error.textContent = ''; d.querySelector('#acctTemp').innerHTML = '';
      try { const form = e.target, data = Object.fromEntries(new FormData(form)); const r = await api('/api/account/users', {method: 'POST', body: data});
        showTemp(r.account.username, r.temporaryPassword); form.reset(); await render(); }
      catch (err) { error.textContent = err.message; }
    };
    d.querySelector('#acctList').addEventListener('click', async e => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const row = b.closest('tr'), id = row.dataset.id, username = row.cells[0].textContent.replace(' (you)', '');
      error.textContent = ''; d.querySelector('#acctTemp').innerHTML = '';
      try {
        if (b.dataset.act === 'reset') {
          if (!confirm(`Reset the password of ${username}? Their current password stops working and they are signed out.`)) return;
          const r = await patch(id, {resetPassword: true}); showTemp(username, r.temporaryPassword);
          if (id === status.user.id) { location.reload(); return; }
        } else {
          if (b.dataset.act === 'disable' && !confirm(`Disable ${username}? They are signed out and cannot sign in until enabled again.`)) return;
          await patch(id, {disabled: b.dataset.act === 'disable'});
        }
        await render();
      } catch (err) { error.textContent = err.message; await render(); }
    });
    d.querySelector('#acctList').addEventListener('change', async e => {
      const s = e.target.closest('select[data-act="role"]'); if (!s) return;
      const id = s.closest('tr').dataset.id; error.textContent = '';
      try { await patch(id, {role: s.value}); if (id === status.user.id) { location.reload(); return; } }
      catch (err) { error.textContent = err.message; }
      await render();
    });
    try { await render(); } catch (err) { error.textContent = err.message; }
  }

  async function signOut() { try { await api('/api/account/signout', {method: 'POST'}); } catch {} location.reload(); }

  // Customer apps: Administration → Login accounts (set up, or seats and Manage accounts for an Admin).
  function renderAdminBox() {
    // Help → Managing Users (Admins): only for the Customer Admin (and whoever sets up the accounts).
    $('topMenuManageUsers')?.classList.toggle('hidden', !(customer() && (status.setupNeeded || (status.user && status.user.role !== 'user'))));
    const box = $('accountsBox'), host = $('accountsBoxBody');
    if (!box || !host || !customer()) return;
    box.classList.remove('hidden');
    if (status.setupNeeded) {
      host.innerHTML = '<p class="hint">This app can use login accounts: each person signs in with their own username and password, and MX Aero issues the seats. To start, ask MX Aero for an <b>Admin seat code</b>, then create the first Admin account. Until then the app works as it does now. Instructions: <a href="help/managing-users.html" target="_blank" rel="noopener">Managing Users</a>.</p><button type="button" class="secondary" id="accountsSetupBtn">Set up login accounts</button>';
      $('accountsSetupBtn').onclick = showSetup;
    } else if (status.user && status.user.role !== 'user') {
      host.innerHTML = '<p class="hint">People sign in with their own login. Admins add accounts within the seats issued by MX Aero; disabling an account frees its seat. Instructions: <a href="help/managing-users.html" target="_blank" rel="noopener">Managing Users</a>.</p><button type="button" class="secondary" id="accountsManageBtn">Manage accounts and seats</button>';
      $('accountsManageBtn').onclick = manageAccounts;
    } else box.classList.add('hidden');
  }

  window.isafAccounts = {changePassword, manageAccounts, signOut, status: () => status, customer, roleName};

  (async () => {
    try { status = await api('/api/account/status'); } catch { return; }
    if (!status.enabled) return;
    window.isafAccountsCustomer = customer();
    // A request refused because the session ended (signed in on another computer, timed out, disabled) brings up
    // the sign-in screen at once instead of leaving an error in the page.
    const plainFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await plainFetch(...args);
      if (response.status === 401 && !document.getElementById('acctGate') && !String(args[0]?.url || args[0]).includes('/api/account/')) {
        response.clone().json().then(async body => {
          if (!body?.signIn) return;
          try { status = await api('/api/account/status'); } catch {}
          if (status?.required && !status.signedIn) showSignIn();
        }).catch(() => {});
      }
      return response;
    };
    if (status.signedIn && status.user) {
      window.isafAccount = status.user;
      window.isafApplyAccount?.(status.user);
      renderAdminBox();
      if (status.user.mustChange) showMustChange();
      return;
    }
    renderAdminBox();
    // A Customer app keeps working without accounts until its Admin sets them up (Administration → Login accounts).
    if (status.setupNeeded) { if (!customer()) showSetup(); }
    else if (status.required) showSignIn();
  })();
})();
