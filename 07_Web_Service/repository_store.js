import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ensureDemoWatermarkSync,updateDocxRevisionSync,updateDocxRevisionOffThread} from './docx_revision.js';
import {FileObjectStore} from './persistence/object_store.js';
import {inspectDocx,refreshDocx,syncStoredValues} from './value_refresh.js';

const DEMO_EDITION=(()=>{try{return JSON.parse(fs.readFileSync(new URL('../EDITION.json',import.meta.url),'utf8')).edition==='demo';}catch{return false;}})();

export class RepositoryError extends Error { constructor(message,status=409){super(message);this.status=status;} }
const fail=(message,status=409)=>{throw new RepositoryError(message,status);};
const now=()=>new Date().toISOString();
const id=()=>crypto.randomUUID();
export const digest=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const copy=value=>structuredClone(value);
const text=(value,max=500)=>String(value??'').trim().slice(0,max);
function required(value,label){const v=text(value);if(!v)fail(`${label} is required.`,400);return v;}
function safeId(value){if(!/^[a-f0-9-]{36}$/.test(String(value)))fail('Invalid repository identifier.',400);return value;}
export function safeName(value){const name=String(value||'document').replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').slice(0,180);return name==='.'||name==='..'?'document':name;}
function nextMajor(major){if(!/^(?:[A-Z]+|[0-9]+)$/.test(major))fail('Enter the next release revision explicitly for this revision format.',400);if(/^\d+$/.test(major))return String(Number(major)+1);let n=0;for(const c of major)n=n*26+c.charCodeAt(0)-64;n++;let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
const actorName=actor=>required(actor,'Your name');
const tokenHash=token=>digest(Buffer.from(String(token||'')));

export class RepositoryStore {
 constructor(root,{demoEdition=DEMO_EDITION,objectStore}={}){this.root=path.resolve(root);this.demoEdition=demoEdition===true;fs.mkdirSync(path.join(this.root,'programs'),{recursive:true});this.objectStore=objectStore||new FileObjectStore(path.join(this.root,'blobs'));}
 programPath(programId){return path.join(this.root,'programs',safeId(programId));}
 read(programId){const p=path.join(this.programPath(programId),'program.json');if(!fs.existsSync(p))fail('Program not found.',404);return JSON.parse(fs.readFileSync(p,'utf8'));}
 public(program){const p=copy(program);delete p.records;if(p.configuration)delete p.configuration.data;if(p.packageSnapshots)p.packageSnapshots=p.packageSnapshots.map(s=>({id:s.id,name:s.name,createdAt:s.createdAt,status:s.status,fileCount:s.entries.length}));for(const d of p.documents)if(d.checkout)delete d.checkout.tokenHash;return p;}
 list(){return fs.readdirSync(path.join(this.root,'programs')).filter(n=>/^[a-f0-9-]{36}$/.test(n)).map(n=>this.read(n)).map(p=>({id:p.id,name:p.name,company:p.company,prefix:p.prefix,underDocumentControl:p.underDocumentControl,documentCount:p.documents.length,updatedAt:p.updatedAt}));}
 write(program){const folder=this.programPath(program.id),temp=path.join(folder,`program-${id()}.tmp`);fs.mkdirSync(folder,{recursive:true});const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(program,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,path.join(folder,'program.json'));}
 audit(p,action,actor,detail){const prior=p.events.at(-1)?.hash||'';const event={id:id(),at:now(),actor:actorName(actor),action,detail,previousHash:prior};event.hash=digest(Buffer.from(JSON.stringify(event)));p.events.push(event);}
 transaction(programId,fn){const folder=this.programPath(programId);if(!fs.existsSync(folder))fail('Program not found.',404);const lock=path.join(folder,'.transaction-lock');try{fs.mkdirSync(lock);}catch(e){if(e.code==='EEXIST')fail('Program is being updated. Retry shortly.');throw e;}let released=false;const release=()=>{if(!released){released=true;fs.rmdirSync(lock);}};const commit=(p,result)=>{p.revision++;p.updatedAt=now();this.write(p);return result;};try{const p=this.read(programId);const result=fn(p);if(result?.then)return result.then(value=>commit(p,value)).finally(release);const value=commit(p,result);release();return value;}catch(e){release();throw e;}}
 create({name,company,prefix},actor){const p={id:id(),name:required(name,'Program name'),company:required(company,'Company'),prefix:text(prefix,40),revision:0,createdAt:now(),updatedAt:now(),underDocumentControl:false,everControlled:false,documents:[],builds:[],baselines:[],events:[]};this.audit(p,'program-created',actor,{name:p.name});this.write(p);return this.public(p);}
 ensure(identity,actor,programId){if(programId){const p=this.read(programId);if(p.name!==identity.name||p.company!==identity.company||p.prefix!==identity.prefix)fail('The workbook identity differs from the selected repository program. Select the matching program or create a new one.',422);return p;}
  // Serialize identity lookup/create across service processes.
  const lock=path.join(this.root,'.program-create-lock');try{fs.mkdirSync(lock);}catch(e){if(e.code==='EEXIST')fail('Another program is being created. Retry shortly.');throw e;}try{const matches=this.list().filter(p=>p.name===identity.name&&p.company===identity.company&&p.prefix===identity.prefix);if(matches.length>1)fail('Select the intended repository program before building.');return matches.length?this.read(matches[0].id):this.create(identity,actor);}finally{fs.rmdirSync(lock);}}
 blob(bytes){return this.objectStore.put(bytes);}
 // Support records (owner, 22 November 2026): the build record, source workbook and reports of each build, and the
 // copies of documents that a build or an Import update replaced in the user's folder. They are kept here, with the
 // program, instead of in the user's folder, and only Admins see them (support.records). They are left out of
 // public(), so a User's view of the register does not list them.
 addRecord(programId,{kind,title,actor,buildId=null,files}){return this.transaction(programId,async p=>{
  const stored=[],seen=new Set();
  for(const f of files||[]){if(!f?.bytes)continue;let name=String(f.name||'file').replace(/\\/g,'/').split('/').filter(x=>x&&x!=='.'&&x!=='..').map(safeName).join('/')||'file';
   for(let n=2;seen.has(name);n++)name=name.replace(/( \(\d+\))?(\.[^./]*)?$/,(m,_,ext)=>` (${n})${ext||''}`);seen.add(name);
   stored.push({name,role:f.role==='replaced'?'replaced':'report',...await this.blob(Buffer.isBuffer(f.bytes)?f.bytes:Buffer.from(f.bytes))});}
  if(!stored.length)return null;
  const r={id:id(),kind:kind==='import'?'import':'build',title:text(title,200)||(kind==='import'?'Import update':'Build'),buildId,createdAt:now(),actor:actorName(actor),files:stored};
  (p.records||=[]).push(r);this.audit(p,'records-kept',actor,{record:r.id,kind:r.kind,files:stored.length});return copy(r);});}
 async records(programId){return copy((await this.read(programId)).records||[]).reverse();}
 async record(programId,recordId){const r=((await this.read(programId)).records||[]).find(x=>x.id===recordId);if(!r)fail('Record not found.',404);return copy(r);}
 bytes(hash){const finish=bytes=>this.demoEdition&&bytes.subarray(0,2).toString()==='PK'?ensureDemoWatermarkSync(bytes):bytes;const result=this.objectStore.get(hash);return result?.then?result.then(finish):finish(result);}
 doc(p,docId){const d=p.documents.find(d=>d.id===docId);if(!d)fail('Document not found.',404);return d;}
 version(d,versionId){const v=d.versions.find(v=>v.id===versionId);if(!v)fail('Document version not found.',404);return v;}
 async addVersion(d,bytes,{actor,filename,source,comment,major,status='Draft',baseVersionId=null,fingerprint=null}){
  const base=baseVersionId?this.version(d,baseVersionId):d.head?this.version(d,d.head):null;
  major=major||base?.major||'A';if(!/^[A-Za-z0-9][A-Za-z0-9.-]{0,11}$/.test(major))fail('Use a filename-safe release revision (1–12 letters, digits, periods or hyphens).',400);
  const minor=Math.max(0,...d.versions.filter(v=>v.major===major&&v.status!=='Released').map(v=>v.minor))+1;
  // Every unreleased version is named <revision>-draft.<n>, one count per revision (owner, 22 November 2026). A
  // version waiting for review (status Candidate) is shown as "Pending review" in the register, not in its name.
  const newLabel=status==='Released'?major:`${major}-draft.${minor}`;
  if(['generated','template-candidate','candidate-accepted','refreshed'].includes(source?.kind)&&path.extname(filename).toLowerCase()==='.docx'&&bytes.subarray(0,2).toString()==='PK'){
   bytes=(await updateDocxRevisionOffThread(bytes,newLabel,{filename:safeName(`${d.pn}_${d.title.slice(0,45)}_Rev ${newLabel}.docx`)})).bytes;
   if(this.demoEdition)bytes=ensureDemoWatermarkSync(bytes);
   // Stamping changes generated text; the stored generated values follow it (value_refresh.js). Not for a
   // refreshed document: its controls may hold customer text, which must not become the generated value.
   if(source.kind!=='refreshed')bytes=syncStoredValues(bytes);
  }
  const v={id:id(),...await this.blob(bytes),filename:safeName(filename),major,minor:status==='Released'?0:minor,label:newLabel,status,createdAt:now(),actor:actorName(actor),comment:required(comment,'Change summary'),source,baseVersionId:base?.id||null,fingerprint:fingerprint||base?.fingerprint||null};d.versions.push(v);return v;
 }
 newDoc(p,meta){const pn=required(meta.pn,'Document PN');if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(pn))fail('Use 1–100 letters, digits, periods, underscores or hyphens for the document PN.',400);if(p.documents.some(d=>d.pn.toLowerCase()===pn.toLowerCase()))fail('This document PN already exists. Check in a new version instead.');const d={id:id(),pn,title:required(meta.title,'Document title'),category:text(meta.category)||'Other',item:text(meta.item),milestone:text(meta.milestone),owner:text(meta.owner),reviewers:text(meta.reviewers),targetDate:text(meta.targetDate),delivery:text(meta.delivery)||'Internal',dependencies:[],workflow:'In preparation',versions:[],head:null,released:null,checkout:null,candidateDecisions:{},generationKey:meta.generationKey||null};p.documents.push(d);return d;}
 import(programId,meta,bytes,actor){return this.transaction(programId,async p=>{const d=this.newDoc(p,meta),v=await this.addVersion(d,bytes,{actor,filename:meta.filename,major:meta.major||'A',source:{kind:'import'},comment:meta.comment||'Initial import'});d.head=v.id;this.audit(p,'document-imported',actor,{document:d.id,version:v.id});return this.public({documents:[d]}).documents[0];});}
 updateDocument(programId,docId,changes,actor){return this.transaction(programId,p=>{const d=this.doc(p,docId);for(const key of ['title','category','item','milestone','owner','reviewers','targetDate','delivery'])if(changes[key]!==undefined)d[key]=text(changes[key]);if(!d.title)fail('Document title is required.',400);if(changes.workflow!==undefined){if(d.workflow==='Released')fail('Check in a new draft before changing release workflow.');if(!['In preparation','In review','Ready for release'].includes(changes.workflow))fail('Invalid workflow state.',400);d.workflow=changes.workflow;}
  if(changes.dependencies!==undefined){if(!Array.isArray(changes.dependencies))fail('Dependencies must be a list.',400);const deps=[...new Set(changes.dependencies)];for(const dep of deps){if(dep===d.id)fail('A document cannot depend on itself.',400);this.doc(p,dep);}const reaches=(start,target,seen=new Set())=>{if(start===target)return true;if(seen.has(start))return false;seen.add(start);return this.doc(p,start).dependencies.some(x=>reaches(x,target,seen));};if(deps.some(x=>reaches(x,d.id)))fail('These dependencies would create a cycle.',400);d.dependencies=deps;}
  this.audit(p,'document-metadata-updated',actor,{document:d.id,changes});return this.public({documents:[d]}).documents[0];});}
 checkout(programId,docId,actor,expectedVersion){return this.transaction(programId,p=>{const d=this.doc(p,docId);if(d.checkout)fail(`Checked out by ${d.checkout.owner}.`);if(d.head!==expectedVersion)fail('A newer working version is available. Refresh before checking out.');const token=crypto.randomBytes(24).toString('hex');d.checkout={owner:actorName(actor),at:now(),baseVersionId:d.head,tokenHash:tokenHash(token)};this.audit(p,'checked-out',actor,{document:d.id,version:d.head});return {token,version:copy(this.version(d,d.head))};});}
 verifyCheckout(d,token){if(!d.checkout||d.checkout.tokenHash!==tokenHash(token))fail('This checkout belongs to another editor, or its token is missing.');if(d.checkout.baseVersionId!==d.head)fail('The document changed after checkout. Refresh and resolve the conflict.');}
 cancelCheckout(programId,docId,token,actor){return this.transaction(programId,p=>{const d=this.doc(p,docId);this.verifyCheckout(d,token);d.checkout=null;this.audit(p,'checkout-cancelled',actor,{document:d.id});return true;});}
 recoverCheckout(programId,docId,{actor,reason,confirm}){return this.transaction(programId,p=>{const d=this.doc(p,docId);if(confirm!==true)fail('Confirm checkout recovery.',400);if(!d.checkout)fail('No active checkout.');const previous=copy(d.checkout);delete previous.tokenHash;const note=required(reason,'Recovery reason');d.checkout=null;this.audit(p,'checkout-recovered',actor,{document:d.id,previous,reason:note});return true;});}
 checkinPlan(programId,docId,{token,change='minor',nextRevision}){const p=this.read(programId),d=this.doc(p,docId);this.verifyCheckout(d,token);if(!['minor','major'].includes(change))fail('Choose minor or major revision.',400);const base=this.version(d,d.head),major=change==='major'||base.status==='Released'?(text(nextRevision)||nextMajor(base.major)):base.major;if((change==='major'||base.status==='Released')&&(major===base.major||d.versions.some(v=>v.status==='Released'&&v.major===major)))fail('Choose a new, unreleased major revision.',400);const minor=Math.max(0,...d.versions.filter(v=>v.major===major&&v.status!=='Released').map(v=>v.minor))+1;return {major,minor,label:`${major}-draft.${minor}`,baseVersionId:base.id};}
 checkin(programId,docId,{token,actor,filename,comment,change='minor',nextRevision,expectedLabel,revisionUpdated=false},bytes){return this.transaction(programId,async p=>{const d=this.doc(p,docId);this.verifyCheckout(d,token);if(!['minor','major'].includes(change))fail('Choose minor or major revision.',400);const base=this.version(d,d.head),major=change==='major'||base.status==='Released'?(text(nextRevision)||nextMajor(base.major)):base.major;if((change==='major'||base.status==='Released')&&(major===base.major||d.versions.some(v=>v.status==='Released'&&v.major===major)))fail('Choose a new, unreleased major revision.',400);const minor=Math.max(0,...d.versions.filter(v=>v.major===major&&v.status!=='Released').map(v=>v.minor))+1,label=`${major}-draft.${minor}`;if(expectedLabel&&expectedLabel!==label)fail('The planned revision changed before check-in. Refresh and retry.');const v=await this.addVersion(d,bytes,{actor,filename,comment,major,source:{kind:'checkin'},baseVersionId:base.id});d.head=v.id;d.checkout=null;d.workflow='In preparation';this.audit(p,'checked-in',actor,{document:d.id,version:v.id,change,documentRevisionUpdated:revisionUpdated===true});return copy(v);});}
 release(programId,docId,{actor,comment,expectedVersion},bytes=null){return this.transaction(programId,async p=>{const d=this.doc(p,docId);if(d.checkout)fail('Check in or cancel the checkout before release.');if(d.head!==expectedVersion)fail('The working version changed. Refresh before release.');if(d.workflow!=='Ready for release')fail('Mark the reviewed document Ready for release first.');const base=this.version(d,d.head);if(d.versions.some(v=>v.status==='Released'&&v.major===base.major))fail('This release revision already exists. Start a new major draft.');const unresolved=d.dependencies.filter(x=>{const other=this.doc(p,x);return !other.released||other.head!==other.released;});if(unresolved.length)fail('Release dependencies before releasing this document.');const v=await this.addVersion(d,bytes||await this.bytes(base.hash),{actor,filename:base.filename,comment,major:base.major,status:'Released',source:{kind:'release',reviewedVersionId:base.id},baseVersionId:base.id});d.head=v.id;d.released=v.id;d.workflow='Released';this.audit(p,'document-released',actor,{document:d.id,version:v.id,documentRevisionUpdated:!!bytes});return copy(v);});}
 candidate(programId,docId,{actor,versionId,action,expectedVersion,comment}){return this.transaction(programId,async p=>{const d=this.doc(p,docId),v=this.version(d,versionId);if(v.status!=='Candidate'||d.candidateDecisions[v.id])fail('This version is no longer pending review.');if(!['accept','reject'].includes(action))fail('Invalid review decision.',400);if(d.checkout)fail('Resolve the active checkout before reviewing a pending version.');if(d.head!==expectedVersion)fail('The working version changed. Refresh before reviewing the pending version.');if(action==='accept'){const base=this.version(d,d.head);const wanted=base.status==='Released'?nextMajor(base.major):base.major;
  // The accepted version becomes the working draft under its own name when it is still the newest draft of that
  // revision; otherwise (a newer draft was checked in meanwhile) it is copied as the next draft.
  if(v.major===wanted&&v.minor===Math.max(0,...d.versions.filter(x=>x.major===wanted&&x.status!=='Released').map(x=>x.minor))){v.status='Draft';v.acceptedFrom='Pending review';d.head=v.id;d.workflow='In preparation';}
  else{const draft=await this.addVersion(d,await this.bytes(v.hash),{actor,filename:v.filename,comment,major:base.status==='Released'?nextMajor(base.major):base.major,source:{kind:'candidate-accepted',candidateId:v.id},baseVersionId:base.id,fingerprint:v.fingerprint});d.head=draft.id;d.workflow='In preparation';}}d.candidateDecisions[v.id]={action,actor:actorName(actor),at:now(),comment:required(comment,'Decision reason')};this.audit(p,'candidate-'+action,actor,{document:d.id,version:v.id});return this.public({documents:[d]}).documents[0];});}
 control(programId,{enabled,actor,confirm,reason}){return this.transaction(programId,p=>{if(typeof enabled!=='boolean'||confirm!==true)fail('Confirm the document-control change.',400);if(enabled&&!p.documents.length)fail('Import or generate the initial document inventory first.');if(p.documents.some(d=>d.checkout))fail('Resolve checkouts before changing document control.');p.underDocumentControl=enabled;p.everControlled=p.everControlled||enabled;const inventory=p.documents.filter(d=>d.head).map(d=>({documentId:d.id,versionId:d.head}));this.audit(p,'document-control-'+(enabled?'enabled':'disabled'),actor,{reason:required(reason,'Reason'),inventory});return this.public(p);});}
 baseline(programId,{name,milestone,entries,actor,comment}){return this.transaction(programId,async p=>{if(!p.underDocumentControl)fail('Enable document control before establishing a baseline.');name=required(name,'Baseline name');if(p.baselines.some(b=>b.name===name))fail('This baseline name already exists.');if(!Array.isArray(entries)||!entries.length)fail('Select at least one released document version.',400);const seen=new Set();for(const e of entries){if(seen.has(e.documentId))fail('Select only one version per document.',400);seen.add(e.documentId);const d=this.doc(p,e.documentId),v=this.version(d,e.versionId);if(v.status!=='Released')fail(`${d.pn} must use a released version.`);if(d.checkout)fail(`${d.pn} has an active checkout.`);await this.bytes(v.hash);}
  const b={id:id(),name,milestone:text(milestone),entries:copy(entries),createdAt:now(),actor:actorName(actor),comment:required(comment,'Baseline note')};p.baselines.push(b);this.audit(p,'baseline-created',actor,{baseline:b.id});return copy(b);});}
 adoptBuild(programId,{artifacts,phase,actor,inputHash,workbookBytes,engineHash,mode='normal',acknowledge=false,expectedRevision,previous=null}){return this.transaction(programId,async p=>{
  if(p.underDocumentControl&&p.revision!==expectedRevision)fail('The program changed while the build was running. Retry to review the latest versions.');
  if(!['normal','template-candidates'].includes(mode))fail('Invalid generation mode.',400);
  const build={id:id(),name:`${phase.toUpperCase()} Build ${String(p.builds.length+1).padStart(3,'0')}`,phase,createdAt:now(),actor:actorName(actor),inputHash,workbook:await this.blob(workbookBytes),engineHash,mode,underDocumentControl:p.underDocumentControl,entries:[],warnings:[],refresh:[]};
  for(const a of artifacts){
   // Each new version is stamped synchronously (docx_revision); yield between documents so the web server keeps
   // answering (health checks, other users) on a small hosted instance during a large build.
   await new Promise(resolve=>setImmediate(resolve));
   let d=p.documents.find(d=>d.generationKey===a.key);
   if(!d){const imported=p.documents.find(d=>d.pn.toLowerCase()===a.pn.toLowerCase());if(imported)fail(`${a.pn} already exists as an imported document. Link it to this generated document in the register before building.`);d=this.newDoc(p,{pn:a.pn,title:a.title,category:'Certification support',item:a.item,milestone:a.milestone,generationKey:a.key,delivery:'To be assigned'});}
   if(d.pn!==a.pn)fail('Generated PN differs from the registered PN for '+d.pn+'. Reconcile numbering before building.');
   const base=d.head?this.version(d,d.head):null;
   const fingerprint=digest(Buffer.from(JSON.stringify([inputHash,engineHash,a.templateHash,a.pn])));
   let v,reused=false;
   // Refresh customer content with the new configuration values (documents with ISAF value tags): an edited
   // document supplied with this build, or the program's own edited working version when its inputs changed.
   const refreshed=mode==='normal'?await this.refreshSource(d,base,a,{previous,fingerprint,build,controlled:p.underDocumentControl,useRegister:!(p.underDocumentControl&&acknowledge)}):null;
   if(refreshed){
    if(d.checkout&&p.underDocumentControl)fail(`${d.pn} is checked out. Complete the check-in before refreshing the controlled document.`);
    const asCandidate=!!base&&(p.underDocumentControl||p.everControlled||!!d.checkout);
    const prior=d.versions.findLast(x=>x.source.kind==='refreshed'&&x.fingerprint===fingerprint&&x.source.baseHash===refreshed.baseHash&&(!asCandidate||(x.status==='Candidate'&&!d.candidateDecisions[x.id])));
    if(prior){v=prior;reused=true;}else{
     const r=refreshed.report,summary={updated:r.updated,kept:r.kept.length+r.filled.length,flagged:r.conflicts.length,notPlaced:r.notInDocument.length,replaced:!!r.replaced,headersFooters:r.headersFooters||0};
     v=await this.addVersion(d,refreshed.bytes,{actor,filename:a.filename,comment:summary.replaced?'Replaced with the newly generated document: the previous copy had not been edited':`Refreshed with the current configuration: ${summary.updated} values updated, ${summary.kept} customer changes kept, ${summary.flagged} flagged for review; header and footer from the current template`,source:{kind:'refreshed',buildId:build.id,baseHash:refreshed.baseHash,origin:refreshed.origin,summary,flagged:r.conflicts.slice(0,50).map(c=>({key:c.key,text:c.text,generated:c.generated})),notPlaced:r.notInDocument.slice(0,20).map(x=>x.key)},major:base?.status==='Released'?nextMajor(base.major):base?.major||a.major||'A',status:asCandidate?'Candidate':'Draft',fingerprint});
     if(!asCandidate){d.head=v.id;d.workflow='In preparation';}
     if(asCandidate)build.warnings.push(`${d.pn}: refreshed version saved for review (${v.label}); accept or reject it in Program Documents.`);
    }
    build.refresh.push({pn:d.pn,documentId:d.id,versionId:v.id,label:v.label,candidate:v.status==='Candidate',reused,origin:v.source.origin,summary:v.source.summary,flagged:v.source.flagged,notPlaced:v.source.notPlaced});
   }else if(mode==='normal'&&base&&base.source.kind!=='generated'&&base.fingerprint===fingerprint&&!d.checkout&&await this.taggedVersion(base)){
    // An edited document with ISAF value tags that already reflects these inputs (refreshed before, or
    // checked in after a refresh): keep using it.
    v=base;reused=true;
   }else if(base&&p.underDocumentControl&&mode==='normal'){
    if(d.checkout)fail(`${d.pn} is checked out. Complete the check-in before issuing the controlled document.`);
    if(base.fingerprint!==fingerprint&&!acknowledge)fail(`Configuration or template inputs differ for ${d.pn}. Existing Word content cannot be refreshed automatically. Review and acknowledge an unchanged issue, or request separate template candidates.`);
    v=base;reused=true;if(base.fingerprint!==fingerprint)build.warnings.push(`${d.pn}: issued checked-in content unchanged; configuration/template changes were not applied.`);
   }else{
    const needsCandidate=!!base&&(mode==='template-candidates'||p.everControlled||d.checkout||base.source.kind!=='generated');
    const prior=d.versions.findLast(v=>v.fingerprint===fingerprint&&(!needsCandidate||v.status==='Candidate')&&['generated','template-candidate'].includes(v.source.kind)&&!d.candidateDecisions[v.id]);
    if(prior){v=prior;reused=true;}else{
     const isCandidate=!!base&&(mode==='template-candidates'||p.everControlled||d.checkout||base.source.kind!=='generated');
     v=await this.addVersion(d,a.bytes,{actor,filename:a.filename,comment:isCandidate?'Generated from the template for review; compare with the working version, which may hold customer content':'Generated from ISAF master and workbook',source:{kind:isCandidate?'template-candidate':'generated',buildId:build.id},major:base?.status==='Released'?nextMajor(base.major):base?.major||a.major||'A',status:isCandidate?'Candidate':'Draft',fingerprint});
     if(!isCandidate){d.head=v.id;d.workflow='In preparation';}
    }
   }
   build.entries.push({documentId:d.id,versionId:v.id,relPath:a.relPath,reused,source:v.source.kind});
  }
  p.builds.push(build);this.audit(p,'build-snapshot-created',actor,{buildId:build.id,documents:build.entries.length});return copy(build);
 });}
 async taggedVersion(v){if(path.extname(v.filename).toLowerCase()!=='.docx')return false;try{return inspectDocx(await this.bytes(v.hash)).tagged;}catch{return false;}}
 async refreshSource(d,base,a,{previous,fingerprint,build,controlled,useRegister}){
  const supplied=previous?.get?.(a.key)||null;let from=null;
  if(supplied)from={bytes:supplied.bytes,origin:{from:'upload',name:supplied.name,how:supplied.how}};
  else if(useRegister&&base&&(controlled||base.source.kind!=='generated')&&base.fingerprint!==fingerprint&&await this.taggedVersion(base)){
   from={bytes:await this.bytes(base.hash),origin:{from:'register',versionId:base.id,label:base.label,how:'working version'}};
  }
  if(!from)return null;
  try{const {bytes,report}=refreshDocx(from.bytes,a.bytes);return {bytes,report,origin:from.origin,baseHash:digest(from.bytes)};}
  catch(error){build.warnings.push(`${a.pn}: ${from.origin.name||'the working version'} was not refreshed: ${error.message}`);return null;}
 }
 link(programId,docId,{generationKey,actor}){return this.transaction(programId,p=>{const d=this.doc(p,docId);if(d.generationKey)fail('Document already linked to the generator.');if(!/^[A-Za-z0-9_.-]+::[A-Za-z0-9_.-]*$/.test(generationKey))fail('Use the document code and item ID shown in the generator, separated by ::.',400);if(p.documents.some(x=>x.generationKey===generationKey))fail('This generation key is already linked.');d.generationKey=generationKey;this.audit(p,'generator-linked',actor,{document:d.id,generationKey});return this.public({documents:[d]}).documents[0];});}
 saveConfiguration(programId,{data,filename,actor},bytes){return this.transaction(programId,async p=>{const identity=data?.program;if(!identity||identity.name!==p.name||identity.customer_name!==p.company||identity.doc_prefix!==p.prefix)fail('This workbook belongs to a different program.',422);const blob=await this.blob(bytes);if(p.configuration?.hash===blob.hash)return copy(p.configuration);p.configuration={...blob,filename:safeName(filename||'Program_Config.xlsx'),data:copy(data),savedAt:now(),actor:actorName(actor)};this.audit(p,'program-configuration-saved',actor,{hash:blob.hash,filename:p.configuration.filename});return copy(p.configuration);});}
 roadmap(programId){const p=this.read(programId);return p.documents.map(d=>{const pending=d.versions.filter(v=>v.status==='Candidate'&&!d.candidateDecisions[v.id]).length;const blockedBy=d.dependencies.filter(x=>{const dep=this.doc(p,x);return !dep.released||dep.head!==dep.released;}).map(x=>this.doc(p,x).pn);return {documentId:d.id,pn:d.pn,title:d.title,owner:d.owner,milestone:d.milestone,targetDate:d.targetDate,status:d.workflow,blockedBy,pendingCandidates:pending,checkedOutBy:d.checkout?.owner||null,overdue:!!d.targetDate&&d.targetDate<now().slice(0,10)&&d.workflow!=='Released'};});}
}
