import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {HttpConnector,contentDigest} from "./http_connector.js";
import {CONNECTOR_PROFILES} from "./profiles.js";
import {createEnvironmentSecretResolver} from "./secrets.js";

function safeDefinitions(filename){try{const parsed=JSON.parse(fs.readFileSync(filename,"utf8"));return Array.isArray(parsed.integrations)?parsed.integrations:[];}catch{return [];}}
function validateDefinition(input={}){
  const item={
    id:String(input.id||"").trim(), name:String(input.name||"").trim(), type:String(input.type||"").trim(),
    baseUrl:String(input.baseUrl||"").trim().replace(/\/$/,""), secretRef:String(input.secretRef||"").trim(),
    enabled:input.enabled!==false, configuration:input.configuration&&typeof input.configuration==="object"?input.configuration:{},
  };
  if(!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(item.id))throw Object.assign(new Error("Integration ID must contain 2-64 letters, numbers, periods, underscores, or hyphens."),{status:400});
  if(!item.name)throw Object.assign(new Error("Integration name is required."),{status:400});
  if(!CONNECTOR_PROFILES[item.type])throw Object.assign(new Error("Select a supported integration type."),{status:400});
  let url;try{url=new URL(item.baseUrl);}catch{throw Object.assign(new Error("Enter a valid HTTPS service address."),{status:400});}
  if(url.protocol!=="https:"&&!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(item.baseUrl))throw Object.assign(new Error("Integration service addresses must use HTTPS."),{status:400});
  if(!item.secretRef)throw Object.assign(new Error("Secret reference is required. Credentials must remain in the server secret manager."),{status:400});
  if("secret" in input||"token" in input||"password" in input)throw Object.assign(new Error("Do not enter credentials here. Use a secret-manager reference."),{status:400});
  return item;
}
export class ConnectorService{
  constructor({configurationFile,linkFile,auditFile,secretResolver=createEnvironmentSecretResolver(),fetchImpl}={}){this.configurationFile=configurationFile;this.linkFile=linkFile;this.auditFile=auditFile||path.join(path.dirname(linkFile),"integration-audit.jsonl");this.secretResolver=secretResolver;this.fetchImpl=fetchImpl;fs.mkdirSync(path.dirname(linkFile),{recursive:true});}
  profiles(){return Object.entries(CONNECTOR_PROFILES).map(([type,value])=>({type,...value}));}
  definitions(){return safeDefinitions(this.configurationFile).map(({secret,...item})=>item);}
  saveDefinition(input){const item=validateDefinition(input),items=safeDefinitions(this.configurationFile);const index=items.findIndex(entry=>entry.id===item.id);if(index>=0)items[index]=item;else items.push(item);fs.mkdirSync(path.dirname(this.configurationFile),{recursive:true});const temp=`${this.configurationFile}.${process.pid}.tmp`;fs.writeFileSync(temp,`${JSON.stringify({integrations:items},null,2)}\n`,{mode:0o600});fs.renameSync(temp,this.configurationFile);this.audit("integration.configuration.saved",{integrationId:item.id,type:item.type,enabled:item.enabled});return this.definitions().find(entry=>entry.id===item.id);}
  deleteDefinition(id){const items=safeDefinitions(this.configurationFile),next=items.filter(entry=>entry.id!==id);if(next.length===items.length)throw Object.assign(new Error("Integration not found."),{status:404});const temp=`${this.configurationFile}.${process.pid}.tmp`;fs.writeFileSync(temp,`${JSON.stringify({integrations:next},null,2)}\n`,{mode:0o600});fs.renameSync(temp,this.configurationFile);this.audit("integration.configuration.deleted",{integrationId:id});return {id,deleted:true};}
  definition(id){const item=safeDefinitions(this.configurationFile).find(entry=>entry.id===id&&entry.enabled!==false);if(!item)throw Object.assign(new Error("Integration not found or disabled."),{status:404});if("secret" in item)throw Object.assign(new Error("Plaintext integration credentials are prohibited; use secretRef."),{status:500});return item;}
  connector(id){return new HttpConnector(this.definition(id),{secretResolver:this.secretResolver,fetchImpl:this.fetchImpl});}
  links(){try{return JSON.parse(fs.readFileSync(this.linkFile,"utf8"));}catch{return [];}}
  saveLinks(links){const temp=`${this.linkFile}.${process.pid}.tmp`;fs.writeFileSync(temp,`${JSON.stringify(links,null,2)}\n`,{mode:0o600});fs.renameSync(temp,this.linkFile);}
  audit(action,detail){let previousHash=null;try{const lines=fs.readFileSync(this.auditFile,"utf8").trim().split("\n").filter(Boolean);previousHash=lines.length?JSON.parse(lines.at(-1)).eventHash:null;}catch{}const event={id:crypto.randomUUID(),action,detail,occurredAt:new Date().toISOString(),previousHash};event.eventHash=crypto.createHash("sha256").update(JSON.stringify(event)).digest("hex");fs.appendFileSync(this.auditFile,`${JSON.stringify(event)}\n`,{mode:0o600});return event;}
  async test(id){try{const result=await this.connector(id).testConnection();this.audit("integration.test.allowed",{integrationId:id});return result;}catch(error){this.audit("integration.test.failed",{integrationId:id,error:String(error.message).slice(0,500)});throw error;}}
  async discover(id){const result=await this.connector(id).discover();this.audit("integration.discover",{integrationId:id,category:result.category});return result;}
  preview(id,local,operation){return this.connector(id).preview(local,operation);}
  async transfer(id,local,operation={}){
    const connector=this.connector(id),preview=connector.preview(local,operation),key=contentDigest({id,localId:operation.localId,digest:preview.digest});const links=this.links();
    const prior=links.find(link=>link.idempotencyKey===key);if(prior){this.audit("integration.transfer.reused",{integrationId:id,localKind:operation.localKind,localId:operation.localId,remoteId:prior.remoteId});return {...prior,reused:true};}
    const current=links.find(link=>link.integrationId===id&&link.localKind===operation.localKind&&link.localId===operation.localId);
    if(current&&operation.expectedRemoteRevision&&current.remoteRevision!==operation.expectedRemoteRevision)throw Object.assign(new Error("The known remote revision changed. Refresh the link before transferring."),{status:409});
    const result=await connector.transfer(preview,{idempotencyKey:key,expectedRemoteDigest:operation.expectedRemoteDigest});
    const link={integrationId:id,localKind:operation.localKind,localId:operation.localId,idempotencyKey:key,localDigest:preview.digest,...result,synchronizedAt:new Date().toISOString()};delete link.response;links.push(link);this.saveLinks(links);this.audit("integration.transfer.completed",{integrationId:id,localKind:link.localKind,localId:link.localId,remoteId:link.remoteId,remoteRevision:link.remoteRevision,localDigest:link.localDigest,remoteDigest:link.remoteDigest});return link;
  }
}

export function createConnectorService({root,configurationFile,environment=process.env,fetchImpl}={}){return new ConnectorService({configurationFile:configurationFile||environment.ISAF_INTEGRATIONS_FILE||path.join(root,"integrations.json"),linkFile:path.join(root,"external-links.json"),auditFile:path.join(root,"integration-audit.jsonl"),secretResolver:createEnvironmentSecretResolver(environment),fetchImpl});}
