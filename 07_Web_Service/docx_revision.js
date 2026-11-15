import {Worker} from 'node:worker_threads';
import PizZip from '../03_Build_Engine/node_modules/pizzip/js/index.js';
import {DOMParser, XMLSerializer} from '../03_Build_Engine/node_modules/@xmldom/xmldom/lib/index.js';
import {fitHeaderCells} from './header_fit.js';

const XML_TEXT = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
const LABEL_ONLY = /^(?:document\s+)?rev(?:ision)?\s*:?\s*$/i;
const LABEL_WITH_VALUE = /^((?:document\s+)?rev(?:ision)?\s*:\s*)(.+)$/i;
const COVER_LINE = /^((?:document\s+)?rev(?:ision)?\s*:?[ \t]*)([A-Za-z0-9][A-Za-z0-9.-]*)([ \t]+(?:·|\|)[ \t]+.+)$/i;

function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function encodeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function revisionValue(value) {
  const clean = decodeXml(value).trim();
  if (!clean || clean.length > 40) return false;
  if (/^(?:release\s+date|date|revision\s+history)\s*:?$/i.test(clean)) return false;
  return /^(?:rev(?:ision)?\s*)?(?:[A-Za-z]+|\d+)(?:[.-](?:draft|candidate))?[.-]?\d*$/i.test(clean)
    || /^\{revision\}$/i.test(clean)
    || /^\[(?:document\s+)?revision\]$/i.test(clean);
}

function replacementValue(current, label) {
  return /^rev(?:ision)?\b/i.test(decodeXml(current).trim()) ? `Rev ${label}` : label;
}

export function updateRevisionXml(xml, label) {
  const nodes = [...xml.matchAll(XML_TEXT)].map(match => ({
    start: match.index,
    end: match.index + match[0].length,
    full: match[0],
    raw: match[1],
    text: decodeXml(match[1]).trim(),
  }));
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const coverLine = node.text.match(COVER_LINE);
    if (coverLine) {
      const nextText = coverLine[1] + label + coverLine[3];
      return {xml: xml.slice(0, node.start) + node.full.replace(node.raw, encodeXml(nextText)) + xml.slice(node.end), updated: true, previous: coverLine[2]};
    }
    const combined = node.text.match(LABEL_WITH_VALUE);
    if (combined && !LABEL_ONLY.test(node.text) && revisionValue(combined[2])) {
      const nextText = combined[1] + replacementValue(combined[2], label);
      return {xml: xml.slice(0, node.start) + node.full.replace(node.raw, encodeXml(nextText)) + xml.slice(node.end), updated: true, previous: combined[2]};
    }
    if (!LABEL_ONLY.test(node.text)) continue;
    for (let j = i + 1; j < Math.min(nodes.length, i + 7); j++) {
      if (!nodes[j].text) continue;
      if (!revisionValue(nodes[j].raw)) break;
      const target = nodes[j];
      const nextText = replacementValue(target.raw, label);
      return {xml: xml.slice(0, target.start) + target.full.replace(target.raw, encodeXml(nextText)) + xml.slice(target.end), updated: true, previous: target.text};
    }
  }
  return {xml, updated: false, previous: null};
}

