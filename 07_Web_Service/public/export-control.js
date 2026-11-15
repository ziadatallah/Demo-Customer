/* Offline BIS reference picker. It writes only the user's selected marking; no classification inference. */
(() => {
 const categories=['Nuclear / Miscellaneous','Special Materials','Materials Processing','Electronics','Computers','Telecommunications / Information Security','Sensors And Lasers','Navigation And Avionics','Marine','Aerospace And Propulsion'];
 const groups={A:'Equipment / Components',B:'Test / Inspection / Production Equipment',C:'Materials',D:'Software',E:'Technology'};
 let catalogPromise,origin,selected;
 const dialog=document.createElement('dialog');dialog.className='eccn-dialog';dialog.setAttribute('aria-labelledby','eccn-title');
 dialog.innerHTML=`<div class="eccn-heading"><h2 id="eccn-title">Choose export classification</h2><button type="button" class="secondary" data-close>Close</button></div>
 <p class="hint">Use the classification approved for this document’s contents. Equipment, software and technical information can have different classifications.</p>
 <div class="eccn-filters"><label>Search code or description<input id="eccn-search" type="search" placeholder="For example, 7E994 or avionics"></label><label>Category<select id="eccn-category"><option value="">All categories</option>${categories.map((x,i)=>`<option value="${i}">${i} — ${x}</option>`).join('')}</select></label><label>Product group<select id="eccn-group"><option value="">All product groups</option>${Object.entries(groups).map(([k,v])=>`<option value="${k}">${k} — ${v}</option>`).join('')}</select></label></div>
 <p id="eccn-count" class="hint" role="status"></p><label for="eccn-results" class="eccn-list-label">Matching classifications</label><select id="eccn-results" size="8" aria-describedby="eccn-description"></select>
 <p id="eccn-description" class="eccn-description">Select an entry to read its description.</p>
 <p class="hint">These are reference headings. Read the full technical criteria and the CCL order of review before confirming a classification. EAR99 is not an ECCN and does not mean unrestricted. A selection does not determine whether an export is authorized.</p>
 <div class="eccn-links"><a id="eccn-reference" href="https://www.bis.gov/regulations/ear/interactive-commerce-control-list" target="_blank" rel="noopener noreferrer">Read full entry at BIS</a><a href="https://www.bis.gov/licensing/classify-your-item" target="_blank" rel="noopener noreferrer">BIS classification guidance</a></div>
 <p id="eccn-source" class="hint"></p><div class="eccn-actions"><button type="button" class="secondary" data-close>Cancel</button><button type="button" id="eccn-use" disabled>Use selected classification</button></div>`;
 document.body.appendChild(dialog);
 const el=id=>dialog.querySelector('#eccn-'+id);
 const ear99={code:'EAR99',description:'Items subject to the EAR that are not described by any Commerce Control List ECCN. End-use, end-user and destination restrictions can still require authorization.'};
 let entries=[];
 function details(){
  selected=entries.find(x=>x.code===el('results').value);
  el('description').textContent=selected?selected.code+' — '+selected.description:'Select an entry to read its description.';
  el('use').disabled=!selected;
  el('reference').href=selected?.code==='EAR99'?'https://www.bis.gov/licensing/classify-your-item':'https://www.bis.gov/regulations/ear/interactive-commerce-control-list'+(selected?'?keyword='+encodeURIComponent(selected.code):'');
 }
 function filter(){
  const words=el('search').value.trim().toLowerCase().split(/\s+/).filter(Boolean),category=el('category').value,group=el('group').value;
  const matches=entries.filter(x=>(!category||x.code[0]===category)&&(!group||x.code[1]===group)&&words.every(w=>(x.code+' '+x.description+' '+(categories[Number(x.code[0])]||'')+' '+(groups[x.code[1]]||'')).toLowerCase().includes(w)));
  const current=selected?.code;el('results').replaceChildren(...matches.map(x=>new Option(x.code+' — '+x.description,x.code)));
  el('results').value=matches.some(x=>x.code===current)?current:'';
  el('count').textContent=matches.length+' matching '+(matches.length===1?'entry':'entries')+(matches.length?'':'. Clear a filter or enter your company-approved marking directly.');details();
 }
 dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>dialog.close());
 el('search').addEventListener('input',filter);el('category').addEventListener('change',filter);el('group').addEventListener('change',filter);el('results').addEventListener('change',details);
 el('use').onclick=()=>{
  if(!selected||!origin?.isConnected){dialog.close();return;}
  origin.value=selected.code==='EAR99'?'EAR99':'ECCN '+selected.code;
  // Both editors use their normal change handler, including shared draft/TBD bookkeeping.
  origin.dispatchEvent(new Event('input',{bubbles:true}));origin.dispatchEvent(new Event('change',{bubbles:true}));dialog.close();
 };
 document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-eccn-picker]');if(!button)return;
  origin=button.closest('.export-marking-control').querySelector('input[data-path]');selected=null;
  el('search').value='';el('category').value='';el('group').value='';el('results').replaceChildren();el('description').textContent='Select an entry to read its description.';el('use').disabled=true;el('source').textContent='';el('count').textContent='Loading the reference list…';dialog.showModal();el('search').focus();
  try{
   catalogPromise??=fetch('export-control-catalog.json').then(r=>{if(!r.ok)throw Error('Reference list unavailable');return r.json();}).catch(e=>{catalogPromise=null;throw e;});
   const catalog=await catalogPromise;entries=[...catalog.entries,ear99];filter();
   el('source').textContent='BIS reference snapshot: '+catalog.retrieved+'. '+catalog.entries.length+' ECCN headings plus EAR99. Reserved and explicitly ITAR-only cross-references are excluded. Check the current BIS list before use.';
  }catch(e){entries=[];el('count').textContent='The local reference list could not be loaded. Use the BIS links below and enter the approved marking directly.';}
 });
})();
