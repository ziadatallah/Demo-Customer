import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export function intakeRoutes({requireAuth,authorize=()=>((_req,_res,next)=>next()),serviceDir,parseScript,licensedValues=()=>null,licensedProgramTypes=()=>[],newDefaults=()=>null}) {
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
 async function run(req,res,mode){
  let dir;
  try{
   if(mode==='new'&&!['AIRCRAFT','SYSTEM','LRU'].includes(req.body?.type))return res.status(400).json({error:'Choose Aircraft, System or LRU.'});
   if(mode!=='new'&&!req.file)return res.status(400).json({error:'Select a configuration workbook.'});
   let modifications={};if(mode!=='new'){modifications=JSON.parse(req.body.modifications||'{}');if(!modifications||typeof modifications!=='object'||Array.isArray(modifications))throw Error('Invalid configuration edits.');}
   // Customer-specific app: licensed values always win (new intake and saved edits).
   const licensed=licensedValues();let type=req.body?.type;
   if(mode==='new'&&newDefaults())modifications={...newDefaults(),...modifications}; // customer app defaults (editable)
   if(licensed){modifications={...modifications,...licensed};if(licensed['program.type'])type=licensed['program.type'];}
   if(mode==='new'&&licensedProgramTypes().length&&!licensedProgramTypes().includes(type))return res.status(403).json({error:`${type} programs are not included in your licence. Licensed program types: ${licensedProgramTypes().join(', ')}.`});
   if(mode==='new'&&type==='AIRCRAFT')modifications={...modifications,'program.do160_in_scope':'Yes'}; // Aircraft programs always include DO-160
   dir=await fs.mkdtemp(path.join(os.tmpdir(),'isaf-intake-'));
   const source=path.join(dir,'source.xlsx'),output=path.join(dir,'configuration.xlsx');
   if(req.file)await fs.writeFile(source,req.file.buffer);
   const task=exec(process.env.ISAF_PYTHON||'python3',[path.join(serviceDir,'intake_workbook.py')],{timeout:30000,maxBuffer:2*1024*1024});
   task.child.stdin.on('error',()=>{});task.child.stdin.end(JSON.stringify({mode,type,source,output,modifications}));await task;
   const result=await exec(process.execPath,[parseScript,output],{timeout:30000,maxBuffer:10*1024*1024});
   const data=JSON.parse(result.stdout),bytes=await fs.readFile(output);
   const stem=String(data.program?.doc_prefix||'New_Program').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,60);
   const filename=stem+'_Config.xlsx';
   res.json({data,filename,mime,workbook:bytes.toString('base64')});
  }catch(error){res.status(400).json({error:'The configuration workbook could not be created.',detail:String(error.stderr||error.message).slice(-4000)});}
  finally{if(dir)await fs.rm(dir,{recursive:true,force:true});}
 }
 router.post('/new',authorize('intake.write'),express.json(),(req,res)=>run(req,res,'new'));
 router.post('/workbook',authorize('intake.write'),upload,(req,res)=>run(req,res,'save'));
 return router;
}
