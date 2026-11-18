import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRepositoryProviderAsync} from "../persistence/provider.js";
import {createBuildJobStore} from "./build_jobs.js";
import {DurableBuildWorker,runWorkerLoop} from "./build_worker.js";
import {createOperationsCenter} from "../operations/activation.js";

const here=path.dirname(fileURLToPath(import.meta.url)),service=path.resolve(here,"..");
const repositoryRoot=process.env.ISAF_REPOSITORY_DIR||path.join(service,"repository");
const repository=await createRepositoryProviderAsync({root:repositoryRoot});
const jobs=createBuildJobStore(repository,{root:path.join(repositoryRoot,"build-jobs"),organizationId:process.env.ISAF_ORGANIZATION_ID});
const operations=createOperationsCenter({root:repositoryRoot,environment:process.env,version:"5.3.41",edition:process.env.ISAF_EDITION||"full",metadata:repository.metadata,organizationId:process.env.ISAF_ORGANIZATION_ID});
const bundle=path.resolve(service,"../03_Build_Engine/build.bundle.js"),source=path.resolve(service,"../03_Build_Engine/src/build.js");
const worker=new DurableBuildWorker({jobStore:jobs,repository,operations,workerId:`${os.hostname()}-${process.pid}`,buildOptions:{
  buildScript:fs.existsSync(bundle)?bundle:source,
  parseScript:fs.existsSync(path.join(service,"parse_workbook.bundle.js"))?path.join(service,"parse_workbook.bundle.js"):path.join(service,"parse_workbook.js"),
  settingsPath:path.join(service,"user_settings.json"),
  phaseMap:{all:null,codr:"CoDR",srr:"SRR",pdr:"PDR",soi1:"SOI-1",cdr:"CDR",soi2:"SOI-2",soi3:"SOI-3",trr:"TRR",soi4:"SOI-4",tia:"TIA"},
  includeSourceWorkbook:process.env.ISAF_EDITION!=="demo",
}});
const controller=new AbortController();process.on("SIGTERM",()=>controller.abort());process.on("SIGINT",()=>controller.abort());
console.log(`ISAF durable build worker ${os.hostname()} starting.`);
await runWorkerLoop(worker,{intervalMs:Number(process.env.ISAF_WORKER_POLL_MS||1000),signal:controller.signal});
