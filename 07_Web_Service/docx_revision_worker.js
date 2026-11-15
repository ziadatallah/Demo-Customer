// Worker thread for revision stamping (docx_revision.js updateDocxRevisionSync). Stamping parses each
// document's XML; doing it here keeps the web server's main thread free during large builds.
import {parentPort} from 'node:worker_threads';
import {updateDocxRevisionSync} from './docx_revision.js';
parentPort.on('message',({id,bytes,label,options})=>{
 try{
  const result=updateDocxRevisionSync(Buffer.from(bytes),label,options);
  const out=new Uint8Array(result.bytes);
  parentPort.postMessage({id,result:{...result,bytes:out}},[out.buffer]);
 }catch(error){parentPort.postMessage({id,error:{message:error.message,status:error.status}});}
});
