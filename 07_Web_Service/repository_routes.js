import path from 'node:path';
import express from 'express';
import multer from 'multer';
import archiver from 'archiver';
import {RepositoryError,safeName} from './repository_store.js';
import {assessPackage,savePackageRow,addPackageRequirement,confirmPackageScope,createPackageSnapshot,packageReport} from './certification_package.js';
import {updateDocxRevision} from './docx_revision.js';
import {requestActor} from './auth/permissions.js';

export function repositoryRoutes(store,requireAuth,configurationIO={}){
 const router=express.Router();router.use(requireAuth);
 const authorize=configurationIO.authorize||(()=>((_req,_res,next)=>next()));
 const includeSourceWorkbook=configurationIO.includeSourceWorkbook!==false;
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:50*1024*1024,files:1,fields:20}}).single('file');
 const run=fn=>(req,res,next)=>{Promise.resolve().then(()=>fn(req,res)).catch(next);};
 const program=req=>req.params.programId;

 const body=req=>req.auth?.mode==='oidc'?{...req.body,actor:requestActor(req)}:req.body;
 router.get('/programs',authorize('repository.read'),run(async(req,res)=>res.json(await store.list())));
 router.post('/programs',authorize('program.create'),run(async(req,res)=>res.status(201).json(await store.create(req.body,requestActor(req,req.body.actor)))));
 router.get('/programs/:programId',authorize('repository.read'),run(async(req,res)=>res.json(store.public(await store.read(program(req))))));

 router.post('/programs/:programId/configuration',authorize('configuration.write'),upload,run(async(req,res)=>{
  const source=req.file?{bytes:req.file.buffer,filename:req.file.originalname}:await configurationIO.demo(req.body.demoPath);
  const data=await configurationIO.parse(source.bytes);
  const saved=await store.saveConfiguration(program(req),{data,filename:source.filename,actor:requestActor(req,req.body.actor)},source.bytes);
  res.json({filename:saved.filename,hash:saved.hash});
 }));
 async function configuration(req){
  const p=await store.read(program(req));if(p.configuration)return p.configuration;
  const prior=p.builds.at(-1);if(!prior?.workbook)throw new RepositoryError('No workbook is saved for this program yet. Load its config once to connect it.',404);
  const bytes=await store.bytes(prior.workbook.hash);
  return {...prior.workbook,filename:'Program_Config.xlsx',data:await configurationIO.parse(bytes)};
 }
 router.get('/programs/:programId/configuration',authorize('repository.read'),run(async(req,res)=>{const c=await configuration(req);res.json({filename:c.filename,hash:c.hash,data:c.data});}));
 router.get('/programs/:programId/configuration/file',authorize('repository.read'),run(async(req,res)=>{
  const c=await configuration(req);if(req.query.hash&&req.query.hash!==c.hash)throw new RepositoryError('The saved configuration changed. Select the program again.',409);
  res.attachment(c.filename);res.set('Cache-Control','no-store');res.send(await store.bytes(c.hash));
 }));

 // Preparation checklist uses the stored workbook and exact repository evidence versions.
 router.get('/programs/:programId/certification',authorize('repository.read'),run(async(req,res)=>res.json(assessPackage(await store.read(program(req))))));
 router.put('/programs/:programId/certification/records/:rowId',authorize('certification.edit'),run(async(req,res)=>res.json(await savePackageRow(store,program(req),req.params.rowId,body(req)))));
 router.post('/programs/:programId/certification/requirements',authorize('certification.edit'),run(async(req,res)=>res.status(201).json(await addPackageRequirement(store,program(req),body(req)))));
 router.post('/programs/:programId/certification/scope',authorize('certification.edit'),run(async(req,res)=>res.json(await confirmPackageScope(store,program(req),body(req)))));
 router.get('/programs/:programId/certification/report',authorize('repository.read'),run(async(req,res)=>{
  res.attachment('Certification_Preparation_Review.html');res.set('Cache-Control','no-store');res.type('html').send(packageReport(assessPackage(await store.read(program(req)))));
 }));
 router.post('/programs/:programId/certification/snapshots',authorize('certification.snapshot'),run(async(req,res)=>res.status(201).json(await createPackageSnapshot(store,program(req),body(req)))));
 router.get('/programs/:programId/certification/snapshots/:snapshotId/file',authorize('repository.read'),run(async(req,res)=>{
  const p=await store.read(program(req)),snap=p.packageSnapshots?.find(s=>s.id===req.params.snapshotId);if(!snap)throw new RepositoryError('Review package not found.',404);
  const files=await Promise.all(snap.entries.map(async e=>({name:e.path,bytes:await store.bytes(e.hash)})));
  const workbook=includeSourceWorkbook?await store.bytes(snap.workbook.hash):null;
  const archive=archiver('zip',{zlib:{level:6}});archive.on('error',e=>res.destroy(e));res.attachment(safeName(snap.name)+'.zip');res.set('Cache-Control','no-store');archive.pipe(res);
  for(const f of files)archive.append(f.bytes,{name:f.name});if(workbook)archive.append(workbook,{name:'Source_Workbook.xlsx'});archive.append(packageReport(snap.report),{name:'Certification_Preparation_Review.html'});archive.append(JSON.stringify(snap,null,2),{name:'Review_Package_Record.json'});archive.finalize();
 }));

 router.get('/programs/:programId/roadmap',authorize('repository.read'),run(async(req,res)=>res.json(await store.roadmap(program(req)))));
 router.post('/programs/:programId/control',authorize('program.control'),run(async(req,res)=>res.json(await store.control(program(req),body(req)))));
 router.post('/programs/:programId/documents',authorize('document.import'),upload,run(async(req,res)=>{
  if(!req.file)throw new RepositoryError('Choose a document to import.',400);
  res.status(201).json(await store.import(program(req),{...req.body,filename:req.file.originalname},req.file.buffer,requestActor(req,req.body.actor)));
 }));
 router.patch('/programs/:programId/documents/:docId',authorize('document.edit'),run(async(req,res)=>res.json(await store.updateDocument(program(req),req.params.docId,req.body,requestActor(req,req.body.actor)))));
 router.post('/programs/:programId/documents/:docId/link',authorize('document.edit'),run(async(req,res)=>res.json(await store.link(program(req),req.params.docId,body(req)))));
 router.post('/programs/:programId/documents/:docId/checkout',authorize('document.checkout'),run(async(req,res)=>res.json(await store.checkout(program(req),req.params.docId,requestActor(req,req.body.actor),req.body.expectedVersion))));
 router.post('/programs/:programId/documents/:docId/cancel-checkout',authorize('document.checkout'),run(async(req,res)=>res.json({ok:await store.cancelCheckout(program(req),req.params.docId,req.body.token,requestActor(req,req.body.actor))})));
 router.post('/programs/:programId/documents/:docId/recover-checkout',authorize('program.control'),run(async(req,res)=>res.json({ok:await store.recoverCheckout(program(req),req.params.docId,body(req))})));
 router.post('/programs/:programId/documents/:docId/checkin',authorize('document.checkin'),upload,run(async(req,res)=>{
  if(!req.file)throw new RepositoryError('Choose the edited document.',400);
  const meta={...body(req),filename:req.file.originalname};const plan=await store.checkinPlan(program(req),req.params.docId,meta);
  let bytes=req.file.buffer,revisionUpdate={requested:false,updated:false,label:plan.label};
  if(path.extname(req.file.originalname).toLowerCase()==='.docx'&&req.body.updateWordRevision!=='false'){
   const d=store.doc(await store.read(program(req)),req.params.docId);
   revisionUpdate={requested:true,...await updateDocxRevision(bytes,plan.label,{filename:safeName(`${d.pn}_${d.title.slice(0,45)}_Rev ${plan.label}.docx`)})};
   bytes=revisionUpdate.bytes;delete revisionUpdate.bytes;
  }
  const saved=await store.checkin(program(req),req.params.docId,{...meta,expectedLabel:plan.label,revisionUpdated:revisionUpdate.updated},bytes);
  res.json({...saved,revisionUpdate});
 }));
 router.post('/programs/:programId/documents/:docId/release',authorize('document.release'),run(async(req,res)=>{
  const p=await store.read(program(req)),d=store.doc(p,req.params.docId),v=store.version(d,d.head);
  let bytes=null,revisionUpdate={requested:false,updated:false,label:v.major};
  if(path.extname(v.filename).toLowerCase()==='.docx'){
   revisionUpdate={requested:true,...await updateDocxRevision(await store.bytes(v.hash),v.major,{filename:safeName(`${d.pn}_${d.title.slice(0,45)}_Rev ${v.major}.docx`)})};
   if(revisionUpdate.updated)bytes=revisionUpdate.bytes;delete revisionUpdate.bytes;
  }
  const saved=await store.release(program(req),req.params.docId,body(req),bytes);res.json({...saved,revisionUpdate});
 }));
 router.post('/programs/:programId/documents/:docId/candidate',authorize('document.review'),run(async(req,res)=>res.json(await store.candidate(program(req),req.params.docId,body(req)))));
 router.get('/programs/:programId/documents/:docId/versions/:versionId/file',authorize('repository.read'),run(async(req,res)=>{
  const p=await store.read(program(req)),d=store.doc(p,req.params.docId),v=store.version(d,req.params.versionId);
  res.attachment(safeName(`${d.pn}_${d.title.slice(0,45)}_Rev ${v.label}${path.extname(v.filename)}`));res.set('Cache-Control','no-store');res.send(await store.bytes(v.hash));
 }));
 router.post('/programs/:programId/baselines',authorize('baseline.create'),run(async(req,res)=>res.status(201).json(await store.baseline(program(req),body(req)))));
 router.get('/programs/:programId/:kind/:recordId/download',authorize('repository.read'),run(async(req,res)=>{
  if(!['builds','baselines'].includes(req.params.kind))throw new RepositoryError('Record not found.',404);
  const p=await store.read(program(req)),record=p[req.params.kind].find(x=>x.id===req.params.recordId);if(!record)throw new RepositoryError('Record not found.',404);
  const files=await Promise.all(record.entries.map(async e=>{const d=store.doc(p,e.documentId),v=store.version(d,e.versionId);return {name:safeName(`${d.pn}_${d.title.slice(0,45)}_Rev ${v.label}${path.extname(v.filename)}`),bytes:await store.bytes(v.hash)};}));
  const archive=archiver('zip',{zlib:{level:6}});archive.on('error',e=>res.destroy(e));res.attachment(safeName(record.name)+'.zip');res.set('Cache-Control','no-store');archive.pipe(res);
  for(const f of files)archive.append(f.bytes,{name:f.name});archive.append(JSON.stringify(record,null,2),{name:'Snapshot_Record.json'});if(includeSourceWorkbook&&record.workbook)archive.append(await store.bytes(record.workbook.hash),{name:'Source_Workbook.xlsx'});archive.finalize();
 }));
 router.use((err,req,res,next)=>{if(res.headersSent)return next(err);res.status(err.status|| (err.code==='LIMIT_FILE_SIZE'?413:500)).json({error:err.message||'Repository operation failed.'});});
 return router;
}