// Repository-side watermarking applies the approved Demo mark and upgrades
// earlier pale marks. All document pages use repeating Word headers.
export function ensureDemoWatermarkSync(bytes) {
 let zip;
 try { zip=new PizZip(bytes); } catch { throw Object.assign(new Error('The selected Word file is damaged or is not a valid DOCX file.'),{status:422}); }
 const marker='ISAF_DEMO_WATERMARK';let changed=false;
 for(const name of Object.keys(zip.files).filter(n=>/^word\/header\d+\.xml$/.test(n))){
  let xml=zip.file(name).asText();
  const referenceStyle=xml.includes('width:503.2pt;height:207.2pt;rotation:315')&&xml.includes('fillcolor="#1f497d [3215]"')&&xml.includes('PowerPlusWaterMarkObject')&&xml.includes('o:spid="_x0000_s')&&xml.includes('w14:anchorId=');
  if(referenceStyle)continue;
    if(xml.includes(marker))xml=xml.replace(/<w:p(?=[\s>])[^>]*>(?:(?!<w:p(?=[\s>]))[\s\S])*?<\/w:p>/g,p=>p.includes(marker)?'':p);
  const root=xml.match(/<w:hdr\b[^>]*>/);if(!root)continue;
  let opening=root[0];
  for(const [prefix,uri] of Object.entries({v:'urn:schemas-microsoft-com:vml',o:'urn:schemas-microsoft-com:office:office',w10:'urn:schemas-microsoft-com:office:word',w14:'http://schemas.microsoft.com/office/word/2010/wordml'}))if(!new RegExp(`xmlns:${prefix}\\s*=`).test(opening))opening=opening.slice(0,-1)+` xmlns:${prefix}="${uri}">`;
  const index=Number((name.match(/header(\d+)/)||[])[1]||1);
  const maxSpid=[...xml.matchAll(/o:spid="_x0000_s(\d+)"/g)].reduce((max,match)=>Math.max(max,Number(match[1])),1024);
  const spid=maxSpid+1;
  const anchorId=`D3E0${String(index).padStart(4,'0')}`;
  const shapeId=900000000+index;
  const watermark=`<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:pict w14:anchorId="${anchorId}"><v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype><v:shape id="PowerPlusWaterMarkObject${shapeId}" o:spid="_x0000_s${spid}" type="#_x0000_t136" alt="${marker}" style="position:absolute;margin-left:0;margin-top:0;width:503.2pt;height:207.2pt;rotation:315;z-index:-251640832;mso-wrap-edited:f;mso-width-percent:0;mso-height-percent:0;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin;mso-width-percent:0;mso-height-percent:0" o:allowincell="f" fillcolor="#1f497d [3215]" stroked="f"><v:textpath style="font-family:&quot;Cambria&quot;;font-size:1pt;font-weight:bold" string="DEMO"/></v:shape></w:pict></w:r></w:p>`;
  xml=xml.replace(root[0],opening).replace('</w:hdr>',watermark+'</w:hdr>');zip.file(name,xml);changed=true;
 }
 return changed?zip.generate({type:'nodebuffer',compression:'DEFLATE'}):Buffer.from(bytes);
}


