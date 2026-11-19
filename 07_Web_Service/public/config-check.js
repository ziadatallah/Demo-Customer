// Proactive configuration checks (all editions).
// Runs the build engine's validator (POST /api/check-config) on the configuration shown in the browser,
// adds required fields that are still empty, and shows the results where they can be fixed:
//   - Config Data sub-tabs turn red with a count when they hold a problem (amber when only warnings);
//   - each tab starts with a "Checks for this tab" panel whose items jump to the field or row;
//   - the Build tab shows the status and does not start a build while blocking problems remain.
(function(){
 const SECTION_TAB={program:'program',intake:'program',personnel:'personnel',authority:'authority',systems:'systems',safety:'safety',software_items:'software',hardware_items:'hardware',suppliers:'suppliers',tools:'tools',dev_environment:'dev_environment',environmental_baseline:'environmental_baseline',environmental_flow_down:'environmental_flow_down'};
 const ROW_SECTIONS=['systems','software_items','hardware_items','suppliers','tools','environmental_baseline','environmental_flow_down'];
 let findings=[],checkedSig='',pending=null,running=null,failed=false;
 // While a workbook loads, and until the first check of a newly loaded configuration has finished, no results
 // are shown (they would belong to the previous workbook or to a half-applied configuration).
 let loadingFile=false,awaitingFirst=false;
 const settling=()=>loadingFile||(awaitingFirst&&!!data());

 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const data=()=>typeof configData!=='undefined'?configData:null;
 const tabLabel=id=>(typeof CONFIG_TABS!=='undefined'&&CONFIG_TABS.find(t=>t.id===id)?.label)||'Program';
 const tabVisible=id=>{const t=typeof CONFIG_TABS!=='undefined'&&CONFIG_TABS.find(x=>x.id===id);return !t||typeof configTabVisible!=='function'||configTabVisible(t);};

 function rowById(id){
  const d=data();if(!d||!id)return null;
  for(const section of ROW_SECTIONS){const i=(d[section]||[]).findIndex(r=>r&&(r.id===id||r.hw_id===id));if(i>=0)return {section,index:i};}
  return null;
 }
 // Work out which Config Data tab (and, when possible, which field or row) a validator message refers to.
 function locate(message){
  const m=String(message||'');let x;
  if((x=/\b(software_items|hardware_items|systems|suppliers|tools|environmental_baseline|environmental_flow_down)\[(\d+)\](?:\.([a-z0-9_]+))?/.exec(m))){
   const field=x[3]||(/\)?:\s*([a-z_]+)\b(?: is required| "| is invalid)/.exec(m)||[])[1];
   return {tab:SECTION_TAB[x[1]],path:field?`${x[1]}[${x[2]}].${field}`:null,row:{section:x[1],index:+x[2]}};
  }
  if((x=/\b(program|intake|personnel|authority|safety|dev_environment)\.([a-z0-9_]+(?:\.[a-z0-9_]+)?)/.exec(m)))return {tab:SECTION_TAB[x[1]],path:`${x[1]}.${x[2]}`};
  if((x=/\b(environmental_baseline|environmental_flow_down) row (\d+)/.exec(m)))return {tab:SECTION_TAB[x[1]],row:{section:x[1],index:+x[2]-1}};
  if(/Environmental_Baseline/.test(m))return {tab:'environmental_baseline'};
  if(/Environmental_FlowDown/.test(m))return {tab:'environmental_flow_down'};
  if((x=/^(systems|software_items|hardware_items) item "([^"]+)"/.exec(m)))return {tab:SECTION_TAB[x[1]],row:rowById(x[2]),pnOf:x[2]};
  if((x=/^(software_items|hardware_items) "([^"]+)"/.exec(m)))return {tab:SECTION_TAB[x[1]],row:rowById(x[2])};
  if((x=/^(software_items|hardware_items|suppliers|systems|tools)\b/.exec(m)))return {tab:SECTION_TAB[x[1]]};
  if((x=/^supplier "?([^":]+)"?/i.exec(m)))return {tab:'suppliers',row:rowById(x[1].trim())};
  if((x=/^tool "([^"]+)"/.exec(m)))return {tab:'tools',row:rowById(x[1])};
  // Any message about an item's Parent System, however it is worded. V147 was reworded in 5.3.32
  // to explain why the field is required, which put text between the id and "Parent System" and
  // silently sent all of these findings to the Program tab via the fallback below.
  if((x=/^"([^"]+)":.*\bParent System\b/.exec(m))){const r=rowById(x[1]);return {tab:SECTION_TAB[r?.section]||'software',row:r,path:r?`${r.section}[${r.index}].parent_system`:null};}
  if(/no software_items and no hardware_items/.test(m))return {tab:'software'};
  if(/\bsystems?\b/i.test(m)&&/LRU program|no systems defined/.test(m))return {tab:/LRU program/.test(m)?'systems':'systems'};
  return {tab:'program'};
 }
 // Required fields that are still empty (TBD decisions are reported by the validator as V134).
 function emptyRequired(){
  if(!data()||typeof configFields!=='function'||typeof configRequired!=='function')return [];
  const out=[];
  for(const f of configFields()){if(!configRequired(f.path))continue;const v=String(f.value??'').trim();if(v!==''&&v!=='—')continue;out.push({severity:'Blocker',id:'REQ',message:`${f.label} is required.`,hint:'',tab:f.tab.id,path:f.path,source:'required'});}
  return out;
 }
 function issues(){
  const d=data();if(!d)return [];
  const seen=new Set(),list=[];
  for(const f of findings){const loc=locate(f.message);const item={...f,...loc};if(!tabVisible(item.tab))item.tab='program';list.push(item);if(item.path)seen.add(item.path);}
  for(const e of emptyRequired())if(!seen.has(e.path)&&!list.some(i=>i.path===e.path))list.push(e);
  return list;
 }
 function summary(){
  const all=issues(),byTab={};
  for(const i of all){(byTab[i.tab]??={blockers:[],warnings:[]})[i.severity==='Blocker'?'blockers':'warnings'].push(i);}
  return {all,byTab,blockers:all.filter(i=>i.severity==='Blocker'),warnings:all.filter(i=>i.severity==='Warning')};
 }

 async function run(depth=0){
  const d=data();if(!d){findings=[];checkedSig='';refreshUi();return summary();}
  const sig=JSON.stringify(d)+'|logo:'+(typeof selectedLogoFile!=='undefined'&&selectedLogoFile?selectedLogoFile.name:'');
  if(sig===checkedSig&&!failed){awaitingFirst=false;refreshUi();return summary();}
  try{
   const res=await fetch('/api/check-config',{method:'POST',headers:{...(typeof authHeaders==='function'?authHeaders():{}),'Content-Type':'application/json'},body:JSON.stringify({data:d,logoSelected:typeof selectedLogoFile!=='undefined'&&!!selectedLogoFile})});
   const body=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(body.error||'The configuration check could not run.');
   if(data()&&JSON.stringify(data())+'|logo:'+(typeof selectedLogoFile!=='undefined'&&selectedLogoFile?selectedLogoFile.name:'')===sig){findings=(body.findings||[]).filter(f=>f.severity==='Blocker'||f.severity==='Warning');checkedSig=sig;failed=false;}
  }catch(e){failed=true;console.warn('Configuration check:',e.message);}
  // The configuration changed while the check ran (for example licensed values applied after loading): check
  // again before showing anything for a newly loaded configuration.
  const now=data()?JSON.stringify(data())+'|logo:'+(typeof selectedLogoFile!=='undefined'&&selectedLogoFile?selectedLogoFile.name:''):'';
  if(awaitingFirst&&!failed&&now&&now!==checkedSig&&depth<3)return run(depth+1);
  awaitingFirst=false;refreshUi();return summary();
 }
 // Called by the page: loading(true) while a workbook is being read; fresh() when a new configuration is in place.
 function loading(on){loadingFile=!!on;if(on)awaitingFirst=true;refreshUi();}
 function fresh(){loadingFile=false;awaitingFirst=true;refreshUi();schedule(0);}
 function schedule(delay=500){clearTimeout(pending);pending=setTimeout(()=>{running=run();},delay);}
 async function ensure(){clearTimeout(pending);running=run();return running;}

 function decorateTabs(){
  const bar=document.getElementById('configTabBar');if(!bar||!data())return;
  const {byTab}=settling()?{byTab:{}}:summary();
  for(const b of bar.querySelectorAll('button[data-tab]')){
   const t=byTab[b.dataset.tab]||{blockers:[],warnings:[]},n=t.blockers.length;
   b.classList.toggle('tab-issues',n>0);b.classList.toggle('tab-warnings',!n&&t.warnings.length>0);
   let badge=b.querySelector('.tab-issue-count');
   if(n||t.warnings.length){if(!badge){badge=document.createElement('span');badge.className='tab-issue-count';b.appendChild(badge);}badge.textContent=String(n||t.warnings.length);badge.title=n?`${n} problem${n>1?'s':''} to fix on this tab`:`${t.warnings.length} warning${t.warnings.length>1?'s':''}`;b.setAttribute('aria-label',`${b.dataset.label||b.textContent}: ${badge.title}`);}
   else{badge?.remove();b.removeAttribute('aria-label');}
  }
 }
 // Show messages in screen terms: field paths become their on-screen labels, sections their tab names.
 const SECTION_NAME={software_items:'Software Items',hardware_items:'Hardware Items',systems:'System/LRU',suppliers:'Suppliers',tools:'Tools',environmental_baseline:'Environmental Evidence',environmental_flow_down:'Environmental Requirements',dev_environment:'Development Environment'};
 function friendly(message){
  let m=String(message||'');
  m=m.replace(/\b(software_items|hardware_items|systems|suppliers|tools|environmental_baseline|environmental_flow_down)\[(\d+)\](?: \(([^)]+)\))?/g,(_,sec,i,id)=>`${sec==='systems'&&typeof systemsTabName==='function'?systemsTabName():SECTION_NAME[sec]} row ${+i+1}${id?` (${id})`:''}`);
  m=m.replace(/\b(program|intake|personnel|authority|safety|dev_environment)\.([a-z0-9_]+(?:\.[a-z0-9_]+)?)\b/g,(all,sec,rest)=>{
   const key=rest.split('.').at(-1);let label='';try{label=typeof configLabel==='function'?configLabel(key,`${sec}.${rest}`):'';}catch{}
   if(sec==='personnel'&&rest.includes('.')){const role=rest.split('.')[0].replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()).replace(/\b(Pm|Qa|Pa|Cm)\b/g,x=>x.toUpperCase());const f=key==='email'?'Email':key==='name'?'Name':label||key;return `${role} ${f}`;}
   const named={'program.name':'Program Name','program.short_name':'Program Short Name','program.type':'Program Type'}[`${sec}.${rest}`];if(named)return named;
   return label&&label!==key?label:all;});
  m=m.replace(/\b(software_items|hardware_items|environmental_baseline|environmental_flow_down|dev_environment)\b/g,sec=>SECTION_NAME[sec]||sec);
  // Engine messages name a unit as systems "id"; on screen that is the System/LRU (or LRU) tab.
  m=m.replace(/\bsystems ("[^"]+")/gi,(_,id)=>`${typeof systemsTabName==='function'?systemsTabName():'System/LRU'} ${id}`);
  m=m.replace(/\b(Environmental_Baseline|Environmental_FlowDown)\b/g,x=>x==='Environmental_Baseline'?'Environmental Evidence':'Environmental Requirements');
  m=m.replace(/\bintake scope\b/g,'the Program Intake scope answer');
  return m.charAt(0).toUpperCase()+m.slice(1);
 }
 function itemHtml(i,k,list){const repeat=k>0&&list[k-1]?.hint===i.hint;return `<li class="${i.severity==='Blocker'?'issue-blocker':'issue-warning'}"><button type="button" class="issue-link" data-issue="${k}">${esc(friendly(i.message))}</button>${i.hint&&!repeat?`<span class="issue-hint">${esc(i.hint)}</span>`:''}</li>`;}
 let panelItems=[];
 function panel(tabId){
  if(!data())return null;
  if(settling()){const el=document.createElement('section');el.className='config-issues is-clear';el.innerHTML='<p class="issue-ok">Checking this configuration…</p>';return el;}
  const {byTab,blockers,warnings}=summary(),t=byTab[tabId]||{blockers:[],warnings:[]},items=[...t.blockers,...t.warnings];
  const el=document.createElement('section');el.className='config-issues '+(t.blockers.length?'has-blockers':t.warnings.length?'has-warnings':'is-clear');el.setAttribute('aria-live','polite');
  const others=blockers.length-t.blockers.length;
  const otherLine=others>0?`<p class="issue-other">${others} more problem${others>1?'s':''} on other tabs (shown in red above).</p>`:'';
  if(!items.length){el.innerHTML=`<p class="issue-ok">${failed?'Checks could not run; they will run again after the next change.':'No problems found on this tab.'}</p>${otherLine}`;return el;}
  panelItems=items;
  const title=t.blockers.length?`${t.blockers.length} problem${t.blockers.length>1?'s':''} to fix on this tab before building`:`${t.warnings.length} warning${t.warnings.length>1?'s':''} on this tab`;
  el.innerHTML=`<h3>${esc(title)}</h3><p class="issue-help">Select an item to go to the field.</p><ul>${items.map(itemHtml).join('')}</ul>${otherLine}`;
  el.addEventListener('click',e=>{const b=e.target.closest('.issue-link');if(b)go(panelItems[+b.dataset.issue]);});
  return el;
 }
 function go(item){
  if(!item)return;
  if(typeof switchMainTab==='function'&&document.getElementById('panel-config')?.classList.contains('hidden'))switchMainTab('config');
  if(typeof activeConfigTab!=='undefined'){activeConfigTab=item.tab||'program';renderConfigTabs();}
  requestAnimationFrame(()=>{
   const host=document.getElementById('configTabContent');if(!host)return;
   let target=item.path&&[...host.querySelectorAll('[data-path]')].find(e=>e.dataset.path===item.path);
   if(!target&&item.row){const pre=`${item.row.section}[${item.row.index}]`;target=[...host.querySelectorAll('[data-path]')].find(e=>e.dataset.path.startsWith(pre));target=target?.closest('tr')||target;}
   if(!target&&!item.row&&/no rows|no items|are configured|has no PN/.test(item.message||''))target=host.querySelector('[data-add-row]');
   if(!target){host.querySelector('.config-issues')?.scrollIntoView({block:'start',behavior:'smooth'});return;}
   target.scrollIntoView({block:'center',behavior:'smooth'});
   const flash=target.closest('tr')||target;flash.classList.remove('issue-flash');void flash.offsetWidth;flash.classList.add('issue-flash');
   if(target.matches?.('input,select,textarea,button'))setTimeout(()=>target.focus({preventScroll:true}),350);
  });
 }
 function buildStatus(){
  const box=document.getElementById('configCheckStatus');if(!box)return;
  if(loadingFile){box.className='config-check-status is-unknown';box.innerHTML='Loading configuration file…';return;}
  if(!data()){box.className='config-check-status hidden';box.innerHTML='';return;}
  if(awaitingFirst){box.className='config-check-status is-unknown';box.innerHTML='Checking the configuration…';return;}
  const {blockers,warnings}=summary();
  if(failed){box.className='config-check-status is-unknown';box.innerHTML='Configuration checks could not run. The build will report any problems.';return;}
  if(!blockers.length){box.className='config-check-status is-clear';box.innerHTML=`Configuration checks passed${warnings.length?` (${warnings.length} warning${warnings.length>1?'s':''} in Config Data)`:''}.`;return;}
  const groups={};blockers.forEach(i=>(groups[i.tab]??=[]).push(i));
  box.className='config-check-status has-blockers';
  box.innerHTML=`<strong>${blockers.length} problem${blockers.length>1?'s':''} must be fixed in Config Data before building.</strong><ul>${Object.entries(groups).map(([tab,list])=>`<li><button type="button" class="issue-link" data-tab="${esc(tab)}">${esc(tabLabel(tab))}</button>: ${esc(friendly(list[0].message).replace(new RegExp('^'+tabLabel(tab).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+':\\s*'),''))}${list.length>1?` <span class="issue-hint">and ${list.length-1} more</span>`:''}</li>`).join('')}</ul>`;
  box.onclick=e=>{const b=e.target.closest('.issue-link');if(b)go(groups[b.dataset.tab][0]);};
 }
 function refreshUi(){
  decorateTabs();buildStatus();
  const host=document.getElementById('configTabContent'),old=host?.querySelector(':scope > .config-issues');
  if(old&&typeof activeConfigTab!=='undefined'){const fresh=panel(activeConfigTab);if(fresh)old.replaceWith(fresh);}
 }
 document.addEventListener('change',e=>{if(e.target?.dataset?.path)schedule(600);});
 window.configCheck={schedule,ensure,run,panel,decorateTabs,refreshUi,summary,go,loading,fresh,settling};
})();
