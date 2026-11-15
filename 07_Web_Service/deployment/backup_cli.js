import {execFileSync} from "node:child_process";import fs from "node:fs";import path from "node:path";import {createBackup,restoreBackup,verifyBackup} from "./backup.js";import {environmentIdentity} from "./environment.js";
const [action,folderArg]=process.argv.slice(2),folder=path.resolve(folderArg||"");if(!["create","verify","restore"].includes(action)||!folderArg)throw Error("Usage: node backup_cli.js create|verify|restore <folder>");
const env=process.env,identity=environmentIdentity(env),s3=`s3://${env.ISAF_S3_BUCKET}/${String(env.ISAF_S3_PREFIX||"isaf/objects").replace(/^\/+|\/+$/g,"")}`;
const awsArgs=()=>["--endpoint-url",env.ISAF_S3_ENDPOINT,"s3","sync"];
if(action==="create")await createBackup({destination:folder,identity,databaseExporter:async file=>execFileSync("pg_dump",["--format=custom","--file",file,env.ISAF_DATABASE_URL],{stdio:"inherit"}),objectExporter:async dir=>execFileSync("aws",[...awsArgs(),s3,dir,"--only-show-errors"],{stdio:"inherit",env})});
if(action==="verify")verifyBackup(folder);
if(action==="restore"){if(env.ISAF_RESTORE_CONFIRM!==identity.fingerprint)throw Error("Set ISAF_RESTORE_CONFIRM to the target environment fingerprint before restore.");await restoreBackup({source:folder,expectedIdentity:identity,databaseImporter:async file=>execFileSync("pg_restore",["--clean","--if-exists","--dbname",env.ISAF_DATABASE_URL,file],{stdio:"inherit"}),objectImporter:async dir=>execFileSync("aws",[...awsArgs(),dir,s3,"--delete","--only-show-errors"],{stdio:"inherit",env})});}
console.log(`Backup ${action} completed: ${folder}`);
