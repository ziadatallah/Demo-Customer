/* Guided intake edits the same configuration draft used by Config Data. */
(() => {
 const host=$('intakeHost');let step=0,busy=false,message='',newKind='LRU';
 const stages=['Program','Approval & Scope','People & Dates'];
 const paths={...CONFIG_APPROVAL_BASIS,MILITARY:null,OTHER:null};
 const pathLabels={TSOA:'FAA TSO authorization',TC:'Aircraft type certificate (TC)',AMENDED_TC:'Amended TC',STC:'Supplemental type certificate (STC)',AMENDED_STC:'Amended STC',SUPPLIER_TC:'Supplier support to an aircraft TC applicant',SUPPLIER_STC:'Supplier support to an aircraft STC applicant',TSOA_TC:'TSO authorization plus TC installation support',TSOA_STC:'TSO authorization plus STC installation support',ETSO:'ETSO authorization',LODA:'FAA letter of TSO design approval (foreign applicant)',PMA:'Parts manufacturer approval (PMA)',MILITARY:'Military airworthiness approval',OTHER:'Other — describe in survey notes'};
 const intakeMeta={
 cage_code:['CAGE Code','Five-character Commercial and Government Entity code for the legal company, when assigned. A non-U.S. organization may use an NCAGE. Used on generated document covers; it is never part of a document PN.'],
 company_address:['Company Address','Legal or controlled program address used with the company identity on generated document covers.'],
 approval_path:['Approval Path','Select the approval or support package your company is preparing. Program Type defines the product boundary; Approval Path defines the approval sought. Only the paths that fit the Program Type are listed (an LRU or System supplier does not hold an aircraft TC; an Aircraft program does not use TSO, PMA or supplier-support paths).'],
 separate_cdp:['Separate Certification Data Plan','Select Yes only when your company or the aircraft applicant requires a separate controlled plan for certification-data ownership, delivery, configuration and submission status. Select No when this information is managed in the Certification Plan, PSCP, compliance matrix or document register.'],
 installation_applicant:['Aircraft Applicant / Integrator','Company responsible for the aircraft TC/STC or installation approval. Used to plan the interface and delivery responsibilities.'],
 installation_basis:['Aircraft Certification Basis / Allocation Reference','Record the aircraft certification basis and the document allocating requirements to your product. This intake record does not establish approval.'],
 product_description:['Product Function And Boundary','Describe what the product does, what is included and which installation responsibilities are outside your scope.'],
 software_scope:['Software In Scope','Whether airborne software lifecycle data are part of this program. Add every applicable software item in the next step.'],
 hardware_scope:['Hardware In Scope','Whether airborne electronic hardware lifecycle data are part of this program. Add every applicable hardware item in the next step.'],
 supplier_scope:['External Suppliers In Scope','Whether outside organizations supply development work, hardware, software or lifecycle evidence for this program.'],
 supplier_scope_basis:['Supplier Work Share Definition','Describe whether percentages measure engineering hours, contract value or another quantity. Use the same stated basis when comparing suppliers.'],
 oversight_plan:['Supplier Oversight And Authority Coordination','Record proposed reviews, data access, foreign-site coordination and questions for the certification lead. ISAF does not calculate FAA level of involvement.'],
 authority_project_reference:['Authority Project Reference','Project identifier assigned by the authority, when available. Retained with the intake planning record.'],
 production_quality_plan:['Production And Quality Arrangements','Identify manufacturing sites, quality-system ownership and the applicable quality manual or planned evidence.'],
 application_records_plan:['Application And Approval Records Plan','Identify the application, conformance and delegated approval records agreed with the certification lead. Issued FAA/designee records must be obtained and imported through the program register.'],
 survey_owner:['Intake Owner','Person who coordinates completing this configuration and resolving its open items. When you mark a field TBD, ISAF records this name as the owner of that open decision, so every TBD has someone accountable. Not an app login or approval signature, and not printed in generated documents.'],
 survey_notes:['Intake Notes','Working notes for this configuration: assumptions, open scope questions and the references used to answer them. When you mark an optional field Not applicable, ISAF adds the field name and your reason here, so the decision stays on record. Not printed in generated documents.'],
 country:['Supplier Home Country','Country where the supplier organization is based. Work locations may differ; record them separately.'],
 work_countries:['Countries Where Work Is Performed','List the actual development, verification, manufacturing and lower-tier work locations relevant to this supplier.'],
 outside_us_percent:['Work Outside The US (%)','Estimate the percentage of this supplier’s scoped work performed outside the United States, from 0 to 100. State the measurement basis and source; this is not an FAA involvement score.'],
 percentage_basis:['Percentage Basis And Source','Explain whether the work share is based on engineering hours, value or another quantity, and record the source/date of the estimate.'],
 oversight_notes:['Supplier Oversight Notes','Record site access, evidence access, lower-tier suppliers and coordination needs for review by the certification lead.']
 };
 Object.entries(intakeMeta).forEach(([key,[label,desc]])=>{FIELD_META[key]={label,desc};CONFIG_FIELD_HELP[key]=desc;});
 FIELD_META.approval_path={...FIELD_META.approval_path,options:['',...Object.keys(paths)],optionLabels:pathLabels};
 for(const key of ['software_scope','hardware_scope','supplier_scope','separate_cdp'])FIELD_META[key]={...FIELD_META[key],options:['','Yes','No']};
 FIELD_META.fdal={label:'FDAL',options:['','A','B','C','D','E']};FIELD_META.idal_max={label:'Maximum IDAL',options:['','A','B','C','D','E']};
 const templates={
 systems:{id:'',name:'',pn:'',short_name:'',function_summary:'',fdal:'',idal_max:'',software_item_count:'',hardware_item_count:'',primary_supplier:'',ata_chapter:'',unit_type:'',parent_unit:'',tso_numbers:'',modification_standard:'',unit_weight:'',unit_dimensions:'',time_rating:'',radio_transmitter:'',pressure_loads:'',measuring_accuracy:''},
 software_items:{id:'',name:'',pn:'',parent_system:'',dal:'',supplier:'',language:'',loc_estimate:'',formal_methods:false,notes:'',additional_documents:'',software_control_category:'',worst_case_severity:'',ata_chapter:''},
 hardware_items:{id:'',name:'',pn:'',parent_system:'',dal:'',supplier:'',technology:'',complexity:'',notes:'',language:'',additional_documents:'',do160_applies:false,ata_chapter:''},
 suppliers:{id:'',name:'',role:'',items_delivered:[],highest_dal:'',cert_lead_name:'',cert_lead_email:'',flow_down_signed:'No',flow_down_date:'',country:'',work_countries:'',outside_us_percent:'',percentage_basis:'',oversight_notes:''},
 tools:{id:'',name:'',vendor:'',intended_use:'',lifecycle_data_affected:'',qualification_required:false,tql:'',qualification_status:''}
 };
 for(const section of ['environmental_baseline','environmental_flow_down'])templates[section]=Object.fromEntries(ENGINEERING_FIELDS[section].fields.map(f=>[f.key,f.key==='tested'?false:'']));
 const clone=x=>JSON.parse(JSON.stringify(x));
 const unresolved=path=>openDecisionList().some(d=>d.path===path);
 function mark(path,yes){if(yes&&unresolved(path))return;const list=openDecisionList().filter(d=>d.path!==path);if(yes){const m=/^(\w+)\[(\d+)\]/.exec(path);list.push({path,item_id:m?String(configData[m[1]]?.[Number(m[2])]?.id||''):'',owner:configData.intake?.survey_owner||'',target_date:''});}commitOpenDecisions(list);}
 function put(path,value){const parts=path.replace(/\[(\d+)\]/g,'.$1').split('.');let o=configData;for(const k of parts.slice(0,-1))o=o[k]??={};o[parts.at(-1)]=value;configDraftMods[path]=value;mark(path,false);}
 function button(text,fn,secondary=true){const b=document.createElement('button');b.type='button';b.className=secondary?'secondary':'';b.textContent=text;b.disabled=busy;b.onclick=fn;return b;}
 function node(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;}
 function field(path){
  const key=path.split('.').at(-1),required=configRequired(path),value=configAt(path),pending=unresolved(path);
  const box=node('div','intake-field');box.dataset.unresolved=String(pending);
  const heading=node('div','intake-field-heading'),id='intake-field-'+path.replace(/[^a-z0-9]/gi,'_'),label=node('label','',({'program.name':'Program Name','program.short_name':'Program Short Name','program.doc_prefix':'Document Prefix'}[path]||configLabel(key,path)));label.htmlFor=id;
  if(required)heading.appendChild(node('span','required-marker','*'));heading.appendChild(label);
  // Contextual guidance belongs in the field it is about, on demand. It used to be one floating
  // paragraph under the whole card, detached from the fields that trigger it and on screen for
  // every program, which is how guidance stops being read.
  let info=makeInfoBtn(key,getFieldMeta(key,path.split('.')[0]),path).replaceAll('pop-','intake-pop-');
  const contextNote=path==='program.target_authority_primary'?authorityNote():path==='intake.approval_path'?approvalPathNote():'';
  if(contextNote)info=info.replace(/(<\/div>\s*<\/span>)$/,'<p class="popover-note">'+escapeHtml(contextNote)+'</p>$1');
  heading.insertAdjacentHTML('beforeend',info);box.appendChild(heading);
  const control=node('div');control.innerHTML=makeValueCell(key,value,path.slice(0,path.lastIndexOf('.'))).replace(/^<td>|<\/td>$/g,'');
  let input=control.querySelector('input,select,textarea');
  // Every notes or free-text answer is a textarea, so all of them can be dragged taller the way the
  // address field could (owner, 16 November 2026). The second list is CONFIG_LONG_FIELDS, kept in
  // step with the config tabs' own idea of a long field.
  const FREE_TEXT=new Set(['product_description','installation_basis','oversight_plan','production_quality_plan',
   'application_records_plan','survey_notes','oversight_notes','percentage_basis','supplier_scope_basis',
   'function_summary','notes','distribution_statement','independence_description','company_address',
   'additional_documents','intended_use','lifecycle_data_affected','particular_risks','items_delivered',
   'work_countries','description','justification','rationale','export_control_notes','retention_notes']);
  // The address and the distribution statement open at one line: both were three rows of mostly
  // empty box. They still drag taller, and a long value scrolls rather than being cut off.
  const ONE_LINE=new Set(['company_address','distribution_statement']);
  if(FREE_TEXT.has(key)&&input.tagName!=='TEXTAREA'){
   const area=document.createElement('textarea');area.dataset.path=input.dataset.path;area.value=input.value;
   area.rows=ONE_LINE.has(key)?1:3;input.replaceWith(area);input=area;
  }
  // A long field now arrives from makeValueCell already a textarea, at the one row a table row can
  // afford. The intake has the space, so it opens at three unless it is one of the two the owner
  // asked to start at one line.
  if(input.tagName==='TEXTAREA')input.rows=ONE_LINE.has(key)?1:3;
  input.id=id;input.setAttribute('aria-required',String(required));if(key==='id')input.readOnly=true;
  if(key==='cage_code'){input.maxLength=5;input.pattern='[A-Za-z0-9]{5}';input.placeholder='Example: 1AB23';input.addEventListener('input',()=>{input.value=input.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);});}
  if(pending){if(input.tagName==='SELECT'){input.prepend(new Option('To Be Determined',''));input.value='';}else{input.value='';input.placeholder='To Be Determined';}}
  // No "To Be Determined" hint beside the buttons: the button already reads "Undo TBD", the input
  // carries the placeholder and the field carries the amber unresolved border, so a fourth copy on
  // the title row said nothing and was the widest thing competing with the label (owner,
  // 15 November 2026).
  const actions=node('div','intake-field-actions');
  if(key!=='id'&&input.dataset.derived!=='approval-path')actions.appendChild(button(pending?'Undo TBD':'TBD',()=>{mark(path,!pending);render();}));
  if(pending&&!required&&!CONFIG_BOOLEAN_KEYS.has(key))actions.appendChild(button('Not applicable',()=>{
   const reason=prompt('Reason this field does not apply:');if(!reason?.trim())return;
   put(path,'');put('intake.survey_notes',(configData.intake?.survey_notes||'')+'\n'+configLabel(key,path)+': Not applicable — '+reason.trim());render();
  }));
  // The actions sit on the title row, right justified, not under the input. Under it they read as
  // a control belonging to the next field down, and on a three-column grid they pushed every
  // neighbouring field out of alignment (owner, 15 November 2026). .intake-field-actions carries
  // margin-left:auto, so the heading's flex row does the justification.
  heading.appendChild(actions);
  input.addEventListener('input',()=>{
   if(input.value===''){if(required||pending)mark(path,true);else applyConfigInput(input);}
   else{applyConfigInput(input);mark(path,false);}
   box.dataset.unresolved=String(unresolved(path));
   message='Unsaved intake changes.';updateProgress();
  });
  if(path==='intake.approval_path')input.addEventListener('change',()=>{syncApprovalBasis();render();});
  if(path==='program.target_authority_primary'||path==='program.target_authority_secondary')input.addEventListener('change',render);
  if(path==='program.type'||/^intake\.(software|hardware|supplier)_scope$/.test(path))input.addEventListener('change',render);
  box.append(control);return box;
 }
 // The two brand colours are named-colour dropdowns, so each needs only enough width for a colour
 // name. They are paired into a single grid cell and sit side by side on one row rather than taking
 // a full column each (owner, 16 November 2026).
 const COLOR_PAIR=['program.brand_color_primary','program.brand_color_accent'];
 function card(title,fields,note){
  const c=node('section','intake-card');c.appendChild(node('h3','',title));
  if(note)c.appendChild(node('p','hint intake-section-note',note));
  const grid=node('div','intake-grid');
  const pairable=COLOR_PAIR.every(path=>fields.includes(path));
  let paired=false;
  fields.forEach(path=>{
   if(pairable&&COLOR_PAIR.includes(path)){
    if(paired)return;                       // the second colour is drawn inside the pair
    paired=true;
    const pair=node('div','intake-color-pair');
    COLOR_PAIR.forEach(colorPath=>pair.appendChild(field(colorPath)));
    grid.appendChild(pair);
    return;
   }
   grid.appendChild(field(path));
  });
  c.appendChild(grid);return c;
 }
 function progress(){const all=configFields().filter(f=>configRequired(f.path));const missing=all.filter(f=>unresolved(f.path)||String(configAt(f.path)??'').trim()==='');return {all,missing};}
 function updateProgress(){const el=$('intakeProgress');if(!el)return;const {all,missing}=progress();el.textContent=`${all.length-missing.length} of ${all.length} required configuration fields entered · ${openDecisionList().length} TBD decisions. Review the values before building.`;}
 // Split in two so each note sits in the info box of the field it is about: which authorities
 // are in scope belongs to Primary Authority, what the approval path implies belongs to
 // Approval Path. Both are reached on demand rather than printed under the card.
 function authorityNote(){const p=configData.intake?.approval_path||'',primary=configData.program?.target_authority_primary||'',secondary=configData.program?.target_authority_secondary||'';
 if(primary==='FAA'&&secondary!=='EASA'&&p!=='ETSO')return 'FAA-only scope: EASA certification rules and guidance are not applicable unless EASA approval or validation is also sought, or a contract/customer or installation requirement calls for them. RTCA standards may also carry EUROCAE ED identifiers; those are counterpart standard references, not a separate EASA approval requirement. For a TSO article, record installation approval separately because a TSO authorization alone does not approve installation.';
 if(p==='ETSO'||primary==='EASA'||secondary==='EASA')return 'EASA/ETSO requirements apply to the extent the program seeks EASA approval or validation. Record any FAA approval or validation separately and confirm the authority-specific basis and evidence with your certification lead.';
 return '';}
 function approvalPathNote(){const p=configData.intake?.approval_path||'';
 if(!p)return 'Choose the approval path separately from Aircraft, System or LRU. Your certification lead confirms the applicable basis, data and authority involvement.';
 if(p==='MILITARY')return 'Record the service airworthiness authority, military certification basis and agreed tailoring. This choice preserves the basis already entered; it does not apply civil FAA TSO requirements.';
 if(/TSOA|LODA/.test(p))return 'This profile records the article authorization and any aircraft installation work separately. Review the exact TSO, application data, production/quality evidence and installation limitations with your certification lead.';
 if(/TC|STC/.test(p))return 'Record the aircraft applicant and allocated requirements. The evidence package must follow the aircraft certification basis and the agreed supplier responsibilities.';
 return 'Record the agreed approval basis and application evidence with your certification lead. The profile is a planning input; it does not validate a complete submission package.';}
 function sectionRows(section,title){
  const c=node('section','intake-card'),head=node('div','intake-item-title');head.appendChild(node('h3','',title));head.appendChild(button('Add '+({'Environmental Evidence':'Evidence Row','Environmental Requirements':'Requirement Row'}[title]||title.replace(/s$/,'')),()=>addRow(section)));c.appendChild(head);
  const rows=configData[section]||[];
  if(!rows.length)c.appendChild(node('p','hint','No items entered. Add applicable items, or record No in the scope question.'));
  rows.forEach((item,i)=>{const sub=node('details','intake-card');sub.open=true;const summary=node('summary','intake-item-summary'),label=node('span','intake-item-summary-label',`${i+1}. ${item.name||(item.hw_id?item.hw_id+' / Section '+item.section:'New item')}${item.pn?' · '+item.pn:''}`),removeLabel=section==='suppliers'?'Remove this Supplier':section.startsWith('environmental_')?'Remove this Row':'Remove this Item',remove=makeRowIconButton('remove',removeLabel);remove.disabled=busy;remove.classList.add('intake-item-remove');remove.setAttribute('aria-label',`${removeLabel.replace('Remove this ','Remove ')}: ${item.name||item.id||'item'}`);remove.onclick=e=>{e.preventDefault();e.stopPropagation();if(!busy)removeRow(section,i);};summary.append(label);
   // Duplicate is offered where rows have an id of their own; environmental rows have none.
   const actions=node('div','intake-item-actions row-icon-group');
   if(!section.startsWith('environmental_')){
    // Duplicate and Remove are picture buttons beside each other (owner, 19 November 2026).
    const dup=makeRowIconButton('duplicate','Duplicate: copy this item\u2019s details into a new one. The copy gets its own ID and an empty PN.');
    dup.disabled=busy;dup.classList.add('intake-item-duplicate');
    dup.setAttribute('aria-label',`Duplicate ${item.name||item.id||'item'}`);
    dup.onclick=e=>{e.preventDefault();e.stopPropagation();if(!busy)duplicateRow(section,i);};
    actions.append(dup);
   }
   actions.append(remove);summary.classList.add('has-actions');sub.append(summary,actions);
   const grid=node('div','intake-grid');Object.keys({...templates[section],...item}).filter(k=>k!=='flow_down_letter_signed'&&!['software_control_category','worst_case_severity'].includes(k)||String(configData.program.cert_regime).startsWith('MILITARY')&&['software_control_category','worst_case_severity'].includes(k)).forEach(k=>grid.appendChild(field(`${section}[${i}].${k}`)));
   sub.appendChild(grid);c.appendChild(sub);
  });return c;
 }
 function refreshConfig(){if(typeof renderConfigTabs==='function'&&document.getElementById('configTabContent')?.offsetParent)renderConfigTabs();}
 function syncAll(){for(const section of Object.keys(configDraftMods._intakeRows||{}))syncRows(section);}
 function syncRows(section){
  configDraftMods._intakeRows??={};configDraftMods._intakeRows[section]=clone(configData[section]);
  for(const k of Object.keys(configDraftMods))if(k.startsWith(section+'['))delete configDraftMods[k];
 }
 function addRow(section,preset={}){const rows=configData[section]??=[];const limit={systems:25,software_items:55,hardware_items:55,suppliers:45,tools:55,environmental_baseline:495,environmental_flow_down:495}[section];if(rows.length>=limit){message='This workbook supports at most '+limit+' rows for this section.';render();return message;}
  // A new LRU's ID starts LRU.item_ (owner, 19 November 2026); a System keeps sys.item_.
  let n=1,prefix=section==='systems'&&String(preset.unit_type||'').toUpperCase()==='LRU'?'LRU':{systems:'sys',software_items:'sw',hardware_items:'hw',suppliers:'sup',tools:'tool'}[section],id;do{id=prefix+'.item_'+String(n++).padStart(3,'0');}while(rows.some(r=>r.id===id));
  // preset: values the new row starts with, e.g. unit_type when the System/LRU tab asked which to add.
  rows.push({...clone(templates[section]),...(!section.startsWith('environmental_')?{id}:{}),...preset});syncRows(section);const i=rows.length-1;
  for(const k of Object.keys(rows[i]))if(k!=='id'&&configRequired(`${section}[${i}].${k}`)||CONFIG_BOOLEAN_KEYS.has(k))mark(`${section}[${i}].${k}`,true);
  message='New item added. Enter its company-controlled PN and applicable details.';render();refreshConfig();return '';
 }
 // Duplicate a card (owner, v5.3.40): everything that saves typing is copied - parent system, DAL,
 // supplier, language, notes - while the two fields that must be unique are not. The id is derived
 // from the source so the pair is recognisable, and the PN is cleared because it is company
 // controlled and no two items may share one. The copy is appended rather than inserted, so the
 // indexes of existing rows, and the open-decision paths that reference them, do not move.
 function duplicateRow(section,index){
  const rows=configData[section]||[],source=rows[index];
  if(!source)return '';
  const limit={systems:25,software_items:55,hardware_items:55,suppliers:45,tools:55}[section];
  if(limit&&rows.length>=limit){message='This workbook supports at most '+limit+' rows for this section.';render();return message;}
  const copy=clone(source);
  const base=String(source.id||'').trim();
  if(base){let id=base+'_copy',n=2;while(rows.some(r=>r.id===id))id=base+'_copy'+(n++);copy.id=id;}
  else{let n=1,prefix=section==='systems'&&String(source.unit_type||'').toUpperCase()==='LRU'?'LRU':{systems:'sys',software_items:'sw',hardware_items:'hw',suppliers:'sup',tools:'tool'}[section],id;
   do{id=prefix+'.item_'+String(n++).padStart(3,'0');}while(rows.some(r=>r.id===id));copy.id=id;}
  if('pn' in copy)copy.pn='';
  if(copy.name)copy.name=String(copy.name)+' (copy)';
  rows.push(copy);syncRows(section);
  const i=rows.length-1;
  // Only the PN was cleared, so only the PN is unresolved. Everything else carries the source's
  // value and its resolved state; marking it all would hand the owner a page of false findings.
  if('pn' in copy)mark(`${section}[${i}].pn`,true);
  message=`Copied ${source.name||source.id||'the row'} as ${copy.id}. Give it its own PN and name before building.`;
  render();refreshConfig();return '';
 }
 function removeRow(section,index){
  const item=configData[section][index];if(!confirm('Remove '+(item.name||item.id)+' from this configuration draft? Review any references to its ID. Stored documents are retained.'))return;
  configData[section].splice(index,1);syncRows(section);
  const decisions=openDecisionList().filter(d=>!d.path.startsWith(`${section}[${index}].`)).map(d=>{const m=new RegExp('^'+section+'\\[(\\d+)\\]').exec(d.path);return m&&Number(m[1])>index?{...d,path:d.path.replace('['+m[1]+']','['+(Number(m[1])-1)+']')}:d;});commitOpenDecisions(decisions);render();refreshConfig();
 }
 async function responseData(r){const data=await r.json();if(!r.ok)throw Error(data.error+(data.detail?'\n'+data.detail:''));return data;}
 function fileOf(result){const bytes=Uint8Array.from(atob(result.workbook),c=>c.charCodeAt(0));return new File([bytes],result.filename,{type:result.mime});}
 function workbookName(value,fallback='Program_Config.xlsx'){
  let name=String(value||'').trim().split(/[\\/]/).pop().replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
  if(!name)name=fallback;if(!/\.xlsx$/i.test(name))name+='.xlsx';return name;
 }
 // Hosted sites have no Save As window on the server: the browser saves the workbook on the user's computer.
 async function browserDestination(suggested){
  if(window.showSaveFilePicker){
   try{const handle=await window.showSaveFilePicker({suggestedName:suggested,types:[{description:'Excel workbook',accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}}]});return {download:true,handle,name:workbookName(handle.name,suggested)};}
   catch(error){if(error?.name==='AbortError')return null;}
  }
  const name=prompt('Save the configuration workbook as (it downloads to your computer):',suggested);
  return name&&name.trim()?{download:true,name:workbookName(name.trim(),suggested)}:null;
 }
 async function deliverWorkbook(file,destination){
  const named=new File([file],destination.name,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  if(destination.handle){const writer=await destination.handle.createWritable();await writer.write(named);await writer.close();}
  else{const url=URL.createObjectURL(named),a=document.createElement('a');a.href=url;a.download=named.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  return named;
 }
 // A browser Save As window creates the file when the name is chosen. If the save then fails, remove that
 // file while it is still empty, so an empty "workbook" is not left on the computer.
 async function discardEmptyDestination(destination){try{if(destination?.handle&&(await destination.handle.getFile()).size===0)await destination.handle.remove?.();}catch{}}
 async function chooseWorkbookDestination(){
  const prefix=String(configData?.program?.doc_prefix||'Program').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,60)||'Program';
  const suggested=workbookName(selectedFile?.name||selectedDemoPath?.split('/').pop(),prefix+'_Config.xlsx');
  if(typeof isHostedService!=='undefined'&&isHostedService)return browserDestination(suggested);
  const response=await fetch('/api/config-save-as?name='+encodeURIComponent(suggested),{headers:authHeaders()});
  const result=await response.json().catch(()=>({error:'The Save As response could not be read.'}));
  if(!response.ok||result.error)throw Error(result.error||'Save As could not be opened.');
  return result.cancelled?null:{token:result.token,name:workbookName(result.filename,suggested)};
 }
 async function writeWorkbook(file,destination){
  if(destination.download)return deliverWorkbook(file,destination);
  const named=new File([file],destination.name,{type:file.type||'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),body=new FormData();
  body.append('workbook',named);body.append('token',destination.token);
  const response=await fetch('/api/config-save-file',{method:'POST',headers:authHeaders(),body});
  const result=await response.json().catch(()=>({error:'The saved-workbook response could not be read.'}));
  if(!response.ok||result.error)throw Error(result.error||'The configuration workbook could not be saved.');
  return new File([named],result.filename,{type:named.type});
 }
 async function start(){
  if(busy)return;
  if(configData&&!confirm('Start a new intake? The currently loaded configuration will be replaced in this browser. Save any edits first. Stored repository documents are retained.'))return;
  busy=true;message='Creating a blank '+newKind.toLowerCase()+' configuration…';render();
  const request=++parseRequestId;window.repoUI?.invalidateSwitch();
  try{const result=await fetch('/api/intake/new',{method:'POST',headers:{...authHeaders(),'Content-Type':'application/json'},body:JSON.stringify({type:newKind})}).then(responseData);if(request!==parseRequestId)return;window.repoWorkbook.apply(fileOf(result),result.data);await window.repoUI?.forConfiguration();step=0;message='Blank configuration created. A and DO-160G are initial defaults; confirm them. Complete each step or keep unresolved inputs as TBD.';}
  catch(e){message=e.message;}finally{busy=false;render();}
 }
 function collectMods(){
  for(const f of configFields())if(configRequired(f.path)&&String(configAt(f.path)??'').trim()==='')mark(f.path,true);
  // Capture current values after Config Data edits, then drop obsolete row-index cell patches.
  for(const section of Object.keys(configDraftMods._intakeRows||{}))syncRows(section);
  return clone(configDraftMods);
 }
 async function createWorkbook(){
  if(busy||!configData)return;
  let destination;try{destination=await chooseWorkbookDestination();}catch(error){message='The Save As window could not be opened: '+error.message;render();return;}
  if(!destination){message='Save cancelled. Your configuration changes are still in this browser.';render();return;}
  const mods=collectMods(),source=selectedFile,sourceDemo=selectedDemoPath,dataRef=configData,request=parseRequestId;
  busy=true;message='Creating the config workbook…';render();
  try{
   let file=source;
   if(!file&&sourceDemo){const r=await fetch('/api/intake/demo-file',{method:'POST',headers:{...authHeaders(),'Content-Type':'application/json'},body:JSON.stringify({path:sourceDemo})});if(!r.ok)throw Error('Could not read the selected sample workbook.');file=new File([await r.blob()],sourceDemo.split('/').pop());}
   if(!file)throw Error('Load a workbook or start a new intake first.');
   const body=new FormData();body.append('workbook',file);body.append('modifications',JSON.stringify(mods));
   const result=await fetch('/api/intake/workbook',{method:'POST',headers:authHeaders(),body}).then(responseData);
   const saved=await writeWorkbook(fileOf(result),destination);
   if(dataRef===configData&&request===parseRequestId){window.repoWorkbook.apply(saved,result.data);await window.repoUI?.forConfiguration();message='Saved and loaded '+saved.name+'. The Build tab now uses this workbook. '+(openDecisionList().length?`${openDecisionList().length} TBD decisions remain; resolve them before building.`:'Review Config Data and the applicable engineering evidence before building.');}
  }catch(e){message=e.message;await discardEmptyDestination(destination);}finally{busy=false;render();}
 }
 function reviewNotes(){
  const {missing}=progress();
  const notes=[`Company: ${configData.program.customer_name||'TBD'}`,`Program: ${configData.program.name||'TBD'}`,`Boundary: ${configData.program.type}`,`Approval path: ${pathLabels[configData.intake?.approval_path]||'TBD'}`,`${missing.length} required fields still need answers. ${openDecisionList().length} decisions are marked TBD.`];
  for(const [key,section] of [['software_scope','software_items'],['hardware_scope','hardware_items'],['supplier_scope','suppliers']]){const answer=configData.intake?.[key];if(answer==='Yes'&&!configData[section]?.length)notes.push(configTitle(section)+': scope is Yes but no rows have been entered.');if(answer==='No'&&configData[section]?.length)notes.push(configTitle(section)+': scope is No but rows are still configured. Review them before building.');}
  const expected=paths[configData.intake?.approval_path];if(expected&&expected!==configData.program.cert_basis_type)notes.push('Approval Path and Certification Basis Type differ. Correct them in Approval & Scope before building.');
  if(configYes(configData.program.do160_in_scope)){const ids=new Set((configData.hardware_items||[]).map(h=>h.id));for(const section of ['environmental_baseline','environmental_flow_down'])(configData[section]||[]).forEach((r,i)=>{if((r.hw_id||r.section)&&!ids.has(r.hw_id))notes.push(`${configTitle(section)} row ${i+1}: hardware item "${r.hw_id||''}" is not a configured Hardware Item ID.`);});}
  for(const s of configData.suppliers||[])if(s.outside_us_percent!==''&&s.outside_us_percent!=null&&(!Number.isFinite(Number(s.outside_us_percent))||Number(s.outside_us_percent)<0||Number(s.outside_us_percent)>100))notes.push('Outside-US work percentage for '+(s.name||s.id)+' must be between 0 and 100.');
    return {notes,missing};
 }
 function reviewPanel(){
  if(!configData)return null;const {notes,missing}=reviewNotes();const out=node('details','config-review');out.open=notes.length>5||missing.length>0;
  out.appendChild(node('summary','','Review checks'));const list=node('ul','intake-review-list');notes.forEach(n=>list.appendChild(node('li','',n)));out.appendChild(list);
  if(missing.length){const ul=node('ul','intake-review-list');missing.forEach(f=>ul.appendChild(node('li','',f.label)));const d=node('details');d.appendChild(node('summary','',`Required fields to complete (${missing.length})`));d.appendChild(ul);out.appendChild(d);}
  return out;
 }
 // Moving to another intake step (Continue, Back or a step tab) starts at the top of that step.
 function toTop(target){requestAnimationFrame(()=>{const el=document.querySelector('.main-tab-bar')||target||document.getElementById('panel-intake');if(!el)return;const chrome=document.getElementById('appChrome')?.offsetHeight||0;const y=el.getBoundingClientRect().top+window.scrollY-chrome-8;window.scrollTo({top:Math.max(0,y),behavior:'auto'});});}
 function render(){
  if(!host)return;syncApprovalBasis();host.replaceChildren();
  const heading=node('div','intake-heading'),text=node('div');text.appendChild(node('h2','','Program Intake'));text.appendChild(node('p','hint','Set up your program, record its approval path and collect the program and people information used by the config workbook. Enter systems, items, suppliers, tools and environmental data in Config Data. Answers are shared with Config Data. Save a workbook to keep your progress.'));
  heading.appendChild(text);const actions=node('div','intake-actions');
  // A program carries ONE boundary (owner, 16 November 2026). This picker chooses what a NEW intake
  // will be, so it only belongs on an empty screen: once a program exists the single setting is the
  // Program Type field in step 1. Shown alongside it, the two disagreed the moment either changed -
  // setting the field to LRU left this reading SYSTEM.
  if(!configData){
   const select=document.createElement('select');select.setAttribute('aria-label','New program boundary');
   for(const type of ['LRU','SYSTEM','AIRCRAFT'])select.add(new Option(type==='LRU'?'LRU':configTitle(type.toLowerCase()),type));
   select.value=newKind;select.disabled=busy;select.onchange=()=>newKind=select.value;
   actions.append(select,button('Start New Intake',start));
  } else {
   actions.appendChild(button('Start New Intake',start));
  }actions.appendChild(button('Load Existing Config',()=>{switchMainTab('build');$('fileInput').click();}));actions.appendChild(button('Save Configuration Workbook',createWorkbook,false));actions.lastChild.disabled=busy||!configData;heading.appendChild(actions);host.appendChild(heading);
  const status=node('p','hint intake-status',message);status.setAttribute('role','status');host.appendChild(status);
  if(!configData){host.appendChild(node('div','intake-empty','Choose Aircraft, System or LRU and start a blank intake, or load a saved workbook.'));return;}
  configData.intake??={};for(const key of Object.keys(intakeMeta).filter(k=>!['country','work_countries','outside_us_percent','percentage_basis','oversight_notes'].includes(k)))configData.intake[key]??='';
  const nav=node('nav','intake-steps');nav.setAttribute('aria-label','Intake steps');stages.forEach((name,i)=>{const b=button(`${i+1}. ${name}`,()=>{step=i;message='';render();toTop();});if(step===i)b.setAttribute('aria-current','step');nav.appendChild(b);});host.appendChild(nav);const prog=node('p','intake-progress');prog.id='intakeProgress';host.appendChild(prog);
  if(step===0){host.appendChild(card('Company And Program',['program.customer_name','intake.cage_code','intake.company_address','program.customer_short_name','program.name','program.short_name','program.type','program.doc_prefix','program.doc_revision','intake.survey_owner','intake.product_description','program.no_end_user','program.purchaser_name','program.purchaser_address','program.contract_number','program.export_control_marking','program.distribution_statement','program.document_retention_years']));if(configData.program.type==='AIRCRAFT')host.appendChild(card('Aircraft And Operational Context',['program.mtow_kg','program.passenger_count','program.annual_flight_hours']));host.appendChild(card('Branding',['program.brand_color_primary','program.brand_color_accent','program.logo_path']));}
  if(step===1){host.appendChild(card('Approval And Aircraft Integration',['intake.approval_path','intake.separate_cdp','program.cert_basis_type','program.target_authority_primary','program.target_authority_secondary','program.cert_basis_part','program.tso_category','program.cert_regime','intake.authority_project_reference']));if(/TC|STC/.test(configData.intake.approval_path))host.appendChild(card('Aircraft Applicant And Allocations',['intake.installation_applicant','intake.installation_basis']));host.appendChild(card('Technical Scope',['intake.software_scope','intake.hardware_scope','intake.supplier_scope','program.do160_in_scope','program.do160_revision','program.security_assurance_level']));host.appendChild(card('Safety Inputs',Object.keys(configData.safety||{}).map(k=>'safety.'+k),'Enter allocated classifications, scope and counts from your safety work. Leave unfinished assessment results as TBD.'));host.appendChild(card('Authority Coordination',configObjectEntries(configData.authority||{},'authority').filter(f=>!f.path.startsWith('authority.items')).map(f=>f.path)));}
  if(step===2){for(const [role,person] of Object.entries(configData.personnel||{}))if(person&&typeof person==='object')host.appendChild(card(configTitle(role),['name','email','title','signatory'].map(k=>'personnel.'+role+'.'+k)));host.appendChild(card('Assurance Independence',['personnel.independence_mechanism','personnel.independence_description']));host.appendChild(card('Target Dates',CONFIG_DATE_ORDER.map(k=>'program.'+k),'Use YYYY-MM-DD, TBD, or Not applicable: followed by the reason. Milestone timing is agreed by the program.'));host.appendChild(card('Remaining Intake Notes',['intake.survey_notes']));}
  const footer=node('div','intake-footer');footer.appendChild(button('Back',()=>{step=Math.max(0,step-1);render();toTop();}));if(step===stages.length-1){footer.appendChild(button('Save Configuration Workbook',createWorkbook));footer.appendChild(button('Continue to Config Data',()=>{switchMainTab('config');renderConfigTabs();toTop(document.getElementById('panel-config'));},false));}else footer.appendChild(button('Continue',()=>{step++;render();toTop();},false));host.appendChild(footer);updateProgress();if(typeof enhanceDateInputs==='function')enhanceDateInputs(host);
  if(busy)host.querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=true);
  if(typeof sizeRowIconButtons==='function')sizeRowIconButtons(host);
 }
 window.addEventListener('beforeunload',event=>{if(Object.keys(configDraftMods).length){event.preventDefault();event.returnValue='';}});
 // File → New Program Intake: open the intake at the top with the program type ready to choose.
 function prepareNew(){if(busy)return;message='Choose Aircraft, System or LRU, then select Start New Intake.';render();toTop();host.querySelector('.intake-actions select')?.focus();}
 // File → Save Configuration (outside Config Data): the intake save, or a prompt when nothing is loaded.
 function save(){if(busy)return;if(!configData){message='Nothing to save yet. Start a new intake or load a configuration first.';render();toTop();return;}toTop();createWorkbook();}
 window.intakeUI={prepareNew,save,render,chooseWorkbookDestination,deliverWorkbook,discardEmptyDestination,addRow,removeRow,duplicateRow,lastMessage:()=>message,reviewPanel,syncAll,canAddRows:section=>section in templates};render();
})();
