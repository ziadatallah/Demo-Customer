import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export function intakeRoutes({requireAuth,authorize=()=>((_req,_res,next)=>next()),serviceDir,parseScript,licensedValues=()=>null,licensedProgramTypes=()=>[],newDefaults=()=>null,warmNew=false}) {
 const router=express.Router(),upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,fieldSize:2*1024*1024}}).single('workbook');
 router.use(requireAuth);
 router.post('/demo-file',authorize('intake.write'),express.json(),async(req,res)=>{
  try{
   if(typeof req.body?.path!=='string')throw Error();
   const base=await fs.realpath(path.join(serviceDir,'../04_Demos'));
   const file=await fs.realpath(path.resolve(serviceDir,'..',req.body.path));
   if(!file.startsWith(base+path.sep)||!/^04_Demos\/[^/]+\/inputs\/[^/]+\.xlsx$/.test(req.body.path))throw Error();
   res.type(mime).send(await fs.readFile(file));
  }catch{res.status(400).json({error:'Choose a supplied sample workbook.'});}
 });
 // A blank configuration depends only on the program type, the app's licensed values and its defaults, all fixed
 // for the life of the process, so each one is made once and reused. Making one runs Python and the workbook
 // parser: about half a second on a desktop, but 20 seconds or more on a small hosted instance, where Start
 // New Intake looked frozen (owner, 19 November 2026). warmNew prepares them shortly after start-up.
 const blanks=new Map();
 async function makeFile(mode,type,modifications,fileBuffer){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'isaf-intake-'));
  try{
   const source=path.join(dir,'source.xlsx'),output=path.join(dir,'configuration.xlsx');
   if(fileBuffer)await fs.writeFile(source,fileBuffer);
   const task=exec(process.env.ISAF_PYTHON||'python3',[path.join(serviceDir,'intake_workbook.py')],{timeout:60000,maxBuffer:2*1024*1024});
   task.child.stdin.on('error',()=>{});task.child.stdin.end(JSON.stringify({mode,type,source,output,modifications}));await task;
   const result=await exec(process.execPath,[parseScript,output],{timeout:60000,maxBuffer:10*1024*1024});
   const data=JSON.parse(result.stdout),bytes=await fs.readFile(output);
   const stem=String(data.program?.doc_prefix||'New_Program').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,60);
   return {data,filename:stem+'_Config.xlsx',mime,workbook:bytes.toString('base64')};
  }finally{await fs.rm(dir,{recursive:true,force:true});}
 }
 function newModifications(requested){
  const licensed=licensedValues();let type=requested,modifications={};
  if(newDefaults())modifications={...newDefaults()}; // customer app defaults (editable)
  if(licensed){modifications={...modifications,...licensed};if(licensed['program.type'])type=licensed['program.type'];}
  if(type==='AIRCRAFT')modifications={...modifications,'program.do160_in_scope':'Yes'}; // Aircraft programs always include DO-160
  return {type,modifications};
 }
 function blank(type,modifications){
  const key=type+'\n'+JSON.stringify(modifications);
  if(!blanks.has(key))blanks.set(key,makeFile('new',type,modifications).catch(error=>{blanks.delete(key);throw error;}));
  return blanks.get(key);
 }
 if(warmNew){
  const t=setTimeout(async()=>{
   const types=licensedProgramTypes().length?licensedProgramTypes():['LRU','SYSTEM','AIRCRAFT'];
   for(const requested of types){try{const {type,modifications}=newModifications(requested);await blank(type,modifications);}catch{}}
  },15000);t.unref?.();
 }
 async function run(req,res,mode){
  try{
   if(mode==='new'&&!['AIRCRAFT','SYSTEM','LRU'].includes(req.body?.type))return res.status(400).json({error:'Choose Aircraft, System or LRU.'});
   if(mode!=='new'&&!req.file)return res.status(400).json({error:'Select a configuration workbook.'});
   if(mode==='new'){
    const {type,modifications}=newModifications(req.body.type);
    if(licensedProgramTypes().length&&!licensedProgramTypes().includes(type))return res.status(403).json({error:`${type} programs are not included in your license. Licensed program types: ${licensedProgramTypes().join(', ')}.`});
    return res.json(await blank(type,modifications));
   }
   let modifications=JSON.parse(req.body.modifications||'{}');if(!modifications||typeof modifications!=='object'||Array.isArray(modifications))throw Error('Invalid configuration edits.');
   // Customer-specific app: licensed values always win (new intake and saved edits).
   const licensed=licensedValues();let type=req.body?.type;
   if(licensed){modifications={...modifications,...licensed};if(licensed['program.type'])type=licensed['program.type'];}
   res.json(await makeFile(mode,type,modifications,req.file.buffer));
  }catch(error){res.status(400).json({error:'The configuration workbook could not be created.',detail:String(error.stderr||error.message).slice(-4000)});}

 }
 router.post('/new',authorize('intake.write'),express.json(),(req,res)=>run(req,res,'new'));
 router.post('/workbook',authorize('intake.write'),upload,(req,res)=>run(req,res,'save'));
 return router;
}