const WNS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function updateRunningXml(xml,label,filename){
 const doc=new DOMParser().parseFromString(xml,'application/xml');let changed=false;
 const controls=[...doc.getElementsByTagNameNS(WNS,'sdt')];
 for(const control of controls){
  const tags=[...control.getElementsByTagNameNS(WNS,'tag')];
  if(!tags.some(tag=>(tag.getAttributeNS(WNS,'val')||'')==='ISAF.CurrentRevisionSource'))continue;
  const nodes=[...control.getElementsByTagNameNS(WNS,'t')];
  if(nodes.length){nodes.forEach((n,i)=>n.textContent=i?'':String(label));changed=true;}
 }
 const fields=[...doc.getElementsByTagNameNS(WNS,'fldSimple')];
 for(const field of fields){
  const instruction=field.getAttributeNS(WNS,'instr')||'';
  const isRevision=/^\s*REF\s+ISAF_CurrentRevision(?:\s|$)/i.test(instruction);
  const isFilename=/^\s*FILENAME(?:\s|$)/i.test(instruction);
  const value=isRevision?label:isFilename?filename:null;
  if(value==null)continue;
  const nodes=[...field.getElementsByTagNameNS(WNS,'t')];
  if(nodes.length){nodes.forEach((n,i)=>n.textContent=i?'':String(value));changed=true;}
 }
 return {xml:changed?new XMLSerializer().serializeToString(doc):xml,updated:changed};
}
// Keep each rewritten part's original timestamp, so stamping the same document gives the same bytes
// (whether it runs on the main thread or a worker, now or a second later).
const keepDate=(zip,name)=>zip.files[name]?.date?{date:zip.files[name].date}:{};
export function updateDocxRevisionSync(bytes,label,{filename}={}) {
 let zip;
 try {zip=new PizZip(bytes);} catch {throw Object.assign(new Error('The selected Word file is damaged or is not a valid DOCX file.'),{status:422});}
 const parts=[];let previous=null;
 const main=zip.file('word/document.xml');
 if(main){
  // The generated Document References block lists other documents with their own revisions; it must not
  // receive this document's revision label.
  const blocks=[];const shielded=main.asText().replace(/<w:sdt\b[^>]*>(?:(?!<w:sdt\b)[\s\S])*?<w:tag w:val="ISAF\.DocumentReferences"\/>[\s\S]*?<\/w:sdt>/g,m=>{blocks.push(m);return `<!--ISAF-BLOCK-${blocks.length-1}-->`;});
  const plainShielded=updateRevisionXml(shielded,label),plain={...plainShielded,xml:plainShielded.xml.replace(/<!--ISAF-BLOCK-(\d+)-->/g,(m,i)=>blocks[Number(i)])},tagged=updateRunningXml(plain.xml,label,filename);
  if(plain.updated||tagged.updated){zip.file('word/document.xml',tagged.xml,keepDate(zip,'word/document.xml'));parts.push('word/document.xml');previous=plain.previous;}
 }
 for(const name of Object.keys(zip.files).filter(n=>/^word\/(?:header|footer)\d+\.xml$/.test(n))){
  const old=zip.file(name).asText();let result=updateRunningXml(old,label,filename);
  // Legacy Word documents without tagged fields can still expose a plain revision label.
  if(!result.updated&&/^word\/header/.test(name)){const plain=updateRevisionXml(old,label);if(plain.updated){result=plain;previous??=plain.previous;}}
  if(result.updated){zip.file(name,/^word\/header/.test(name)?fitHeaderCells(result.xml):result.xml,keepDate(zip,name));parts.push(name);}
 }
 if(!parts.length)return {bytes:Buffer.from(bytes),updated:false,previous:null,label,part:null,parts:[]};
 return {bytes:zip.generate({type:'nodebuffer',compression:'DEFLATE'}),updated:true,previous,label,part:parts[0],parts};
}
export async function updateDocxRevision(bytes,label,options={}) {return updateDocxRevisionSync(bytes,label,options);}

// The same stamping on a worker thread, so a server stamping many documents (a build) stays responsive.
// Falls back to the main thread if a worker cannot be started.
let revisionWorker=null,revisionSeq=0;const revisionPending=new Map();
function revisionWorkerInstance(){
 if(revisionWorker)return revisionWorker;
 revisionWorker=new Worker(new URL('./docx_revision_worker.js',import.meta.url));revisionWorker.unref();
 revisionWorker.on('message',({id,result,error})=>{const p=revisionPending.get(id);if(!p)return;revisionPending.delete(id);if(error)p.reject(Object.assign(new Error(error.message),{status:error.status}));else p.resolve({...result,bytes:Buffer.from(result.bytes)});if(!revisionPending.size)revisionWorker?.unref();});
 revisionWorker.on('error',error=>{for(const p of revisionPending.values())p.reject(error);revisionPending.clear();revisionWorker=null;});
 return revisionWorker;
}
export async function updateDocxRevisionOffThread(bytes,label,options={}) {
 let worker;try{worker=revisionWorkerInstance();}catch{return updateDocxRevisionSync(bytes,label,options);}
 const id=++revisionSeq;worker.ref();
 return new Promise((resolve,reject)=>{revisionPending.set(id,{resolve,reject});worker.postMessage({id,bytes:Uint8Array.from(bytes),label,options});});
}
