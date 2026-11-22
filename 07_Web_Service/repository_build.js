import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readBuildResult} from './build_result.js';
import {digest,RepositoryError,safeName} from './repository_store.js';
import {matchPrevious,refreshReportText} from './value_refresh.js';
import {applyImport as applyRequirements,importReportText} from './requirements_docs.js';
const exec=promisify(execFile);
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).filter(k=>k!=='_fieldComments').sort().map(k=>[k,stable(value[k])])):value;

// A build lock older than this belongs to a build that can no longer be running (the engine
// run is limited to 2 minutes); it is left behind when the server stops mid-build.
// Small hosted instances (for example Render Free, 0.1 CPU) need several minutes for a full program build.
const BUILD_TIMEOUT_MS=Math.max(60000,Number(process.env.ISAF_BUILD_TIMEOUT_MS)||20*60*1000);
// Memory limit for the build engine's JavaScript heap. Small hosted instances (Render Free: 512 MB for the
// whole service) restart when the build pushes the service over the limit; a 192 MB heap keeps an SOI 1
// build near 200 MB instead of about 270 MB with no slowdown. ISAF_ENGINE_MAX_HEAP_MB overrides; 0 = no limit.
const HOSTED=Boolean(process.env.RENDER)||process.env.ISAF_HOSTED==='1';
const ENGINE_HEAP_MB=process.env.ISAF_ENGINE_MAX_HEAP_MB!==undefined?Number(process.env.ISAF_ENGINE_MAX_HEAP_MB)||0:(HOSTED?192:0);
const ENGINE_NODE_OPTIONS=ENGINE_HEAP_MB>0?[`--max-old-space-size=${ENGINE_HEAP_MB}`]:[];
// A lock older than the longest possible build is left over from an interrupted build.
const STALE_LOCK_MS=Math.max(10*60*1000,BUILD_TIMEOUT_MS+5*60*1000);
export function acquireBuildLock(lock,now=Date.now()){
 for(let attempt=0;attempt<2;attempt++){
  try{fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,startedAt:new Date(now).toISOString()}));return;}
  catch(e){
   if(e.code!=='EEXIST')throw e;
   let started=NaN;try{started=Date.parse(JSON.parse(fs.readFileSync(path.join(lock,'owner.json'),'utf8')).startedAt);}catch{}
   if(!Number.isFinite(started)){try{started=fs.statSync(lock).mtimeMs;}catch{started=now;}}
   const age=now-started;
   if(age>STALE_LOCK_MS&&attempt===0){fs.rmSync(lock,{recursive:true,force:true});continue;}
   const minutes=Math.max(1,Math.round(age/60000));
   throw new RepositoryError(`A build for this program started about ${minutes} minute${minutes===1?'':'s'} ago and is still running. Wait for it to finish, then build again. If no build is running, try again after ${Math.max(1,Math.ceil((STALE_LOCK_MS-age)/60000))} minute(s); an interrupted build is cleared automatically after 10 minutes.`,409);
  }
 }
}
// Document dates are the issuing company's dates, not the server's. A hosted
// service runs in UTC, so a build started on the evening of the 13th in New
// York dated every document the 14th. The engine reads the date from the
// process clock, so the timezone is handed to the child process rather than
// threaded through every renderer. The browser supplies its own IANA zone;
// ISAF_TIMEZONE pins a service that should always use one zone.
export function buildTimeZone(requested){
 for(const candidate of [String(requested||'').trim(),String(process.env.ISAF_TIMEZONE||'').trim()]){
  if(!candidate)continue;
  try{new Intl.DateTimeFormat('en-CA',{timeZone:candidate});return candidate;}catch{/* not a zone this runtime knows */}
 }
 return '';
}

// The environment the engine child process is started with. Exported so the
// wiring itself is testable: the engine reads both of these at startup, and a
// build that silently loses TZ dates every document in the server's zone.
export function engineEnv({timeZone,valueTags,base=process.env}={}){
 const zone=buildTimeZone(timeZone);
 return {...base,...(valueTags===false?{ISAF_VALUE_TAGS:'0'}:{}),...(zone?{TZ:zone}:{})};
}

