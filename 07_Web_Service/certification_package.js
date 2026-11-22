import fs from 'node:fs';
import {validate} from './config_validation.bundle.js';
import path from 'node:path';
import crypto from 'node:crypto';
import {RepositoryError,digest,safeName} from './repository_store.js';
export const catalog=JSON.parse(fs.readFileSync(new URL('./certification-catalog.json',import.meta.url),'utf8'));
const fail=(message,status=400)=>{throw new RepositoryError(message,status);};
const clean=(v,max=4000)=>String(v??'').trim().slice(0,max);
const required=(v,label)=>{const s=clean(v);if(!s)fail(label+' is required.');return s;};
const hash=x=>digest(Buffer.from(JSON.stringify(x)));
const checked=(p,body)=>{required(body.actor,'User name');if(body.expectedRevision!==p.revision)fail('The program changed. Refresh the checklist before saving.',409);};
const now=()=>new Date().toISOString();
const copy=x=>structuredClone(x);
function profileRows(p){
 const data=p.configuration?.data||{},profile=data.intake?.approval_path||'';
 const groups=new Set(['Common']);if(profile.startsWith('TSOA'))groups.add('TSO authorization');if(/TC|STC/.test(profile))groups.add('Aircraft integration');
 return [...catalog.rows.filter(r=>groups.has(r.group)),...(p.certificationPackage?.customRows||[])].map(r=>({...r,defaultRequired:r.condition==='required'||r.condition==='applicant'&&!profile.startsWith('SUPPLIER_')&&!profile.startsWith('TSOA_')||['software','hardware','suppliers','environment'].includes(r.condition)&&scope(data,r.condition)}));
}
function scope(d,key){if(key==='environment')return d.program?.do160_in_scope===true||d.program?.do160_in_scope==='Yes';const k={software:'software_items',hardware:'hardware_items',suppliers:'suppliers'}[key];return (d[k]?.length||0)>0||d.intake?.[{software:'software_scope',hardware:'hardware_scope',suppliers:'supplier_scope'}[key]]==='Yes';}
function scopeFingerprint(p,rows){return hash({config:p.configuration?.hash,catalog:catalog.version,rows:rows.map(r=>[r.id,r.title,r.group,r.reference,r.defaultRequired,p.certificationPackage?.records?.[r.id]?.applicability])});}
export function assessPackage(p){
 const config=p.configuration, data=config?.data||{},profile=data.intake?.approval_path||'',supported=catalog.supportedProfiles.includes(profile),defs=profileRows(p),records=p.certificationPackage?.records||{};
 const blockers=[];if(!config)blockers.push('Save a configuration workbook for this repository program.');if(!supported)blockers.push('Select a supported FAA TSOA or TC/STC path. Other approval paths require a separate authority-specific review; this checklist cannot establish their readiness.');
 if(data.program?.target_authority_primary!=='FAA')blockers.push('This starter checklist covers FAA paths. Confirm an FAA primary authority or use an authority-specific review.');
 if((data._openDecisions||[]).length)blockers.push(`${data._openDecisions.length} configuration decisions are still TBD.`);
 if(config){try{for(const f of validate(data).filter(f=>f.severity==='Blocker'))blockers.push('Configuration: '+f.message);}catch{blockers.push('The saved workbook needs to be loaded and saved again before its inputs can be validated.');}}
 if(profile.startsWith('TSOA')&&!/^TSO[- ]?C\d+/i.test(String(data.program?.tso_category||'')))blockers.push('Identify the exact FAA TSO number/revision before preparing a TSO review package. An illustrative or TBD category is not a confirmed TSO.');
 if(!p.underDocumentControl)blockers.push('Enable document control and review/release the evidence versions before preparing a review package.');
 const rows=defs.map(def=>{
  const rec=records[def.id]||{},issues=[],applicability=def.defaultRequired?'Required':rec.applicability||'Unreviewed';
  if(applicability==='Unreviewed')issues.push('Decide whether this record applies.');
  if(applicability==='Not applicable'&&!rec.note)issues.push('Explain why this record does not apply.');
  if(rec.configHash!==config?.hash||rec.catalogVersion!==catalog.version||!rec.reviewedAt)issues.push('Review this row against the current configuration and source baseline.');
  const evidence=(rec.entries||[]).map(e=>{
   const d=p.documents.find(d=>d.id===e.documentId),v=d?.versions.find(v=>v.id===e.versionId);
   if(!d||!v){issues.push('A linked document version is missing.');return {...e,missing:true};}
   if(v.status!=='Released')issues.push(`${d.pn} is a draft or candidate.`);
   if(d.head!==v.id||d.released!==v.id)issues.push(`${d.pn} has a newer working or released version. Reconcile and reselect the evidence.`);
   if(d.checkout)issues.push(`${d.pn} is checked out.`);
   if(def.kind==='issued'&&!importedOrigin(d,v))issues.push(`${d.pn} needs an imported/checked-in issuer record, not only generated content.`);
   return {...e,pn:d.pn,title:d.title,label:v.label,filename:v.filename,hash:v.hash,status:v.status};
  });
  if(applicability==='Required'&&!evidence.length)issues.push('Link at least one reviewed evidence version.');
  if(applicability==='Required'&&def.kind==='issued'&&(!rec.issuer||!rec.recordReference||!validDate(rec.issueDate)||!rec.issuedRecordConfirmed))issues.push('Record issuer, reference, issue date and confirmation that the actual issued record was reviewed.');
  if(applicability==='Required'&&!rec.note)issues.push('Record the scope and outcome of the evidence review.');
  return {...def,applicability,record:rec,evidence,issues:[...new Set(issues)],complete:!issues.length,sources:def.sources.map(id=>catalog.sources[id]).filter(Boolean)};
 });
 const scopeHash=scopeFingerprint(p,defs),review=p.certificationPackage?.scopeReview;
 if(review?.fingerprint!==scopeHash)blockers.push('The certification lead must review the exact basis, add every missing project requirement, and confirm the checklist scope.');
 const incomplete=rows.filter(r=>!r.complete);if(incomplete.length)blockers.push(`${incomplete.length} checklist records need attention.`);
 const ready=!blockers.length;
 return {catalogVersion:catalog.version,verifiedOn:catalog.verifiedOn,description:catalog.description,profile,supported,programId:p.id,programName:p.name,configHash:config?.hash||'',expectedRevision:p.revision,rows,blockers,ready,status:ready?'Ready for certification lead review':'Preparation in progress',completed:rows.length-incomplete.length,total:rows.length,scopeHash,scopeReview:review||null,snapshots:(p.packageSnapshots||[]).map(s=>({id:s.id,name:s.name,createdAt:s.createdAt,actor:s.actor,comment:s.comment,status:s.status,fileCount:s.entries.length}))};
}
function importedOrigin(d,v,seen=new Set()){if(seen.has(v.id))return false;seen.add(v.id);if(['import','checkin'].includes(v.source?.kind))return true;const base=d.versions.find(x=>x.id===v.baseVersionId);return base?importedOrigin(d,base,seen):false;}
function validDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(s||'')&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s&&s<=now().slice(0,10);}
function state(p){return p.certificationPackage??={records:{},customRows:[]};}
export function savePackageRow(store,id,rowId,body){return store.transaction(id,p=>{
 checked(p,body);const def=profileRows(p).find(x=>x.id===rowId);if(!def)fail('Checklist record not found.',404);
 if(!['Required','Not applicable','Unreviewed'].includes(body.applicability))fail('Choose an applicability decision.');
 if(def.defaultRequired&&body.applicability!=='Required')fail('This is a required record for the selected scope.');
 const entries=body.entries||[];if(!Array.isArray(entries)||entries.length>300)fail('Choose up to 300 evidence versions per record.');
 const seen=new Set();for(const e of entries){const d=store.doc(p,e.documentId);store.version(d,e.versionId);if(seen.has(d.id))fail('Select one version per document for each requirement.');seen.add(d.id);}
 if(body.applicability==='Not applicable'&&!clean(body.note))fail('Explain the not-applicable decision.');
 if(body.applicability==='Not applicable'&&entries.length)fail('Remove evidence links before excluding a record.');
 if(body.issueDate&&!validDate(body.issueDate))fail('Use a valid issue date that is not in the future.');
 const s=state(p);s.records[rowId]={applicability:body.applicability,note:clean(body.note),entries:entries.map(({documentId,versionId})=>({documentId,versionId})),issuer:clean(body.issuer,500),recordReference:clean(body.recordReference,500),issueDate:clean(body.issueDate,10),issuedRecordConfirmed:body.issuedRecordConfirmed===true,configHash:p.configuration?.hash||'',catalogVersion:catalog.version,reviewedAt:body.reviewed===true?now():null,reviewedBy:body.reviewed===true?clean(body.actor,500):null};
 store.audit(p,'certification-record-updated',body.actor,{record:rowId,recordData:s.records[rowId]});return {ok:true};
});}
export function addPackageRequirement(store,id,body){return store.transaction(id,p=>{
 checked(p,body);const s=state(p);if(s.customRows.length>=100)fail('This program already has 100 additional requirements.');
 const group=['Common','TSO authorization','Aircraft integration'].includes(body.group)?body.group:'Common';
 const row={id:'project-'+crypto.randomUUID(),title:required(body.title,'Requirement title').slice(0,300),group,condition:'review',kind:body.kind==='issued'?'issued':'applicant',reference:required(body.reference,'Requirement / source reference').slice(0,1000),help:clean(body.help),sources:[],projectSpecific:true};
 s.customRows.push(row);s.records[row.id]={applicability:'Required',entries:[]};store.audit(p,'certification-requirement-added',body.actor,{row});return copy(row);
});}
export function confirmPackageScope(store,id,body){return store.transaction(id,p=>{
 checked(p,body);if(body.confirm!==true)fail('Confirm that the complete project-specific scope was reviewed.');
 const a=assessPackage(p);if(!a.supported)fail('This profile needs an authority-specific checklist before scope can be confirmed.');
 const s=state(p);s.scopeReview={fingerprint:a.scopeHash,note:required(body.note,'Scope review reference and rationale'),reviewer:required(body.actor,'Certification lead / reviewer'),at:now()};store.audit(p,'certification-scope-reviewed',body.actor,s.scopeReview);return {ok:true};
});}
export function createPackageSnapshot(store,id,body){return store.transaction(id,async p=>{
 checked(p,body);const a=assessPackage(p);if(!a.ready)fail('Resolve the checklist findings before preparing a review package.',409);
 const entries=[];const seen=new Set();for(const row of a.rows)if(row.applicability==='Required')for(const e of row.evidence){const key=row.group+'::'+e.documentId;if(seen.has(key))continue;seen.add(key);await store.bytes(e.hash);entries.push({...e,group:row.group,path:row.group+'/'+safeName(e.pn+'_'+e.title.slice(0,40)+'_Rev '+e.label)+'_'+e.documentId.slice(0,8)+path.extname(e.filename)});}
 await store.bytes(p.configuration.hash);
 const snap={id:crypto.randomUUID(),name:required(body.name,'Package name').slice(0,100),createdAt:now(),actor:clean(body.actor,500),comment:required(body.comment,'Package note'),workbook:{hash:p.configuration.hash,filename:p.configuration.filename},entries,report:a,catalog:copy(catalog),status:'Prepared for certification lead review — not an authority approval'};
 p.packageSnapshots??=[];p.packageSnapshots.push(snap);store.audit(p,'certification-review-package-created',body.actor,{snapshot:snap.id,entries:entries.length,configHash:p.configuration.hash});return {id:snap.id,name:snap.name};
});}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function packageReport(a){return `<!doctype html><html lang="en"><meta charset="utf-8"><title>ISAF certification preparation review</title><style>body{font:15px/1.5 Arial;margin:32px;color:#21354c}table{border-collapse:collapse;width:100%;margin:24px 0}th,td{border:1px solid #cdd5df;padding:10px;text-align:left;vertical-align:top}th{background:#eaf0f7}p{max-width:1000px}@media print{tr{break-inside:avoid}}</style><h1>${esc(a.programName)} — Certification preparation review</h1><p><b>${esc(a.status)}</b> · Profile ${esc(a.profile||'Not selected')} · ${a.completed}/${a.total} records reviewed</p><p>${esc(a.description)}</p><p>Source baseline checked ${esc(a.verifiedOn)}. Workbook hash: ${esc(a.configHash)}</p><ul>${a.blockers.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p>Scope review: ${esc(a.scopeReview?.reviewer||'Pending')} · ${esc(a.scopeReview?.note||'')}</p><table><tr><th>Requirement</th><th>Decision and evidence</th><th>Findings and review</th></tr>${a.rows.map(r=>`<tr><td>${esc(r.group)}<br><b>${esc(r.title)}</b><br>${esc(r.reference)}<p>${esc(r.help)}</p>${r.sources.map(s=>`<a href="${esc(s.url)}">${esc(s.title)}</a><br>`).join('')}</td><td>${esc(r.applicability)}<br>${r.evidence.map(e=>esc(`${e.pn||'Missing'} · ${e.label||''} · ${e.title||''}`)).join('<br>')}</td><td>${esc(r.complete?'Reviewed':r.issues.join(' '))}<p>${esc(r.record.note)}</p>${esc(r.record.reviewedBy||'')} ${esc(r.record.reviewedAt||'')}<p>${esc(r.record.issuer||'')} ${esc(r.record.recordReference||'')} ${esc(r.record.issueDate||'')}</p></td></tr>`).join('')}</table><p>Prepared files are review copies. Obtain applicable FAA decisions, authorization letters, TC/STC certificates, installation approval and production/release records through their authorized processes. These are not created or signed by ISAF. Names entered in ISAF are activity labels, not authenticated signatures.</p></html>`;}
