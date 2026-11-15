import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {requireUuid} from "../persistence/postgres.js";

const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const digest = value => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(stable(value))).digest("hex");
const clone = value => structuredClone(value);

export class FileBuildJobStore {
  constructor({root, objectStore} = {}) {
    this.root = path.resolve(root);
    this.objectStore = objectStore;
    fs.mkdirSync(this.root, {recursive: true});
  }
  file(id) { return path.join(this.root, `${id}.json`); }
  read(id) {
    try { return JSON.parse(fs.readFileSync(this.file(id), "utf8")); }
    catch { return null; }
  }
  write(job) {
    const temp = `${this.file(job.id)}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(job, null, 2)}\n`, {mode: 0o600});
    fs.renameSync(temp, this.file(job.id));
    return clone(job);
  }
  list() { return fs.readdirSync(this.root).filter(name => /^[a-f0-9-]{36}\.json$/i.test(name)).map(name => this.read(name.slice(0, -5))).filter(Boolean).sort((a,b) => b.createdAt.localeCompare(a.createdAt)); }
  async submit(input, workbookBytes) {
    const stored = await this.objectStore.put(workbookBytes);
    const key = digest({programId: input.programId, phase: input.phase, inputHash: stored.hash, engineVersion: input.engineVersion, options: input.options || {}});
    const existing = this.list().find(job => job.idempotencyKey === key && !["failed", "cancelled"].includes(job.status));
    if (existing) return {...existing, reused: true};
    const now = new Date().toISOString();
    return this.write({
      id: crypto.randomUUID(), organizationId: input.organizationId || null, programId: input.programId,
      requestedBy: input.requestedBy || null, actor: input.actor, phase: input.phase, engineVersion: input.engineVersion,
      status: "queued", attempt: 0, idempotencyKey: key, input: {...stored, filename: input.filename},
      options: input.options || {}, result: null, error: null, createdAt: now, updatedAt: now,
    });
  }
  claimNext(workerId) {
    for (const job of this.list().reverse()) {
      if (job.status !== "queued") continue;
      const lock = `${this.file(job.id)}.lock`;
      let fd;
      try { fd = fs.openSync(lock, "wx", 0o600); }
      catch { continue; }
      try {
        const current = this.read(job.id);
        if (current?.status !== "queued") continue;
        current.status = "running"; current.workerId = workerId; current.attempt += 1;
        current.startedAt = new Date().toISOString(); current.updatedAt = current.startedAt;
        return this.write(current);
      } finally { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(lock, {force: true}); }
    }
    return null;
  }
  complete(id, result) { const job=this.read(id); if(!job||job.status!=="running")throw Error("Build job is not running.");job.status="succeeded";job.result=result;job.completedAt=new Date().toISOString();job.updatedAt=job.completedAt;return this.write(job); }
  fail(id, error, logObject = null) { const job=this.read(id);if(!job||job.status!=="running")throw Error("Build job is not running.");job.status="failed";job.error=String(error).slice(0,4000);job.logObject=logObject;job.completedAt=new Date().toISOString();job.updatedAt=job.completedAt;return this.write(job); }
  retry(id) { const job=this.read(id);if(!job||job.status!=="failed")throw Error("Only a failed build can be retried.");job.status="queued";job.error=null;job.workerId=null;job.startedAt=null;job.completedAt=null;job.updatedAt=new Date().toISOString();return this.write(job); }
}