// Imported requirements are written into the generated documents as part of the build, before any
// bytes reach the repository, so a build is the only step: there is no apply-to-folder round trip.
// Each generated document carries its own identity (ISAF_DOC_IDENTITY), so applyRequirements picks
// its own target; nothing here selects documents or folders.
export function writeRequirementsIntoBuild(artifacts,review){
 // documents: changed. blocks: requirement, trace and gap tables placed. rows: checklist rows
 // answered (report.rows is a checklist count in requirements_docs.js, not a requirement count).
 const summary={imported:review?.requirements?.length||0,documents:0,blocks:0,rows:0,skipped:0,results:[]};
 if(!review?.requirements?.length)return null;
 for(const a of artifacts){
  const out=applyRequirements(a.bytes,review);
  // importReportText expects one entry per document: {name, changed, report}.
  summary.results.push({name:a.filename||a.title,changed:out.changed,report:out.report});
  if(out.changed){a.bytes=out.bytes;summary.documents++;summary.blocks+=out.report.blocks?.length||0;summary.rows+=out.report.rows||0;}
  else summary.skipped++;
 }
 return summary;
}
export const requirementsFingerprint=review=>review?.requirements?.length
 ?digest(Buffer.from(JSON.stringify(stable({requirements:review.requirements,findings:review.findings||[]}))))
 :'';

