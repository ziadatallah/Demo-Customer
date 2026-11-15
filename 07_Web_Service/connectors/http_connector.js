import crypto from "node:crypto";
import {authorizationHeaders} from "./secrets.js";
import {connectorProfile} from "./profiles.js";

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
export const contentDigest=value=>crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

export class HttpConnector {
  constructor(definition,{secretResolver,fetchImpl=globalThis.fetch}={}){
    this.definition=structuredClone(definition);this.profile=connectorProfile(definition.type);this.secretResolver=secretResolver;this.fetch=fetchImpl;
    const url=new URL(definition.baseUrl);if(!["https:",...(definition.allowHttp?["http:"]:[])].includes(url.protocol))throw Error("Connector base URL must use HTTPS.");
    this.baseUrl=url.toString().replace(/\/$/,"");
  }
  async request(method,relativePath,{body,headers={}}={}){
    const secret=await this.secretResolver(this.definition.secretRef);
    const response=await this.fetch(new URL(relativePath,this.baseUrl+"/"),{method,headers:{Accept:this.profile.contentTypes[0],...authorizationHeaders(this.definition.configuration||{},secret),...headers,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
    const text=await response.text();let payload=text;try{payload=text?JSON.parse(text):null;}catch{}
    if(!response.ok)throw Object.assign(new Error(`Remote ${this.profile.label} request failed (${response.status}).`),{status:502,remoteStatus:response.status});
    return {payload,etag:response.headers?.get?.("etag")||null,url:response.url||new URL(relativePath,this.baseUrl+"/").toString()};
  }
  async testConnection(){const result=await this.request("GET",this.definition.configuration?.healthPath||this.profile.discoveryPath);return {ok:true,type:this.definition.type,label:this.profile.label,remoteUrl:result.url};}
  async discover(){const result=await this.request("GET",this.definition.configuration?.discoveryPath||this.profile.discoveryPath);return {type:this.definition.type,category:this.profile.category,capabilities:this.profile.capabilities,result:result.payload};}
  preview(local,operation={}){const mapping=operation.mapping||this.definition.configuration?.mapping||{};const fields={};for(const [remote,source] of Object.entries(mapping))fields[remote]=String(source).split(".").reduce((v,k)=>v?.[k],local);const payload={localKind:operation.localKind,localId:operation.localId,fields};return {operation:"upsert",path:operation.path||this.definition.configuration?.transferPath,digest:contentDigest(payload),payload};}
  async transfer(preview,{idempotencyKey,expectedRemoteDigest}={}){
    if(!preview?.path)throw Object.assign(new Error("The connector transfer path is not configured."),{status:400});
    if(expectedRemoteDigest&&preview.remoteDigest&&expectedRemoteDigest!==preview.remoteDigest)throw Object.assign(new Error("The remote item changed after preview. Refresh before transferring."),{status:409});
    const result=await this.request("POST",preview.path,{body:preview.payload,headers:{"Idempotency-Key":idempotencyKey||preview.digest,"X-ISAF-Content-Digest":preview.digest}});
    const remote=result.payload||{};return {remoteId:String(remote.id||remote.identifier||""),remoteRevision:String(remote.revision||remote.version||result.etag||""),remoteUrl:remote.url||result.url,remoteDigest:contentDigest(remote),response:remote};
  }
}
