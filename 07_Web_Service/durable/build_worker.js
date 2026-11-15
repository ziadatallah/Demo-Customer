import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {PassThrough} from "node:stream";
import archiver from "archiver";
import {runRepositoryBuild} from "../repository_build.js";

async function zipDirectory(directory) {
  const output = new PassThrough(), chunks = [];
  output.on("data", chunk => chunks.push(chunk));
  const completed = new Promise((resolve, reject) => { output.on("end", () => resolve(Buffer.concat(chunks))); output.on("error", reject); });
  const archive = archiver("zip", {zlib: {level: 6}});
  archive.on("error", error => output.destroy(error)); archive.pipe(output); archive.directory(directory, false); await archive.finalize();
  return completed;
}

export class DurableBuildWorker {
  constructor({jobStore, repository, workerId = `worker-${process.pid}`, buildOptions = {}, runner = runRepositoryBuild, packager = zipDirectory, operations = null} = {}) {
    this.jobs=jobStore;this.repository=repository;this.workerId=workerId;this.buildOptions=buildOptions;this.runner=runner;this.packager=packager;this.operations=operations;
  }
  async processNext() {
    await this.operations?.heartbeat({workerId:this.workerId,status:"ready"});
    const job = await this.jobs.claimNext(this.workerId);
    if (!job) return null;
    await this.operations?.heartbeat({workerId:this.workerId,status:"working",detail:{jobId:job.id}});
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), `isaf-job-${job.id}-`));
    try {
      const workbook = path.join(folder, path.basename(job.input.filename || "Program_Config.xlsx"));
      fs.writeFileSync(workbook, await this.jobs.objectStore.get(job.input.hash));
      const outputBase = path.join(folder, "output");
      const result = await this.runner({
        store:this.repository,workbookPath:workbook,phaseId:job.phase,outputBase,programId:job.programId,actor:job.actor,
        ...this.buildOptions,...job.options,
      });
      const packageBytes = await this.packager(result.outputDir);
      const packageObject = await this.jobs.objectStore.put(packageBytes);
      const manifest = {
        schemaVersion:1,jobId:job.id,attempt:job.attempt,inputHash:job.input.hash,engineVersion:job.engineVersion,
        phase:job.phase,buildId:result.buildId,documentCount:result.docCount,package:packageObject,
        completedAt:new Date().toISOString(),
      };
      const manifestObject = await this.jobs.objectStore.put(Buffer.from(`${JSON.stringify(manifest,null,2)}\n`));
      const logObject = await this.jobs.objectStore.put(Buffer.from(String(result.log || JSON.stringify(result))));
      return await this.jobs.complete(job.id,{...manifest,manifest:manifestObject,log:logObject});
    } catch (error) {
      const logObject = await this.jobs.objectStore.put(Buffer.from(String(error.stack || error.message || error)));
      await this.jobs.fail(job.id,error.message||error,logObject);
      return await this.jobs.read(job.id);
    } finally { fs.rmSync(folder,{recursive:true,force:true});await this.operations?.heartbeat({workerId:this.workerId,status:"ready"}); }
  }
}

export async function runWorkerLoop(worker,{intervalMs=1000,signal}={}){
  while(!signal?.aborted){const job=await worker.processNext();if(!job)await new Promise(resolve=>setTimeout(resolve,intervalMs));}
}