export async function runRepositoryBuild({store,workbookPath,logoPath,phaseId,outputBase,programId,actor,mode,acknowledge,buildScript,parseScript,settingsPath,phaseMap,includeSourceWorkbook=true,signal,allowedProgramTypes=[],previous=[],valueTags,timeZone,requirements=null}){
 if(signal?.aborted)throw new RepositoryError('The build was stopped.',499);
 if(!Object.hasOwn(phaseMap,phaseId))throw new RepositoryError('Unknown program phase.',400);
 actor=String(actor||'').trim();if(!actor)throw new RepositoryError('Enter your name for the repository activity record.',400);
 const parsed=await exec(process.execPath,[parseScript,workbookPath],{maxBuffer:10*1024*1024});const data=JSON.parse(parsed.stdout);
 const programType=String(data.program?.type||'').toUpperCase();
 if(allowedProgramTypes.length&&!allowedProgramTypes.includes(programType))throw new RepositoryError(`${programType||'This'} programs are not included in your license. Licensed program types: ${allowedProgramTypes.join(', ')}.`,403);
 const p=await store.ensure({name:data.program.name,company:data.program.customer_name,prefix:data.program.doc_prefix},actor,programId);
 const lock=path.join(store.programPath(p.id),'.build-lock');acquireBuildLock(lock);
 const started=Date.now(),runId=crypto.randomUUID(),work=path.join(store.root,'work',p.id,runId);fs.mkdirSync(work,{recursive:true});
 try{
  // Each invocation has a fresh generation folder. No prior output is cleared or overwritten.
  const generated=path.join(work,'generated');const args=[...ENGINE_NODE_OPTIONS,buildScript,'--workbook',workbookPath,'--output',generated];if(logoPath)args.push('--logo',logoPath);if(phaseMap[phaseId])args.push('--milestone',phaseMap[phaseId]);if(fs.existsSync(settingsPath))args.push('--pn-settings',settingsPath);
  // Persist the numbering registry per program, while keeping each rendering run isolated.
  const numberStore=path.join(store.programPath(p.id),'numbering');fs.mkdirSync(numberStore,{recursive:true});args.push('--number-register-dir',numberStore);
  const timeoutMs=BUILD_TIMEOUT_MS;
  let stdout;
  // Run the engine at the lowest CPU priority so the web server keeps answering (health checks, other users)
  // while a build runs. On a small hosted instance an unanswered health check makes the host restart the service.
  try{// Admin Build tab can switch value tags off for one build (value_tags.js; otherwise the server's ISAF_VALUE_TAGS applies).
  const job=exec(process.execPath,args,{timeout:timeoutMs,maxBuffer:20*1024*1024,...(signal?{signal}:{}),env:engineEnv({timeZone,valueTags})});try{os.setPriority(job.child.pid,19);}catch{}({stdout}=await job);}
  catch(error){if(error.name==='AbortError'||signal?.aborted)throw new RepositoryError('The build was stopped.',499);if(/heap out of memory|Allocation failed/i.test(String(error.stderr||'')))throw new RepositoryError(`The build ran out of memory${ENGINE_HEAP_MB?` (engine limit ${ENGINE_HEAP_MB} MB)`:''}. Build fewer phases at a time, use a larger server instance, or raise ISAF_ENGINE_MAX_HEAP_MB.`,507);if(error.killed||error.signal==='SIGTERM')throw new RepositoryError(`The build was stopped after ${Math.round(timeoutMs/60000)} minutes. Build fewer phases at a time, or use a larger server instance (ISAF_BUILD_TIMEOUT_MS sets the limit).`,504);throw error;}
  const result=readBuildResult(stdout);
  if(result.failCount)throw new RepositoryError(`The engine reported ${result.failCount} failed documents. No repository snapshot was committed.`,422);
  if(!Array.isArray(result.artifacts))throw new RepositoryError('Refresh the v4 engine bundle before repository builds.',500);
  const manifest=JSON.parse(fs.readFileSync(path.join(generated,'build_manifest.json'),'utf8')),numbering=JSON.parse(fs.readFileSync(path.join(generated,'Document_Number_Register.json'),'utf8'));
  const artifacts=result.artifacts.filter(a=>a.ok).map(a=>{const key=`${a.id}::${a.item||''}`,number=numbering.documents.find(n=>n.document===a.id&&n.item===(a.item||''));if(!number)throw new RepositoryError('Missing document number in generation result.',500);const full=path.resolve(generated,a.relPath);if(!full.startsWith(path.resolve(generated)+path.sep))throw new RepositoryError('Invalid generated document path.',500);const entry=manifest[a.item?`${a.id}::${a.item}`:a.id];return {key,pn:number.pn,title:a.id,item:a.item||'',milestone:a.milestone,major:number.revision,filename:number.filename,relPath:a.relPath,templateHash:entry?.templateHash||'',bytes:fs.readFileSync(full)};});
  // Imported requirements become part of the generated bytes here, so the repository version, the
  // export folder and the download all carry them. The fingerprint below makes a change of
  // requirements a reason to issue new versions rather than reuse the previous ones.
  const requirementsSummary=writeRequirementsIntoBuild(artifacts,requirements);
  const reqFingerprint=requirementsFingerprint(requirements);
  // Include numbering settings as well as engineering values in the regeneration fingerprint.
  const legacySettings=fs.existsSync(settingsPath)?JSON.parse(fs.readFileSync(settingsPath,'utf8')).documentPNs||{}:{};
  const settings=data.document_pns||legacySettings;
  const logoHash=logoPath&&fs.existsSync(logoPath)?digest(fs.readFileSync(logoPath)):'';
  // Edited documents supplied with the build (same program, or a previous program's documents for a new one).
  const reuse=previous?.length?matchPrevious(previous,artifacts.map(a=>({key:a.key,id:a.title,item:a.item,pn:a.pn}))):{matches:new Map(),unmatched:[]};
  const snapshot=await store.adoptBuild(p.id,{previous:reuse.matches,artifacts,phase:phaseId,actor,inputHash:digest(Buffer.from(JSON.stringify([stable(data),stable(settings),logoHash,...(valueTags===false?['no-value-tags']:[]),...(reqFingerprint?[`requirements:${reqFingerprint}`]:[])]))),workbookBytes:fs.readFileSync(workbookPath),engineHash:digest(fs.readFileSync(buildScript)),mode:mode||'normal',acknowledge:acknowledge===true||acknowledge==='true',expectedRevision:p.revision});
  let outDir;
  try {
  const program=await store.read(p.id);const parent=path.join(path.resolve(outputBase),safeName((program.prefix+'_'+program.name).replace(/[\\/]/g,'_')));fs.mkdirSync(parent,{recursive:true});outDir=path.join(parent,`Build-${snapshot.createdAt.replace(/[:.]/g,'-')}-${snapshot.id.slice(0,8)}`);fs.mkdirSync(outDir);
  // Exports are disposable copies. Repository bytes and snapshot membership are authoritative.
  for(const e of snapshot.entries){const d=store.doc(program,e.documentId),v=store.version(d,e.versionId);const rel=path.join(safeName(d.milestone||'Other'),safeName(`${d.pn}_${d.title.slice(0,45)}_Rev ${v.label}${path.extname(v.filename)}`));const dest=path.join(outDir,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,await store.bytes(v.hash),{flag:'wx'});}
  } catch(error) { throw new RepositoryError(`Snapshot ${snapshot.name} was saved, but its folder export failed: ${error.message}. Download the saved snapshot from Program Documents.`,500); }
  // The export (folder, ZIP, working folder) holds documents only (owner, 22 November 2026). The build record,
  // source workbook and reports are kept with the program as a support record that Admins see in Program
  // Documents, together with a copy of every edited document supplied with this build (working folder or Reuse
  // edited documents) that the register does not already hold: those are the files this build replaces in the
  // user's folder, kept here instead of in an _ISAF_backup folder.
  const knownHashes=new Set((await store.read(p.id)).documents.flatMap(d=>d.versions.map(v=>v.hash)));
  const recordFiles=[{name:'Snapshot_Record.json',bytes:Buffer.from(JSON.stringify(snapshot,null,2))}];
  if(includeSourceWorkbook)recordFiles.push({name:'Source_Workbook.xlsx',bytes:await store.bytes(snapshot.workbook.hash)});
  recordFiles.push({name:'Generation_Report.txt',bytes:fs.readFileSync(path.join(generated,'build_report.txt'))});
  if(requirementsSummary)recordFiles.push({name:'Requirements_Report.txt',bytes:Buffer.from(importReportText(requirementsSummary.results,requirements))});
  if(snapshot.refresh?.length||reuse.unmatched.length)recordFiles.push({name:'Refresh_Report.txt',bytes:Buffer.from(refreshReportText(snapshot.refresh.map(r=>({pn:r.pn,name:r.origin?.name||`working version ${r.origin?.label||''}`.trim(),how:r.origin?.how||'',summary:r.summary,flagged:r.flagged,notPlaced:r.notPlaced,label:r.label,candidate:r.candidate,reused:r.reused})),reuse.unmatched))});
  for(const f of previous||[])if(f?.bytes&&!knownHashes.has(digest(f.bytes)))recordFiles.push({name:`Replaced documents/${f.name}`,bytes:f.bytes,role:'replaced'});
  let recordWarning='';
  try{await store.addRecord(p.id,{kind:'build',title:snapshot.name,actor,buildId:snapshot.id,files:recordFiles});}
  catch(error){recordWarning=`The support record of ${snapshot.name} could not be kept: ${error.message}`;}
  fs.rmSync(work,{recursive:true,force:true});
  const reusedCount=snapshot.entries.filter(e=>e.reused).length;const generatedCount=snapshot.entries.length-reusedCount;
  const refreshed=snapshot.refresh||[];
  return {program:{name:data.program?.name||'',short_name:data.program?.short_name||'',doc_prefix:data.program?.doc_prefix||'',type:data.program?.type||''},refresh:{documents:refreshed.length,flagged:refreshed.reduce((n,r)=>n+(r.summary?.flagged||0),0),candidates:refreshed.filter(r=>r.candidate).length,supplied:previous?.length||0,unused:reuse.unmatched},programId:p.id,buildId:snapshot.id,buildName:snapshot.name,outputDir:outDir,docCount:snapshot.entries.length,generatedCount,reusedCount,failCount:0,elapsed:((Date.now()-started)/1000).toFixed(1),phase:phaseId,warnings:recordWarning?[...(snapshot.warnings||[]),recordWarning]:snapshot.warnings,recordKept:!recordWarning,requirements:requirementsSummary&&{documents:requirementsSummary.documents,blocks:requirementsSummary.blocks,rows:requirementsSummary.rows,skipped:requirementsSummary.skipped,imported:requirementsSummary.imported,sources:requirements?.meta?.sources||[]},log:`Repository snapshot: ${snapshot.name}\n${generatedCount} new versions; ${reusedCount} reused versions.\n${requirementsSummary?`${requirementsSummary.imported} imported requirements written into ${requirementsSummary.documents} documents (Requirements_Report.txt).\n`:''}${refreshed.length?`${refreshed.length} edited documents refreshed with the configuration (Refresh_Report.txt).\n`:''}${snapshot.warnings.join('\n')}`};
 }finally{fs.rmSync(lock,{recursive:true,force:true});}
}
