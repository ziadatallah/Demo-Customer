// Admin-only Customers tab: customer register, licensed scope, deployments, patch history,
// and Customer Edition creation. Server routes: /api/admin/customers.
(()=>{
 const $=id=>document.getElementById(id);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let state={customers:[],options:{},importOptions:[],releases:[],currentVersion:'',dataFile:''},selected=null,draft=null,loaded=false;
 // Web addresses in messages and tables open the customer site in a new tab.
 const linkify=text=>esc(text).replace(/https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g,u=>`<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
 const siteHost=url=>{try{return new URL(url).host;}catch{return url;}};
 const status=(text,error=false)=>{const el=$('customerStatus');el.innerHTML=linkify(text);el.classList.toggle('error',error);};
 // Last meaningful line of a server detail (for example "GitHub publish failed: ..."), shown with the error.
 function reason(detail){const lines=String(detail||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);const line=lines.filter(l=>/failed|error|fatal|denied/i.test(l)).pop()||lines.pop()||'';return line?' Reason: '+line.replace(/^GitHub publish failed:\s*/,'').slice(0,400):'';}
 async function api(url,options={}){
  const response=await fetch(url,{...options,headers:{...authHeaders(),...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.error)throw Error((data.error||`Request failed (${response.status}).`)+reason(data.detail));
  return data;
 }
 async function load(keep){
  try{state=await api('/api/admin/customers');loaded=true;}
  catch(e){status(e.message,true);return;}
  $('customerDataFile').textContent='Customer data: '+state.dataFile+' · Delivery register (one row per app created, published or license change): '+state.deliveryRegister;
  if(keep)selected=state.customers.find(c=>c.id===keep.id)||null;
  renderList();renderForm();
 }
 function blank(){return {id:'new',company:'',license_type:'Company-wide',license_term:'Annual subscription',usage_tracking:'Offline report',program_types:[],phases:[],do160_in_scope:'No',do160_revision:'G',tool_qualification:'No',primary_authority:'FAA',cert_regime:'CIVIL',cert_basis:'TSO',requirements_integration:'None',requirements_tools:[],plm_integration:'None',deployment_model:'On-premise',version_deployed:'',patches:[],deployments:[]};}
 // Demo view (owner, 16 November 2026): shown to a prospect, this tab should not read as a client
 // list. Every customer but the demo one is masked in place - the entries stay, so the list still
 // behaves normally, but nothing identifies who they are. Per-viewer and per-browser, so it is kept
 // in localStorage rather than on the customer records.
 const PRIVACY_KEY='isafCustomerDemoView';
 const privacyOn=()=>{try{return localStorage.getItem(PRIVACY_KEY)==='1';}catch{return false;}};
 // Which customers Demo view shows is the owner's choice, ticked per customer, because sometimes
 // the point is to show one customer their own block (owner, 16 November 2026). It used to be
 // guessed from the company name, which could not express that.
 const inDemoView=c=>String(c.demo_visible||'')==='Yes';
 async function setDemoVisible(c,on){
  c.demo_visible=on?'Yes':'No';
  renderList();
  try{await api('/api/admin/customers/'+encodeURIComponent(c.id),{method:'PUT',body:JSON.stringify({...c})});}
  catch(err){status('Could not save the Demo view setting: '+err.message,true);await load();}
 }

 // The owner sets the order of this list; sort_order lives on the customer record so it survives a
 // new browser. Records without one keep the old alphabetical behavior, after those that have one.
 const orderOf=c=>Number.isFinite(Number(c.sort_order))?Number(c.sort_order):Number.MAX_SAFE_INTEGER;
 const inOrder=()=>[...state.customers].sort((a,b)=>orderOf(a)-orderOf(b)||String(a.company||'').localeCompare(String(b.company||'')));

 async function moveCustomer(id,delta){
  const ordered=inOrder();const from=ordered.findIndex(c=>c.id===id),to=from+delta;
  if(from<0||to<0||to>=ordered.length)return;
  const moved=ordered.splice(from,1)[0];ordered.splice(to,0,moved);
  // Every row is renumbered, so an imported list with no sort_order gets one on the first move.
  ordered.forEach((c,i)=>{c.sort_order=i;});
  renderList();
  try{
   for(const c of ordered)await api('/api/admin/customers/'+encodeURIComponent(c.id),{method:'PUT',body:JSON.stringify({...c,sort_order:c.sort_order})});
   status('Customer order saved.');
  }catch(err){status('Could not save the new order: '+err.message,true);await load();}
 }

 function renderList(){
  const list=$('customerList');list.replaceChildren();
  if(!state.customers.length){list.innerHTML='<p class="repo-muted">No customers yet. Choose New customer.</p>';return;}
  const masking=privacyOn();
  // Demo view hides the other customers outright rather than masking them in place (owner,
  // 16 November 2026): a prospect should see the demo customer and nothing else, not a row of
  // placeholders telling them how many clients there are.
  const ordered=masking?inOrder().filter(inDemoView):inOrder();
  if(!ordered.length){
   list.innerHTML='<p class="repo-muted">Demo view is on and no customer is ticked to show in it. Turn it off and tick the box beside each customer you want a visitor to see.</p>';
   return;
  }
  ordered.forEach((c,index)=>{
   const entry=document.createElement('div');entry.className='customer-row';
   if(!masking){
    const pick=document.createElement('label');pick.className='customer-demo-pick';
    pick.title='Show this customer in Demo view';
    const box=document.createElement('input');box.type='checkbox';box.checked=inDemoView(c);
    box.setAttribute('aria-label','Show '+(c.company||'this customer')+' in Demo view');
    box.onclick=e=>e.stopPropagation();
    box.onchange=()=>setDemoVisible(c,box.checked);
    pick.appendChild(box);entry.appendChild(pick);
   }
   const b=document.createElement('button');b.type='button';b.className='customer-item'+(selected?.id===c.id?' active':'');
   b.innerHTML=`<strong>${esc(c.company)}</strong><span>${esc(c.license_id||'')} · ${esc(c.version_deployed?('v'+c.version_deployed):'not deployed')}${importsOff(c)?' · no requirements import':''}</span>`;
   b.onclick=()=>{selected=c;renderList();renderForm();};
   // The customer's web site, as a link under its entry (a link cannot sit inside the button).
   const url=String(c.hosted_url||'').trim();
   if(/^https?:\/\//i.test(url)){const wrap=document.createElement('div');wrap.className='customer-item-wrap';const a=document.createElement('a');a.className='customer-site';a.href=url;a.target='_blank';a.rel='noopener';a.textContent=siteHost(url)+' ↗';a.title='Open '+url;wrap.append(b,a);entry.appendChild(wrap);}
   else entry.appendChild(b);
   const arrows=document.createElement('div');arrows.className='customer-move';
   if(masking){entry.appendChild(arrows);list.appendChild(entry);return;}
   const arrow=(dir,glyph,label)=>{const m=document.createElement('button');m.type='button';m.className='customer-move-btn';m.textContent=glyph;
    m.title=label;m.setAttribute('aria-label',label);
    m.disabled=dir<0?index===0:index===ordered.length-1;
    m.onclick=e=>{e.stopPropagation();moveCustomer(c.id,dir);};return m;};
   arrows.append(arrow(-1,'▲','Move up'),arrow(1,'▼','Move down'));
   entry.appendChild(arrows);
   list.appendChild(entry);
  });
 }
 const sel=(key,label,opts,value)=>`<label>${label}<select data-key="${key}">${opts.map(o=>`<option ${o===value?'selected':''}>${esc(o)}</option>`).join('')}</select></label>`;
 const txt=(key,label,value,type='text',extra='')=>`<label>${label}<input type="${type}" data-key="${key}" value="${esc(value)}" ${extra}></label>`;
 // Requirements import is stored as ids; the catalog from the server carries the names, and which entries
 // are a live connection ISAF does not have yet (listed for the license discussion, but not selectable).
 const toolChecks=(values)=>{
  const list=state.importOptions||[];
  if(!list.length)return '';
  return `<fieldset class="customer-checks"><legend>Requirements import (what the customer's Import tab offers)</legend>${list.map(o=>`<label class="customer-check${o.available?'':' customer-check-off'}" title="${esc(o.note||'')}"><input type="checkbox" data-list="requirements_tools" value="${esc(o.id)}" ${(values||[]).includes(o.id)?'checked':''} ${o.available?'':'disabled'}>${esc(o.label)}${o.available?'':' <span class="customer-soon">not yet available</span>'}</label>`).join('')}</fieldset>`;
 };
 const checks=(key,label,opts,values)=>`<fieldset class="customer-checks"><legend>${label}</legend>${opts.map(o=>`<label class="customer-check"><input type="checkbox" data-list="${key}" value="${esc(o)}" ${(values||[]).includes(o)?'checked':''}>${esc(o)}</label>`).join('')}</fieldset>`;
 function renderForm(){
  const host=$('customerForm');
  if(!selected){host.innerHTML='<p class="repo-muted">Select a customer or choose New customer.</p>';$('customerCreateApp').disabled=true;$('customerPublishApp').disabled=true;$('customerOpenApp').disabled=true;$('customerExport').disabled=true;$('customerDelete').disabled=true;return;}
  draft=structuredClone(selected);const o=state.options,c=draft;
  const versions=[...new Set([state.currentVersion,...state.releases.map(r=>r.version)].filter(Boolean))];
  host.innerHTML=`
   <section class="customer-section"><h3>Company and contacts</h3><div class="customer-grid">
    ${txt('company','Company *',c.company)}${txt('address','Address',c.address)}
    ${txt('contact_name','Main contact',c.contact_name)}${txt('contact_email','Contact email',c.contact_email,'email')}
    ${txt('contact_role','Contact role',c.contact_role)}${txt('it_contact','IT contact',c.it_contact)}</div></section>
   <section class="customer-section"><h3>License</h3><div class="customer-grid">
    ${txt('license_id','License ID',c.license_id,'text','placeholder="Assigned when saved"')}
    ${sel('license_type','License type',o.license_type,c.license_type)}${txt('seats','Seats (per user)',c.seats,'number','min="1"')}
    ${sel('license_term','Term',o.license_term,c.license_term)}${txt('license_start','Start date',c.license_start,'date')}
    ${txt('license_end','Subscription end',c.license_end,'date')}${txt('maintenance_until','Maintenance until',c.maintenance_until,'date')}
    ${sel('usage_tracking','Usage tracking',o.usage_tracking,c.usage_tracking)}</div></section>
   <section class="customer-section"><h3>Licensed scope</h3>
    ${checks('program_types','Program type',o.program_types,c.program_types)}
    ${checks('phases','Program phases (templates delivered; all target dates stay editable)',o.phases,c.phases)}
    <div class="customer-grid">
    ${sel('do160_in_scope','DO-160 in scope',['No','Yes'],c.do160_in_scope)}${sel('do160_revision','DO-160 revision',o.do160_revision,c.do160_revision)}
    ${sel('tool_qualification','Tool qualification',['No','Yes'],c.tool_qualification)}${sel('primary_authority','Primary authority',o.primary_authority,c.primary_authority)}
    ${sel('cert_regime','Certification regime',o.cert_regime,c.cert_regime)}${sel('cert_basis','Certification basis',o.cert_basis,c.cert_basis)}
    ${sel('requirements_integration','Requirements integration',o.requirements_integration,c.requirements_integration)}${sel('plm_integration','PLM integration',o.plm_integration,c.plm_integration)}
    </div>
    ${toolChecks(c.requirements_tools)}
    <p class="repo-muted">Only the ticked items appear in this customer's Import tab, and their app refuses the others. With none ticked there is no Import tab at all. <b>DOORS ReqIF</b> and <b>Other ReqIF, Excel and CSV files</b> both switch on the file import; DOORS ReqIF also records that this customer is a DOORS shop. <b>DOORS Next</b> and <b>DOORS 9.0</b> are live connections ISAF does not have yet: they are listed so the scope can be agreed now, and become selectable when each connector is built. Changing this takes effect the next time you create or publish the customer app.</p><p class="repo-muted">Recorded for the license. The tool connections above are enforced in the customer app; enforcement of the rest (signed license file, licensed templates only) comes in a later release.</p></section>
   <section class="customer-section"><h3>Deployment</h3><div class="customer-grid">
    ${sel('deployment_model','Deployment model',o.deployment_model,c.deployment_model)}
    ${sel('version_deployed','Version deployed',['',...versions],c.version_deployed)}
    ${txt('deployed_date','Deployed on',c.deployed_date,'date')}<label>Hosted URL (if hosted)<input type="url" data-key="hosted_url" value="${esc(c.hosted_url)}"><a id="customerSiteLink" class="customer-site hidden" target="_blank" rel="noopener"></a></label></div>
    <div class="customer-access-key"><b>Access key</b> <span class="repo-muted">${c.access_key_sha256?`Set on ${esc(c.access_key_set||'')}. Only a fingerprint is kept; the key itself is not stored.`:'Not set. The Customer app asks for this key when it opens (hosted or installed).'}</span>
     <div class="customer-access-row"><input type="password" id="customerAccessKeyInput" placeholder="Your own key for testing (at least 8 characters), or the Render ISAF_API_KEY" autocomplete="off"><button type="button" class="secondary" id="customerAccessKeySet">Set key</button><button type="button" class="secondary" id="customerAccessKeyGenerate">Generate new key</button></div>
     <div id="customerAccessKeyResult" class="hidden"></div></div>
    <div class="customer-grid customer-publish">${txt('publish_repository',"GitHub repository for this customer's hosted app",c.publish_repository,'text','placeholder="Blank = shared Customer site (Customer_GitHub_Deploy.json)"')}</div>
    <div class="watermark-control customer-watermark"><label><input type="checkbox" id="customerWatermark" ${c.watermark_documents==='Yes'?'checked':''}> Add Watermark</label><input type="text" id="customerWatermarkText" maxlength="40" value="${esc(c.watermark_text||'DEMO')}" aria-label="Watermark text"><span class="repo-muted">The customer app adds this watermark to every document it generates (evaluation or trial use).</span></div>
    ${(c.deployments||[]).length?`<table class="customer-table"><thead><tr><th>Date</th><th>Version</th><th>Delivery</th><th>File / URL</th><th>Baseline tag</th><th>Watermark</th></tr></thead><tbody>${c.deployments.map(d=>`<tr><td>${esc(d.date)}</td><td>${esc(d.version)}</td><td>${esc(d.delivery)}</td><td>${linkify(d.filename||'')}</td><td>${esc(d.tag||'')}</td><td>${esc(d.watermark||'')}</td></tr>`).join('')}</tbody></table>`:neverPublished(c)?'<p class="customer-unpublished"><b>Not published yet.</b> This customer has a GitHub repository, but no app has been pushed to it. A Render service pointed at an empty repository fails every deploy with <code>Could not read package.json</code> until you use <b>Publish Customer app</b>.</p>':'<p class="repo-muted">No app created yet.</p>'}</section>
   <section class="customer-section" id="customerUsersSection"><h3>Users</h3>
    <p class="repo-muted">Each person gets their own access key, so usage shows who built what. Keys are shown once; only a fingerprint is kept. New, changed or disabled users take effect when the Customer app is published (hosted) or created again (installed).</p>
    ${selected.id==='new'?'<p class="repo-muted">Save the customer first.</p>':`<table class="customer-table"><thead><tr><th>Name</th><th>Email</th><th>Added</th><th>Key set</th><th>Status</th><th></th></tr></thead><tbody>${(c.users||[]).map(u=>`<tr data-user="${esc(u.id)}"><td>${esc(u.name)}</td><td>${esc(u.email||'')}</td><td>${esc(u.created||'')}</td><td>${esc(u.key_set||'—')}</td><td>${u.disabled?`Disabled ${esc(u.disabled_on||'')}`:'Active'}</td><td class="customer-user-actions"><button type="button" class="secondary" data-user-act="key">New key</button><button type="button" class="secondary" data-user-act="${u.disabled?'enable':'disable'}">${u.disabled?'Enable':'Disable'}</button><button type="button" class="secondary" data-user-act="remove">Remove</button></td></tr>`).join('')||'<tr><td colspan="6" class="repo-muted">No users yet. Until users are added, the company access key above unlocks the app and usage cannot name the person.</td></tr>'}</tbody></table>
    <div class="customer-access-row"><input type="text" id="customerUserName" placeholder="Name (for example Jane Smith)" maxlength="120"><input type="email" id="customerUserEmail" placeholder="Email (optional)" maxlength="200"><button type="button" class="secondary" id="customerUserAdd">Add user and generate key</button></div>
    <div id="customerUserKeyResult" class="hidden"></div>`}</section>
   <section class="customer-section" id="customerUsageSection"><h3>Usage</h3><div id="customerUsage"><p class="repo-muted">${selected.id==='new'?'Save the customer first.':'Loading usage…'}</p></div></section>
   <section class="customer-section"><h3>Patch history</h3>
    <table class="customer-table"><thead><tr><th>Date</th><th>Patch version</th><th>Problem</th><th>Ported to main?</th><th></th></tr></thead><tbody id="customerPatches"></tbody></table>
    <button type="button" class="secondary" id="customerAddPatch">+ Add patch</button></section>
   <section class="customer-section"><h3>Notes</h3><textarea data-key="notes" rows="3">${esc(c.notes)}</textarea></section>`;
  renderPatches();
  host.querySelectorAll('[data-key]').forEach(el=>el.addEventListener('input',()=>{draft[el.dataset.key]=el.value;}));
  $('customerWatermark').addEventListener('change',e=>{draft.watermark_documents=e.target.checked?'Yes':'No';});
  $('customerWatermarkText').addEventListener('input',e=>{draft.watermark_text=e.target.value;});
  // Every Aircraft program includes DO-160: lock "DO-160 in scope" to Yes while Aircraft is licensed.
  const syncAircraftDo160=()=>{const d=host.querySelector('[data-key="do160_in_scope"]');if(!d)return;const aircraft=(draft.program_types||[]).includes('Aircraft');if(aircraft){d.value='Yes';draft.do160_in_scope='Yes';}d.disabled=aircraft;d.title=aircraft?'Aircraft programs always include DO-160.':'';};
  // Program-type licenses are hierarchical: Aircraft includes System and LRU; System includes LRU.
  const syncProgramTypes=()=>{const boxes=[...host.querySelectorAll('[data-list="program_types"]')],get=v=>boxes.find(b=>b.value===v);if(!boxes.length)return;
   const aircraft=get('Aircraft')?.checked,system=get('System')?.checked;
   for(const b of boxes){const included=(b.value!=='Aircraft'&&aircraft)||(b.value==='LRU'&&system);if(included)b.checked=true;b.disabled=!!included;b.title=included?`Included with ${aircraft?'Aircraft':'System'}`:'';}
   draft.program_types=boxes.filter(b=>b.checked).map(b=>b.value);};
  host.querySelectorAll('[data-list]').forEach(el=>el.addEventListener('change',()=>{const k=el.dataset.list;draft[k]=[...host.querySelectorAll(`[data-list="${k}"]:checked`)].map(x=>x.value);if(k==='program_types')syncProgramTypes();syncAircraftDo160();}));
  syncProgramTypes();syncAircraftDo160();
  $('customerAddPatch').onclick=()=>{draft.patches=[...(draft.patches||[]),{date:new Date().toISOString().slice(0,10),version:'',problem:'',ported:'Pending'}];renderPatches();};
  const setKey=async generate=>{
   if(selected.id==='new'){status('Save the customer first.',true);return;}
   const entered=generate?'':$('customerAccessKeyInput').value.trim();if(!generate&&!entered){status('Enter the key, or choose Generate new key.',true);return;}
   if(selected.access_key_sha256&&!confirm('Replace the access key for '+selected.company+'? The current key stops working in the next Customer app you create or publish.'))return;
   try{await saveDraftQuietly();const data=await api('/api/admin/customers/'+encodeURIComponent(selected.id)+'/access-key',{method:'POST',body:JSON.stringify(generate?{}:{key:entered})});
    await load(selected);
    if(data.key){const box=$('customerAccessKeyResult');box.classList.remove('hidden');box.innerHTML=`<p><b>New access key for ${esc(selected.company)}:</b> <code id="customerNewKey">${esc(data.key)}</code> <button type="button" class="secondary" id="customerCopyKey">Copy</button></p><p class="repo-muted">Copy it now: it is shown only once and is not stored. Send it to the customer separately from the app address. For a hosted app, set the same value as ISAF_API_KEY in the Render service. Create or publish the Customer app again for the new key to take effect.</p>`;$('customerCopyKey').onclick=()=>navigator.clipboard?.writeText(data.key).then(()=>status('Access key copied.'));}
    else status('Access key set for '+selected.company+'. Create or publish the Customer app again for it to take effect.');
   }catch(e){status(e.message,true);}
  };
  $('customerAccessKeySet').onclick=()=>setKey(false);$('customerAccessKeyGenerate').onclick=()=>setKey(true);
  if(selected.id!=='new'){wireUsers();loadUsage();}
  syncOpenButton();host.querySelector('[data-key="hosted_url"]')?.addEventListener('input',syncOpenButton);
  $('customerCreateApp').disabled=selected.id==='new';$('customerPublishApp').disabled=selected.id==='new';$('customerExport').disabled=selected.id==='new';$('customerDelete').disabled=selected.id==='new';
 }
 // Users: add (key generated and shown once), new key, disable/enable, remove.
 function showUserKey(name,key){const box=$('customerUserKeyResult');box.classList.remove('hidden');box.innerHTML=`<p><b>Access key for ${esc(name)}:</b> <code>${esc(key)}</code> <button type="button" class="secondary" id="customerCopyUserKey">Copy</button></p><p class="repo-muted">Send it to ${esc(name)} privately. It is not shown again; use New key if it is lost. Publish or create the Customer app again for it to work.</p>`;$('customerCopyUserKey').onclick=()=>navigator.clipboard?.writeText(key).then(()=>status('Key copied.'));}
 function wireUsers(){
  const add=$('customerUserAdd');if(!add)return;
  add.onclick=async()=>{const name=$('customerUserName').value.trim(),email=$('customerUserEmail').value.trim();if(!name){status('Enter the user\'s name.',true);return;}
   try{await saveDraftQuietly();const d=await api('/api/admin/customers/'+encodeURIComponent(selected.id)+'/users',{method:'POST',body:JSON.stringify({name,email})});await load(selected);showUserKey(d.user.name,d.key);status(`User ${d.user.name} added. Publish (hosted) or create the Customer app again (installed) for the key to work.`);}catch(e){status(e.message,true);}};
  $('customerUsersSection').addEventListener('click',async e=>{const b=e.target.closest('[data-user-act]');if(!b)return;const id=b.closest('tr').dataset.user,u=(selected.users||[]).find(x=>x.id===id);if(!u)return;
   const base='/api/admin/customers/'+encodeURIComponent(selected.id)+'/users/'+encodeURIComponent(id);
   try{
    if(b.dataset.userAct==='key'){if(!confirm(`Generate a new key for ${u.name}? The old key stops working when the Customer app is published or created again.`))return;const d=await api(base+'/key',{method:'POST',body:'{}'});await load(selected);showUserKey(u.name,d.key);}
    else if(b.dataset.userAct==='remove'){if(!confirm(`Remove ${u.name}? Usage already recorded for this user is kept.`))return;await api(base,{method:'DELETE'});await load(selected);status(`${u.name} removed. Publish or create the Customer app again.`);}
    else{await api(base,{method:'PATCH',body:JSON.stringify({disabled:b.dataset.userAct==='disable'})});await load(selected);status(`${u.name} ${b.dataset.userAct==='disable'?'disabled':'enabled'}. Publish or create the Customer app again for this to take effect.`);}
   }catch(err){status(err.message,true);}});
 }
 // Usage: programs and users with first/last use, recent events, import of a usage report, CSV export, sync.
 const day=t=>String(t||'').replace('T',' ').slice(0,16);
 const PHASE={codr:'CoDR',srr:'SRR',pdr:'PDR',soi1:'SOI 1',cdr:'CDR',soi2:'SOI 2',soi3:'SOI 3',trr:'TRR',soi4:'SOI 4',tia:'TIA',all:'All'},phases=list=>(list||[]).map(x=>PHASE[x]||x).join(', ');
 async function loadUsage(){
  const host=$('customerUsage');if(!host||!selected||selected.id==='new')return;const id=selected.id;
  let u;try{u=await api('/api/admin/customers/'+encodeURIComponent(id)+'/usage');}catch(e){host.innerHTML=`<p class="repo-muted">${esc(e.message)}</p>`;return;}
  if(selected?.id!==id)return;
  const s=u.summary,collector=u.collector.configured?'New Customer apps send usage to the MX Aero usage collector.':'The usage collector is not set up yet: Customer apps record usage in their own log only. Set it up with Usage Tracking Setup (button at the top of this tab) and Usage collector settings below.';
  host.innerHTML=`<p class="repo-muted">${esc(collector)} ${u.total} event${u.total===1?'':'s'} recorded.</p>
   <div class="customer-access-row"><button type="button" class="secondary" id="customerUsageSync" ${u.collector.sync?'':'disabled title="Set ISAF_USAGE_ENDPOINT and ISAF_USAGE_COLLECTOR_KEY first"'}>Sync usage from collector</button><button type="button" class="secondary" id="customerUsageImport">Import usage report…</button><input type="file" id="customerUsageFile" accept=".jsonl,.json,.txt" hidden><button type="button" class="secondary" id="customerUsageCsv" ${u.total?'':'disabled'}>Export (CSV for Excel)</button></div>
   <details class="customer-usage-settings" id="customerUsageSettings"><summary>Usage collector settings (all customers)</summary><div id="customerUsageSettingsBody"><p class="repo-muted">Loading…</p></div></details>
   <h4>Programs</h4>${s.programs.length?`<table class="customer-table"><thead><tr><th>Program</th><th>Prefix</th><th>Type</th><th>First used</th><th>Last used</th><th>Builds</th><th>Documents</th><th>Phases</th><th>Users</th></tr></thead><tbody>${s.programs.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.doc_prefix)}</td><td>${esc(p.type)}</td><td>${esc(day(p.first))}</td><td>${esc(day(p.last))}</td><td>${p.builds}</td><td>${p.documents}</td><td>${esc(phases(p.phases))}</td><td>${esc(p.users.join(', '))}</td></tr>`).join('')}</tbody></table>`:'<p class="repo-muted">No builds recorded yet.</p>'}
   <h4>Users</h4>${s.users.length?`<table class="customer-table"><thead><tr><th>User</th><th>First seen</th><th>Last active</th><th>App opened</th><th>Builds</th><th>Programs</th></tr></thead><tbody>${s.users.map(x=>`<tr><td>${esc(x.user)}</td><td>${esc(day(x.first))}</td><td>${esc(day(x.last))}</td><td>${x.opens}</td><td>${x.builds}</td><td>${esc(x.programs.join(', '))}</td></tr>`).join('')}</tbody></table>`:'<p class="repo-muted">No activity recorded yet.</p>'}
   <h4>Recent activity</h4>${u.events.length?`<table class="customer-table"><thead><tr><th>Time (UTC)</th><th>Event</th><th>User</th><th>Program</th><th>Phases</th><th>Documents</th><th>Hosting</th></tr></thead><tbody>${u.events.slice(0,100).map(e=>`<tr><td>${esc(day(e.time))}</td><td>${e.event==='build'?'Build':'App opened'}</td><td>${esc(e.user||'—')}</td><td>${esc(e.program?.name||'')}</td><td>${esc(phases(e.phases))}</td><td>${e.event==='build'?e.documents:''}</td><td>${esc(e.hosting)}</td></tr>`).join('')}</tbody></table>${u.events.length>100?'<p class="repo-muted">Showing the latest 100. Export for all.</p>':''}`:'<p class="repo-muted">None yet.</p>'}`;
  $('customerUsageSettings').addEventListener('toggle',e=>{if(e.target.open)renderUsageSettings();});
  $('customerUsageSync').onclick=async()=>{try{const r=await api('/api/admin/usage/sync',{method:'POST'});status(`Usage synced: ${r.added} new event${r.added===1?'':'s'}.`);loadUsage();}catch(e){status(e.message,true);}};
  $('customerUsageImport').onclick=()=>$('customerUsageFile').click();
  $('customerUsageFile').onchange=async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;try{const r=await fetch('/api/admin/customers/'+encodeURIComponent(selected.id)+'/usage/import',{method:'POST',headers:{...authHeaders(),'Content-Type':'text/plain'},body:await f.text()});const d=await r.json();if(!r.ok)throw Error(d.error||'Import failed.');status(`Usage report imported: ${d.added} new event${d.added===1?'':'s'}${d.skipped?`, ${d.skipped} already recorded or not valid`:''}${d.otherLicence?` (${d.otherLicence} belong to another license and were not imported)`:''}.`);loadUsage();}catch(err){status(err.message,true);}};
  $('customerUsageCsv').onclick=async()=>{try{const r=await fetch('/api/admin/customers/'+encodeURIComponent(selected.id)+'/usage.csv',{headers:authHeaders()});if(!r.ok)throw Error('Export failed.');const name=(r.headers.get('Content-Disposition')||'').match(/filename="?([^";]+)"?/)?.[1]||'ISAF_Usage.csv',url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(e){status(e.message,true);}};
 }
 // Usage collector settings: the collector address, secret and key, saved on this computer (ISAF_Usage_Settings.json
 // in the Admin data folder). Generated values are shown once so they can be copied into Render.
 const randomSecret=()=>{const b=new Uint8Array(32);crypto.getRandomValues(b);return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
 async function renderUsageSettings(){
  const body=$('customerUsageSettingsBody');if(!body)return;let st;
  try{st=await api('/api/admin/usage/settings');}catch(e){body.innerHTML=`<p class="repo-muted">${esc(e.message)}</p>`;return;}
  body.innerHTML=`<p class="repo-muted">See <a href="help/usage-tracking-setup.html" target="_blank" rel="noopener">Usage Tracking Setup</a>. ${st.fromEnvironment?'Some values come from environment variables on this computer, which take priority over what is saved here.':''}</p>
   <label>Collector address<input type="url" id="usageSetEndpoint" placeholder="https://isaf-usage.onrender.com" value="${esc(st.endpoint)}"></label>
   <div class="customer-access-row"><span><b>Collector secret</b> <span class="repo-muted">${st.secretSet?'Set.':'Not set.'}</span></span><button type="button" class="secondary" id="usageGenSecret">Generate new secret</button></div>
   <div class="customer-access-row"><span><b>Collector key</b> <span class="repo-muted">${st.keySet?'Set.':'Not set.'}</span></span><button type="button" class="secondary" id="usageGenKey">Generate new key</button></div>
   <div class="customer-access-row"><span><b>Collector site access key</b> <span class="repo-muted">For ISAF_API_KEY on the collector (locks its web pages). Not saved here.</span></span><button type="button" class="secondary" id="usageGenSite">Generate</button></div>
   <div id="usageGenerated"></div>
   <div class="customer-access-row"><button type="button" id="usageSettingsSave">Save collector settings</button><span class="repo-muted" id="usageSettingsStatus" role="status"></span></div>
   <p class="repo-muted">Saved on this computer in ${esc(st.file)}, outside the repository.</p>`;
  const pending={};
  const shown={};const show=()=>{$('usageGenerated').innerHTML=Object.entries({...pending,...shown}).map(([k,v])=>`<p><b>${k==='secret'?'ISAF_USAGE_COLLECTOR_SECRET':k==='key'?'ISAF_USAGE_COLLECTOR_KEY':'ISAF_API_KEY'}:</b> <code>${esc(v)}</code> <button type="button" class="secondary" data-copy="${esc(v)}">Copy</button></p>`).join('')+(Object.keys({...pending,...shown}).length?'<p class="repo-muted">Copy each value into the collector\'s Environment on Render now, then click Save collector settings. They are not shown again. A new secret changes every app\'s token: publish or create the Customer apps again afterwards.</p>':'');};
  $('usageGenerated').addEventListener('click',e=>{const b=e.target.closest('[data-copy]');if(b)navigator.clipboard?.writeText(b.dataset.copy).then(()=>status('Copied.'));});
  $('usageGenSecret').onclick=()=>{if(st.secretSet&&!confirm('Generate a new collector secret? Customer apps keep sending with the old one until they are published or created again.'))return;pending.secret=randomSecret();show();};
  $('usageGenKey').onclick=()=>{pending.key=randomSecret();show();};
  $('usageGenSite').onclick=()=>{shown.site=randomSecret();show();};
  $('usageSettingsSave').onclick=async()=>{try{const r=await api('/api/admin/usage/settings',{method:'PUT',body:JSON.stringify({endpoint:$('usageSetEndpoint').value.trim(),...pending})});$('usageSettingsStatus').textContent='Saved.';status('Usage collector settings saved.');setTimeout(()=>{loadUsage();},300);}catch(e){$('usageSettingsStatus').textContent=e.message;}};
 }
 function renderPatches(){
  const body=$('customerPatches');body.replaceChildren();
  (draft.patches||[]).forEach((p,i)=>{
   const tr=document.createElement('tr');
   tr.innerHTML=`<td><input type="date" value="${esc(p.date)}" data-f="date"></td><td><input value="${esc(p.version)}" data-f="version" placeholder="5.4.3"></td><td><input value="${esc(p.problem)}" data-f="problem"></td><td><select data-f="ported">${['Pending','Ported','Not needed'].map(v=>`<option ${v===p.ported?'selected':''}>${v}</option>`).join('')}</select></td><td><button type="button" class="secondary">Remove</button></td>`;
   tr.querySelectorAll('[data-f]').forEach(el=>el.addEventListener('input',()=>{draft.patches[i][el.dataset.f]=el.value;}));
   tr.querySelector('button').onclick=()=>{draft.patches.splice(i,1);renderPatches();};
   body.appendChild(tr);
  });
 }
 let saving=false;
 async function save(){
  // The button stays on screen while the request is in flight, and saving the "new" placeholder
  // creates a customer, so a second click used to create a second one. One save at a time.
  if(!draft||saving)return;
  saving=true;
  const button=$('customerSave'),label=button.textContent;
  button.disabled=true;button.textContent='Saving\u2026';
  try{const {customer,warning}=await api('/api/admin/customers/'+encodeURIComponent(draft.id),{method:'PUT',body:JSON.stringify(draft)});status('Saved '+customer.company+' ('+customer.license_id+').'+(warning||''),!!warning);await load(customer);}
  catch(e){status(e.message,true);}
  finally{saving=false;button.disabled=false;button.textContent=label;}
 }
 async function remove(){
  if(!selected||selected.id==='new'||!confirm('Delete '+selected.company+' from the customer register? This cannot be undone.'))return;
  try{await api('/api/admin/customers/'+encodeURIComponent(selected.id),{method:'DELETE'});status('Deleted '+selected.company+'.');selected=null;await load();}
  catch(e){status(e.message,true);}
 }
 // Progress indicator while a Customer app is created or published (same style as the Build tab).
 let busyTimer=null;
 function busy(text){
  const box=$('customerBusy');if(!box)return;clearInterval(busyTimer);
  if(!text){box.classList.add('hidden');return;}
  $('customerBusyText').textContent=text;$('customerBusyTime').textContent='0:00';box.classList.remove('hidden');
  const start=Date.now();busyTimer=setInterval(()=>{const t=Math.floor((Date.now()-start)/1000);$('customerBusyTime').textContent=`${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;},1000);
 }
 function hostedUrl(){return String((draft&&Object.hasOwn(draft,'hosted_url')?draft.hosted_url:selected?.hosted_url)||'').trim();}
 function syncOpenButton(){const url=hostedUrl(),ok=/^https?:\/\//i.test(url),b=$('customerOpenApp');if(b)b.disabled=!selected||selected.id==='new'||!ok;
  const a=$('customerSiteLink');if(a){a.classList.toggle('hidden',!ok);if(ok){a.href=url;a.textContent=url+' ↗';a.title='Open the customer site in a new tab';}}}
 // Requirements import is licensed per customer and nothing is ticked by default, so building an app for a
 // customer with none selected would quietly take the Import tab away from a customer who has it today.
 // Say so before the build, with the names, rather than after the redeploy.
 const importsOff=c=>!((c?.requirements_tools)||[]).length;
 function confirmNoImport(customer){
  if(!importsOff(customer))return true;
  return confirm(`${customer.company} has nothing ticked under Requirements import, so this app will have no Import tab at all: no requirements files, no Jama or Polarion.\n\nIf this customer imports requirements today, this redeploy takes that away. Tick what they are licensed for under Licensed scope first.\n\nBuild it anyway?`);
 }
 async function createApp(){
  if(!selected||selected.id==='new')return;
  if(!confirmNoImport(draft||selected))return;
  const button=$('customerCreateApp');button.disabled=true;status('');busy('Building the Customer app for '+selected.company+'…');
  try{
   await saveDraftQuietly();
   const response=await fetch('/api/admin/customers/'+encodeURIComponent(selected.id)+'/create-app'+watermarkQuery(),{method:'POST',headers:authHeaders()});
   if(!response.ok){const data=await response.json().catch(()=>({}));throw Error((data.error||'Could not create the Customer app.')+(data.detail?' '+data.detail.slice(-300):''));}
   const name=(/filename="?([^";]+)"?/.exec(response.headers.get('Content-Disposition')||'')||[])[1]||'ISAF_Customer_Edition.zip';
   const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   const warn=decodeURIComponent(response.headers.get('X-ISAF-Register-Warning')||'');
   status('Created and downloaded '+name+'. Recorded in '+selected.company+"'s history and the delivery register."+warn,!!warn);await load(selected);
  }catch(e){status(e.message,true);}
  finally{button.disabled=false;busy('');}
 }
 function watermarkQuery(){const on=$('customerWatermark')?.checked;return on?'?watermark=1&text='+encodeURIComponent(($('customerWatermarkText')?.value||'DEMO').trim()||'DEMO'):'';}
 async function saveDraftQuietly(){if(draft&&JSON.stringify(draft)!==JSON.stringify(selected))await api('/api/admin/customers/'+encodeURIComponent(selected.id),{method:'PUT',body:JSON.stringify(draft)});}
 async function publishApp(){
  if(!selected||selected.id==='new')return;
  if(!confirmNoImport(draft||selected))return;
  const shared=!String(draft?.publish_repository||'').trim();
  // Without a repository the only place to publish is the shared Customer site, which every
  // customer without a repository of its own shares. That is almost never what is wanted, and the
  // old wording described it without saying how to avoid it, so it read as a failure.
  if(shared){
   const site=String(draft?.hosted_url||selected.hosted_url||'').trim();
   const lines=[
    `${selected.company} has no GitHub repository set, so ISAF cannot publish to an app of its own.`,
    '',
    'TO PUBLISH THIS CUSTOMER\u2019S OWN APP (what you almost certainly want):',
    'Choose Cancel, then fill in Deployment \u2192 \u201cGitHub repository for this customer\u2019s hosted app\u201d',
    'with the repository the customer\u2019s site deploys from, for example  owner/' + (selected.company||'Customer').replace(/[^A-Za-z0-9]+/g,'-'),
    'Save the customer, then Publish again.',
    ...(site?[`That is the repository ${site} is built from.`]:[]),
    '',
    'CHOOSE OK ONLY TO PUBLISH TO THE SHARED CUSTOMER SITE',
    '(Customer_GitHub_Deploy.json). That site is shared by every customer without a repository of',
    'its own, and publishing replaces what it currently shows for all of them.',
   ];
   if(!confirm(lines.join('\n')))return;
  }
  const button=$('customerPublishApp');button.disabled=true;status('');busy('Building and publishing the Customer app for '+selected.company+' to GitHub…');
  try{
   await saveDraftQuietly();
   const data=await api('/api/admin/customers/'+encodeURIComponent(selected.id)+'/publish-app'+watermarkQuery(),{method:'POST'});
   status(data.message+'\nRecorded in '+selected.company+"'s history and the delivery register.");await load(selected);
  }catch(e){status(e.message,true);}
  finally{button.disabled=false;busy('');}
 }
 // Publish all customers: publishes this Admin version to every hosted customer (Deployment model "Hosted by
 // MX Aero") that has its own GitHub repository and an access key, one after another, with a result per customer.
 // Customers without their own repository are skipped so the shared Customer site is not overwritten repeatedly.
 // A hosted customer with a repository but nothing published: Render builds the
 // repository as it stands, so every deploy fails until Publish Customer app
 // has run once. Creating the customer does not push anything.
 function neverPublished(c){return c.deployment_model==='Hosted by MX Aero'&&!!String(c.publish_repository||'').trim()&&!(c.deployments||[]).length;}
 function publishable(c){const hosted=c.deployment_model==='Hosted by MX Aero',repo=String(c.publish_repository||'').trim();return !hosted?'not hosted (on-premise customers get a Customer app ZIP)':!repo?'no GitHub repository':!c.access_key_sha256?'no access key':'';}
 async function publishAll(){
  const all=state.customers||[],list=all.filter(c=>!publishable(c)),skipped=all.filter(c=>publishable(c)).map(c=>`${c.company}: ${publishable(c)}`);
  const skippedText=skipped.length?'\n\nSkipped:\n'+skipped.map(s=>'• '+s).join('\n'):'';
  if(!list.length){status('No customer can be published. Publishing needs Deployment model "Hosted by MX Aero", the customer\'s own GitHub repository and an access key.'+skippedText,true);return;}
  const version=state.currentVersion||'';
  const noImport=list.filter(importsOff);
  const noImportText=noImport.length?`\n\nNo Import tab for ${noImport.length} of them (nothing ticked under Requirements import):\n${noImport.map(c=>'• '+c.company).join('\n')}\nIf any of these import requirements today, publishing takes that away.`:'';
  if(!confirm(`Publish v${version} to ${list.length} customer app${list.length>1?'s':''}?\n\n${list.map(c=>'• '+c.company+(c.version_deployed?` (now v${c.version_deployed})`:' (not deployed yet)')).join('\n')}${skippedText}${noImportText}\n\nEach publish takes a few minutes, and Render redeploys each site.`))return;
  const buttons=['customerPublishAll','customerPublishApp','customerCreateApp','customerSave','customerDelete'].map(id=>$(id)).filter(Boolean),was=buttons.map(b=>b.disabled);
  buttons.forEach(b=>b.disabled=true);status('');
  const results=[];let ok=0;
  try{
   if(selected&&selected.id!=='new')await saveDraftQuietly();
   for(const [i,c] of list.entries()){
    busy(`Publishing ${i+1} of ${list.length}: ${c.company}…`);
    try{const d=await api('/api/admin/customers/'+encodeURIComponent(c.id)+'/publish-app'+watermarkQuery(),{method:'POST'});ok++;results.push(`✓ ${c.company}: published v${version}${d.tag?' (tag '+d.tag+')':''}${d.url?' — '+d.url:''}`);}
    catch(e){results.push(`✕ ${c.company}: ${e.message}`);}
    status(`Publishing… ${i+1} of ${list.length} done.\n`+results.join('\n'));
   }
  }finally{
   busy('');buttons.forEach((b,i)=>b.disabled=was[i]);
   status(`Publish all customers finished: ${ok} of ${list.length} published${ok?` (v${version}); Render redeploys each site within a few minutes`:''}. Each is recorded in its history and the delivery register.\n`+results.join('\n')+skippedText,ok<list.length);
   await load(selected&&selected.id!=='new'?selected:null);
  }
 }
 // App updates offered to customers (all customers). Each release the owner records here is announced by every
 // Customer app: a plain notice the user can postpone or skip, or a Critical Update that must be installed and
 // that stops builds once its grace period has passed. Published to the usage collector, which the apps reach.
 async function renderUpdates(){
  const body=$('customerUpdatesBody');if(!body)return;let st;
  try{st=await api('/api/admin/updates');}catch(e){body.innerHTML=`<p class="repo-muted">${esc(e.message)}</p>`;return;}
  const versions=[...new Set([st.currentVersion,...(st.known||[])].filter(Boolean))].filter(v=>!st.releases.some(r=>r.version===v));
  body.innerHTML=`<p class="repo-muted">Customer apps ask the update service every six hours whether a newer version is offered. A plain update can be postponed for a week or skipped by each user; a <b>Critical Update</b> cannot be dismissed and stops builds after its grace period. Updates are free of charge for now. Record the release here, then click Publish so the apps can see it.</p>
   ${st.releases.length?`<table class="customer-table"><thead><tr><th>Version</th><th>Released</th><th>Critical</th><th>Grace (days)</th><th>Offered</th><th>What is new</th><th></th></tr></thead><tbody>${st.releases.map(r=>`<tr><td><b>${esc(r.version)}</b></td><td>${esc(r.date)}</td><td>${r.critical?'<b>Critical</b>':'No'}</td><td>${r.critical?r.grace_days:'—'}</td><td>${r.offered?'Yes':'No (hidden)'}</td><td>${esc((r.summary||'').slice(0,120))}${(r.summary||'').length>120?'…':''}${r.download?`<br><span class="repo-muted">${esc(r.download)}</span>`:''}</td><td><button type="button" class="secondary" data-update-edit="${esc(r.version)}">Edit</button> <button type="button" class="secondary" data-update-remove="${esc(r.version)}">Remove</button></td></tr>`).join('')}</tbody></table>`:'<p class="repo-muted">No release is offered to customers yet.</p>'}
   <div class="customer-section"><div class="customer-grid">
    <label>Version<input id="updVersion" list="updVersions" placeholder="5.3.29" value=""><datalist id="updVersions">${versions.map(v=>`<option value="${esc(v)}"></option>`).join('')}</datalist></label>
    <label>Release date<input type="date" id="updDate" value="${new Date().toISOString().slice(0,10)}"></label>
    <label>Grace period (days, critical only)<input type="number" id="updGrace" min="0" max="365" value="14"></label>
    <label>Where to get it (https link, optional)<input type="url" id="updDownload" placeholder="https://…"></label>
    <label>Release notes link (optional)<input type="url" id="updNotes" placeholder="https://…"></label>
    <label>Admin Contact (sent to every customer)<input type="email" id="updContact" value="${esc(st.contact||'mxaerollc@yahoo.com')}" placeholder="mxaerollc@yahoo.com"></label>
   </div>
   <label>What is new (shown in the app)<textarea id="updSummary" rows="3" style="width:100%" placeholder="Short plain-English summary the customer's users will read."></textarea></label>
   <div class="customer-access-row"><label class="customer-check"><input type="checkbox" id="updCritical" style="flex:0 0 auto;min-width:0"> <b>Critical Update</b> (affects a major function; must be installed)</label><label class="customer-check"><input type="checkbox" id="updOffered" checked style="flex:0 0 auto;min-width:0"> Offer it to customers now</label></div>
   <div class="customer-access-row"><button type="button" id="updSave">Save release</button><button type="button" class="secondary" id="updPublish" ${st.canPublish?'':'disabled title="Enter the collector address and collector key under Usage collector settings first"'}>Publish to update service</button><span class="repo-muted" id="updStatus" role="status"></span></div>
   <p class="repo-muted">Kept on this computer in ${esc(st.file)}, outside the repository.${st.endpoint?` Update service: ${esc(st.endpoint)}.`:''} A critical update never stops builds sooner than three days after an app first sees it, so nobody is blocked without warning.</p></div>`;
  // The Admin Contact is the address every customer sees on an update notice, so it is saved on its own,
  // without waiting for a release, and goes out with the next Publish.
  $('updContact').onchange=async()=>{
   try{await api('/api/admin/updates',{method:'PUT',body:JSON.stringify({contact:$('updContact').value.trim()})});$('updStatus').textContent='Admin Contact saved.';status('Admin Contact saved. Click Publish to update service to send it to the customer apps.');}
   catch(e){$('updStatus').textContent=e.message;status(e.message,true);}};
  const fill=r=>{$('updVersion').value=r.version;$('updDate').value=r.date;$('updGrace').value=r.grace_days||14;$('updDownload').value=r.download||'';$('updNotes').value=r.notes_url||'';$('updSummary').value=r.summary||'';$('updCritical').checked=!!r.critical;$('updOffered').checked=r.offered!==false;};
  body.querySelectorAll('[data-update-edit]').forEach(b=>b.onclick=()=>{const r=st.releases.find(x=>x.version===b.dataset.updateEdit);if(r)fill(r);});
  body.querySelectorAll('[data-update-remove]').forEach(b=>b.onclick=async()=>{if(!confirm(`Remove ISAF ${b.dataset.updateRemove} from the list offered to customers?`))return;try{await api('/api/admin/updates/'+encodeURIComponent(b.dataset.updateRemove),{method:'DELETE'});status('Release removed. Publish to the update service to apply it.');renderUpdates();}catch(e){status(e.message,true);}});
  $('updSave').onclick=async()=>{
   const release={version:$('updVersion').value.trim(),date:$('updDate').value,critical:$('updCritical').checked,grace_days:Number($('updGrace').value||14),summary:$('updSummary').value.trim(),download:$('updDownload').value.trim(),notes_url:$('updNotes').value.trim(),offered:$('updOffered').checked};
   if(release.critical&&!confirm(`Mark ISAF ${release.version||'(no version)'} as a Critical Update? Customers cannot dismiss it, and their apps stop building ${release.grace_days} day${release.grace_days===1?'':'s'} after ${release.date} until it is installed.`))return;
   try{await api('/api/admin/updates',{method:'PUT',body:JSON.stringify({release,contact:$('updContact').value.trim()})});$('updStatus').textContent='Saved.';status(`ISAF ${release.version} recorded. Click Publish to update service so Customer apps can see it.`);renderUpdates();}
   catch(e){$('updStatus').textContent=e.message;status(e.message,true);}};
  $('updPublish').onclick=async()=>{try{const r=await api('/api/admin/updates/publish',{method:'POST'});$('updStatus').textContent='Published.';status(`Published ${r.published} release${r.published===1?'':'s'} to ${r.endpoint}. Customer apps see it within six hours, or at once when a user chooses Check for Updates.`);}catch(e){$('updStatus').textContent=e.message;status(e.message,true);}};
 }
 $('customerUpdatesPanel')?.addEventListener('toggle',e=>{if(e.target.open)renderUpdates();});
 // Wired once at module load: the switch lives in static markup, and putting this inside a render
 // path meant it only became live after a customer's usage happened to load.
 const privacyBox=$('customerPrivacyToggle');
 if(privacyBox){
  privacyBox.checked=privacyOn();
  privacyBox.addEventListener('change',()=>{
   try{localStorage.setItem(PRIVACY_KEY,privacyBox.checked?'1':'0');}catch{}
   // Entering demo view deselects everything (owner, 16 November 2026). Hiding the rows alone
   // would leave whoever was selected open in the form beside the list, and moving the selection
   // to a shown customer still opens a record nobody asked to see. Nothing is selected, so the
   // form reads "Select a customer or choose New customer." until the visitor is shown one.
   if(privacyBox.checked) selected=null;
   renderList();renderForm();
  });
 }
 window.customersUI={refresh:()=>loaded?renderList():load()};
 document.addEventListener('DOMContentLoaded',()=>{});
 $('customerNew').onclick=()=>{selected=blank();renderList();renderForm();status('');};
 $('customerExport').onclick=async()=>{if(!selected||selected.id==='new')return;try{await saveDraftQuietly();const r=await fetch('/api/admin/customers/'+encodeURIComponent(selected.id)+'/record.xlsx',{headers:authHeaders()});if(!r.ok){const d=await r.json().catch(()=>({}));throw Error(d.error||'Could not export the record.');}const name=(/filename="?([^";]+)"?/.exec(r.headers.get('Content-Disposition')||'')||[])[1]||'ISAF_Customer_Record.xlsx';const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);status('Exported '+name+'.');}catch(e){status(e.message,true);}};
 $('customerSave').onclick=save;$('customerDelete').onclick=remove;$('customerCreateApp').onclick=createApp;$('customerPublishApp').onclick=publishApp;$('customerPublishAll').onclick=publishAll;$('customerOpenApp').onclick=()=>{const url=hostedUrl();if(/^https?:\/\//i.test(url))window.open(url,'_blank','noopener');};
})();