export class PostgresBuildJobStore {
  constructor({metadata, organizationId, objectStore} = {}) { this.metadata=metadata;this.organizationId=requireUuid(organizationId,"Organization ID");this.objectStore=objectStore; }
  async submit(input, workbookBytes) {
    requireUuid(input.programId,"Program ID");
    const stored=await this.objectStore.put(workbookBytes),key=digest({programId:input.programId,phase:input.phase,inputHash:stored.hash,engineVersion:input.engineVersion,options:input.options||{}});
    return this.metadata.withTenant(this.organizationId,async client=>{
      const prior=await client.query("SELECT * FROM build_jobs WHERE organization_id=$1 AND idempotency_key=$2 AND status NOT IN ('failed','cancelled') ORDER BY created_at DESC LIMIT 1",[this.organizationId,key]);
      if(prior.rows[0])return {...this.map(prior.rows[0]),reused:true};
      const request={actor:input.actor,filename:input.filename,input:stored,options:input.options||{}};
      const result=await client.query(`INSERT INTO build_jobs (organization_id,program_id,status,requested_phase,configuration_id,engine_version,request,requested_by,idempotency_key,input_hash)
        VALUES ($1,$2,'queued',$3,NULL,$4,$5::jsonb,$6,$7,$8) RETURNING *`,[this.organizationId,input.programId,input.phase,input.engineVersion,JSON.stringify(request),input.requestedBy||null,key,stored.hash]);
      return this.map(result.rows[0]);
    });
  }
  map(row){const request=typeof row.request==='string'?JSON.parse(row.request):row.request||{};return {id:row.id,organizationId:row.organization_id||row.organizationId,programId:row.program_id||row.programId,requestedBy:row.requested_by||row.requestedBy,phase:row.requested_phase||row.requestedPhase,engineVersion:row.engine_version||row.engineVersion,status:row.status,attempt:Number(row.attempt||0),idempotencyKey:row.idempotency_key||row.idempotencyKey,input:{...(request.input||{}),filename:request.filename},actor:request.actor,options:request.options||{},result:row.result,error:row.error,createdAt:row.created_at||row.createdAt,updatedAt:row.updated_at||row.updatedAt};}
  async read(id){requireUuid(id,"Build job ID");return this.metadata.withTenant(this.organizationId,async c=>{const row=(await c.query("SELECT * FROM build_jobs WHERE organization_id=$1 AND id=$2",[this.organizationId,id])).rows[0];return row?this.map(row):null;});}
  async list(){return this.metadata.withTenant(this.organizationId,async c=>(await c.query("SELECT * FROM build_jobs WHERE organization_id=$1 ORDER BY created_at DESC",[this.organizationId])).rows.map(r=>this.map(r)));}
  async claimNext(workerId){return this.metadata.withTenant(this.organizationId,async c=>{const selected=await c.query("SELECT id FROM build_jobs WHERE organization_id=$1 AND status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",[this.organizationId]);if(!selected.rows[0])return null;const updated=await c.query("UPDATE build_jobs SET status='running',worker_id=$3,attempt=attempt+1,started_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *",[this.organizationId,selected.rows[0].id,workerId]);return this.map(updated.rows[0]);});}
  async complete(id,result){return this.metadata.withTenant(this.organizationId,async c=>this.map((await c.query("UPDATE build_jobs SET status='succeeded',result=$3::jsonb,error=NULL,completed_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 AND status='running' RETURNING *",[this.organizationId,id,JSON.stringify(result)])).rows[0]));}
  async fail(id,error,logObject=null){return this.metadata.withTenant(this.organizationId,async c=>this.map((await c.query("UPDATE build_jobs SET status='failed',error=$3,log_object=$4::jsonb,completed_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 AND status='running' RETURNING *",[this.organizationId,id,String(error).slice(0,4000),JSON.stringify(logObject)])).rows[0]));}
  async retry(id){return this.metadata.withTenant(this.organizationId,async c=>this.map((await c.query("UPDATE build_jobs SET status='queued',error=NULL,worker_id=NULL,started_at=NULL,completed_at=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 AND status='failed' RETURNING *",[this.organizationId,id])).rows[0]));}
}

export function createBuildJobStore(repository,{root,organizationId}={}){
  if(repository?.metadata?.withTenant)return new PostgresBuildJobStore({metadata:repository.metadata,organizationId,objectStore:repository.objectStore});
  return new FileBuildJobStore({root,objectStore:repository.objectStore});
}
