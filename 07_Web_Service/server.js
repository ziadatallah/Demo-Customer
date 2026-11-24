import {intakeRoutes} from "./intake_routes.js";
import {createRepositoryProviderAsync} from "./persistence/provider.js";
import {RepositoryStore} from "./repository_store.js";
// Python helpers (openpyxl) installed beside the app, for example by the Render build command
// "pip3 install --target 07_Web_Service/pylib openpyxl==3.1.5", are found by every Python child process.
{const pylib=path.join(path.dirname(fileURLToPath(import.meta.url)),"pylib");if(fs.existsSync(pylib))process.env.PYTHONPATH=[pylib,process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);}
import {createAuthentication} from "./auth/middleware.js";
import {hasPermission,requestActor} from "./auth/permissions.js";
import {createAuthorizationAudit} from "./auth/audit.js";
import {createBuildJobStore} from "./durable/build_jobs.js";
import {validateHostedEnvironment} from "./deployment/environment.js";
import {createConnectorService} from "./connectors/service.js";
import {createOperationsCenter} from "./operations/activation.js";
import {repositoryRoutes} from "./repository_routes.js";
import {runRepositoryBuild} from "./repository_build.js";
import {readBuildResult} from "./build_result.js";
import {applyImport as applyRequirementsImport,importReportText,TARGETS as REQUIREMENT_TARGETS} from "./requirements_docs.js";
import {normalize as normalizeRequirements,review as reviewRequirements,LEVELS as REQUIREMENT_LEVELS,DEFAULT_OPTIONS as REVIEW_DEFAULTS} from "./requirements_review.js";
import {readLink as readRequirementsLink,saveLink as saveRequirementsLink,clearLink as clearRequirementsLink,linkSummary as requirementsLinkSummary,requirementsForBuild} from "./requirements_link.js";
import {createUsageRecorder,createUsageStore,summarizeUsage,usageCsv,usageToken,validToken} from "./usage.js";
import {createReleaseRegister,createUpdateClient} from "./updates.js";
import {DEFAULT_MAX_ITEMS} from "./jama.js";
import {createConnectionStore,TOOLS} from "./tool_connections.js";
import {customerDataDir} from "./customers.js";
import {seatSigner as createSeatSigner} from "./auth/seats.js";
import {createAccountStore, sessionToken} from "./auth/accounts.js";
import {accountRoutes} from "./auth/account_routes.js";
import {CustomerRegister,CUSTOMER_OPTIONS,REQUIREMENTS_IMPORT,AVAILABLE_IMPORT_IDS,FILE_IMPORT_IDS,releaseVersions,deliveryRegisterFile,deliveryRow,licenseChanged,starterModifications,appAccessKeys,licensedPhaseIds,licensedProgramTypes,CUSTOMER_DEFAULTS} from "./customers.js";
import {postprocessOutput, findSoffice} from "./output_postprocess.js";
import {watermarkText} from "./demo_watermark.js";
/**
 * ISAF Web Service — thin HTTP wrapper around the build engine.
 *
 * Endpoints:
 *   GET  /                  → Upload page (static HTML)
 *   POST /api/parse         → Upload workbook, return config data as JSON
 *   POST /api/build         → Upload workbook, run build, return a temporary download URL
 *                              Optional: ?phase=soi1|soi2|soi3|soi4|codr|pdr|cdr|all
 *   GET  /api/download?id=  → Download a completed build as a ZIP
 *   GET  /api/health        → Health check
 *
 * Auth: API-key based. Set ISAF_API_KEY env var; clients pass it
 *       as the X-API-Key header or as ?key= query param.
 *
 * Usage:
 *   ISAF_API_KEY=mySecret node server.js
 *   curl -H "X-API-Key: mySecret" -F "workbook=@input.xlsx" \
 *        http://localhost:3000/api/build -o output.zip
 *   curl -H "X-API-Key: mySecret" -F "workbook=@input.xlsx" \
 *        -F "phase=soi1" http://localhost:3000/api/build -o soi1.zip
 */

import express from "express";
import { validate as validateDocumentPNs } from "./public/document-pns.js";
import { validate as validateConfiguration } from "./config_validation.bundle.js";
import multer from "multer";
import { execFile, spawnSync } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import archiver from "archiver";
import crypto from "crypto";
import os from "os";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

function buildErrorResponse(err) {
  const detail = [err.stderr, err.stdout].filter(Boolean).join("\n").slice(-12000) || err.message;
  const invalidWorkbook = /\[BLOCKER\s+V\d+\]/.test(detail);
  return {
    status: invalidWorkbook ? 422 : 500,
    body: {
      error: invalidWorkbook ? "Workbook needs attention. See the missing or unresolved fields in the build log." : "Build failed. See the build log for details.",
      detail,
    },
  };
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || "3000", 10);
const API_KEY = process.env.ISAF_API_KEY || "";
// A customer app carries the SHA-256 of its access key (EDITION.json access_key_sha256), so a local or
// on-premise install asks for the key even without ISAF_API_KEY. That built-in key takes precedence over
// ISAF_API_KEY (which then only applies to apps without one), so a key changed in the Admin app and published
// replaces the old one everywhere.
// Named users of a customer app (EDITION.json access_keys, from the Admin Customers tab): each has its own key.
const ACCESS_KEYS = (()=>{try{const m=JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..","EDITION.json"),"utf8"));return m.edition==="customer"&&Array.isArray(m.access_keys)?m.access_keys.filter(k=>/^[0-9a-f]{64}$/i.test(k?.sha256||"")):[];}catch{return [];}})();
const API_KEY_HASH = (()=>{try{const m=JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..","EDITION.json"),"utf8"));return m.edition==="customer"&&/^[0-9a-f]{64}$/i.test(m.access_key_sha256||"")?m.access_key_sha256:"";}catch{return "";}})();
const AUTH_MODE = String(process.env.ISAF_AUTH_MODE || "api-key").toLowerCase();
const HOSTED_SERVICE = Boolean(process.env.RENDER) || process.env.ISAF_HOSTED === "1" || (Boolean(process.env.ISAF_ENVIRONMENT) && process.env.ISAF_ENVIRONMENT !== "development");
if (process.env.ISAF_ENVIRONMENT && process.env.ISAF_ENVIRONMENT !== "development") {
  validateHostedEnvironment(process.env);
}
// Full/Admin editions keep readable engine source and must use it so local
// development fixes cannot be shadowed by an older customer-delivery bundle.
// Source-free Customer/Demo editions continue to use the pre-built bundle.
const BUILD_BUNDLE = path.resolve(__dirname, "../03_Build_Engine/build.bundle.js");
const BUILD_SRC    = path.resolve(__dirname, "../03_Build_Engine/src/build.js");
const BUILD_SCRIPT = appEdition() === "full" && fs.existsSync(BUILD_SRC)
  ? BUILD_SRC
  : (fs.existsSync(BUILD_BUNDLE) ? BUILD_BUNDLE : BUILD_SRC);
console.log(`Build engine: ${path.basename(path.dirname(BUILD_SCRIPT))}/${path.basename(BUILD_SCRIPT)}`);
function editionManifest(){
  try{return JSON.parse(fs.readFileSync(path.resolve(__dirname,"..","EDITION.json"),"utf8"));}
  catch{return {edition:"full"};}
}
function appEdition(){return editionManifest().edition||"full";}
function demoFilenamePart(value,fallback){return String(value||"").trim().replace(/[^A-Za-z0-9._-]+/g,"_").replace(/^[._-]+|[._-]+$/g,"").slice(0,48).replace(/[._-]+$/g,"")||fallback;}
const UPLOAD_DIR = path.resolve(__dirname, "uploads");
const OUTPUT_DIR = path.resolve(__dirname, "output");
const TEMPLATES_DIR = process.env.ISAF_TEMPLATES || path.resolve(__dirname, "../06_Templates");
const BUILD_DOWNLOAD_TTL_MS = Math.max(60_000, Number.parseInt(process.env.ISAF_DOWNLOAD_TTL_MS || "3600000", 10) || 3_600_000);
const buildDownloads = new Map();

if (AUTH_MODE === "api-key" && !API_KEY && !API_KEY_HASH && !ACCESS_KEYS.length) {
  console.warn("WARNING: ISAF_API_KEY not set — authentication disabled (dev mode)");
}

// Ensure working directories exist
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Express setup
// ---------------------------------------------------------------------------
const app = express();

// File upload: accept .xlsx up to 10 MB
const upload = multer({
  dest: UPLOAD_DIR,
  // fieldSize: multer's default is 1 MB, which a build carrying imported requirements exceeds at
  // about 2,000 requirements and fails with "Field value too long". 10 MB matches the JSON body
  // limit above and the requirements link cap, so a review that can be saved can always be sent.
  limits: { fileSize: 10 * 1024 * 1024, fieldSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const accepted=file.fieldname==="workbook"
      ? [".xlsx",".xlsm"].includes(ext)
      : file.fieldname==="previous" ? ext===".docx"
      : file.fieldname==="logo"&&[".svg",".png",".jpg",".jpeg"].includes(ext);
    if (accepted) {
      cb(null, true);
    } else {
      cb(new Error(file.fieldname==="logo"?"Only SVG, PNG, and JPEG logo files are accepted.":file.fieldname==="previous"?"Only Word documents (.docx) can be reused.":"Only .xlsx and .xlsm workbook files are accepted."));
    }
  },
});

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Static files (upload page)
// Admin-only help pages are part of the signed-in Admin app: when sign-in is enforced (v6.0.0) they need a session.
const ADMIN_ONLY_HELP = new Set(["/help/document-architecture.html", "/help/release-notes.html", "/help/new-customer-setup.html", "/help/usage-tracking-setup.html", "/help/customer-apps-guide.html"]);
app.use((req, res, next) => {
  if (!ADMIN_ONLY_HELP.has(req.path) || !accountsRequired()) return next();
  const account = accountStore.session(sessionToken(req));
  if (account && account.role !== "user") return next();
  res.redirect(302, "/");
});
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "10mb" }));
const repository = await createRepositoryProviderAsync({
  root: process.env.ISAF_REPOSITORY_DIR || path.join(__dirname,"repository"),
  demoEdition: appEdition() === "demo",
});
// Access log (owner request): opening a key-protected app and wrong-key attempts are written to the server log
// (Render: Logs). Lines start with "[ISAF access]". Wrong-key lines are limited to one per address per minute.
function accessClient(req){const ip=String(req.headers["x-forwarded-for"]||req.ip||req.socket?.remoteAddress||"").split(",")[0].trim()||"unknown";const ua=String(req.headers["user-agent"]||"").replace(/\s+/g," ").slice(0,120);return {ip,ua};}
function accessLog(event,req){const {ip,ua}=accessClient(req),m=editionManifest();console.log(`[ISAF access] ${new Date().toISOString().replace("T"," ").slice(0,19)} UTC | ${event} | app: ${m.customer_name||m.edition||"ISAF"} v${m.version||""}${req?.auth?.user?.name?` | user: ${req.auth.user.name}`:""} | address: ${ip} | browser: ${ua}`);}
// Usage records of a Customer app: who used it, when, and for which program (usage.js).
// A hosted app given a persistent data folder (ISAF_DATA_DIR) keeps its usage ledger there instead of a temporary folder.
const DATA_DIR_SET=Boolean(process.env.ISAF_DATA_DIR||process.env.ISAF_ADMIN_DATA_DIR);
const usageRecorder=createUsageRecorder({serviceDir:__dirname,hosted:HOSTED_SERVICE,manifest:editionManifest(),version:editionManifest().version||"",dir:HOSTED_SERVICE&&DATA_DIR_SET&&!process.env.ISAF_USAGE_DIR?path.join(customerDataDir(),"usage"):undefined});
const recordBuildUsage=(req,result,phase)=>{try{usageRecorder.record("build",req.auth,{program:result?.program,phases:[String(phase||"all")],documents:result?.docCount,failures:result?.failCount});}catch(error){console.warn("Usage record failed:",error.message);}};
// App updates of a Customer app (updates.js): the app asks the MX Aero update service whether a newer ISAF
// version is offered, each user accepts, postpones or skips it, and a critical update stops builds once its
// grace period has passed.
const updateClient=createUpdateClient({serviceDir:__dirname,hosted:HOSTED_SERVICE,manifest:editionManifest(),version:editionManifest().version||""});
if(updateClient.enabled){
  updateClient.check().catch(()=>{});
  setInterval(()=>{updateClient.check().catch(()=>{});},60*60*1000).unref?.();
}
// Builds (and writing imported requirements into documents) stop when a critical update is past its deadline.
const requireUpToDate=(req,res,next)=>{const message=updateClient.buildBlockedMessage();if(message)return res.status(426).json({error:message,updateRequired:true});next();};
const rejectedKeyLog=new Map();
function logRejectedKey(req){const {ip}=accessClient(req),now=Date.now();if(now-(rejectedKeyLog.get(ip)||0)<60000)return;rejectedKeyLog.set(ip,now);if(rejectedKeyLog.size>500)rejectedKeyLog.clear();accessLog("Wrong access key entered",req);}
// Admin app user accounts (v6.0.0). Kept beside the customer register (ISAF_ADMIN_DATA_DIR on a hosted Admin's
// persistent disk). Sign-in is enforced once an account exists, and from the start on a hosted Admin.
// Customer app accounts (owner, 22 November 2026): a customer-specific app with MX Aero's seat public key and a
// license ID. The first account (the Customer Admin) needs an Admin seat code; active accounts are limited to the
// seats of the codes entered; one session per login. Sign-in is enforced once the first account exists, and then
// people sign in instead of using personal access keys. A hosted Customer app uses accounts only when it has a
// persistent data folder (ISAF_DATA_DIR), so accounts are not lost when the host restarts; until then it keeps the
// personal access keys. Account changes go into the usage records (MX Aero sees seat use).
const CUSTOMER_ACCOUNTS = appEdition() === "customer" && AUTH_MODE === "api-key" && /^[A-Za-z0-9+/=]{40,}$/.test(String(editionManifest().seat_public_key || "")) && Boolean(String(editionManifest().license_id || "").trim()) && (!HOSTED_SERVICE || DATA_DIR_SET);
const ACCOUNT_USAGE_EVENTS = new Set(["admin-created", "account-created", "account-disabled", "account-enabled", "role-changed", "seats-added"]);
const accountStore = createAccountStore({file: path.join(customerDataDir(), "ISAF_Accounts.json"), eventsFile: path.join(customerDataDir(), "ISAF_Account_Events.jsonl"),
  ...(CUSTOMER_ACCOUNTS ? {
    seats: {publicKey: String(editionManifest().seat_public_key), licenseId: String(editionManifest().license_id).trim()}, singleSession: true,
    onEvent: (event, d) => { if (ACCOUNT_USAGE_EVENTS.has(event)) usageRecorder.record(event, {user: {id: "account:" + (d.by || ""), name: d.by || ""}}, {account: {username: d.username, name: d.name, role: d.role}, seats: {total: d.total, used: d.used, added: d.seats}}); },
  } : {})});
const accountsEnabled = () => (appEdition() === "full" && AUTH_MODE === "api-key") || CUSTOMER_ACCOUNTS;
const accountsRequired = () => accountsEnabled() && ((appEdition() === "full" && HOSTED_SERVICE) || accountStore.hasAccounts());
const ACCOUNT_SETUP_CODE = String(process.env.ISAF_SETUP_CODE || crypto.randomBytes(4).toString("hex").toUpperCase().replace(/^(.{4})/, "$1-"));
const authentication = createAuthentication({
  accounts: accountsEnabled() ? accountStore : null,
  accountsRequired,
  // A User account works on programs only (owner, 21 November 2026): no customers, publishing, app updates, usage
  // administration, demos or the Administration tab.
  // In a Customer app a User does not download the usage report either (the Administration tab is the Admin's).
  accountAdminOnly: req => /^\/api\/(admin\/|create-demo|publish-demo|demo-register|usage\/report)/.test(String(req.originalUrl || req.url || "")),
  personalKeysAllowed: () => !(CUSTOMER_ACCOUNTS && accountStore.hasAccounts()),
  mode: AUTH_MODE,
  apiKey: API_KEY,
  apiKeyHash: API_KEY_HASH,
  accessKeys: ACCESS_KEYS,
  onKeyRejected: logRejectedKey,
  metadata: repository.metadata,
  auditStore: createAuthorizationAudit(repository, {
    filename: path.join(process.env.ISAF_REPOSITORY_DIR || path.join(__dirname,"repository"), "authorization-audit.jsonl"),
  }),
});
const requireAuth = authentication.requireAuth;
const authorize = authentication.authorize;
app.use("/api/account", accountRoutes({store: accountStore, enabled: accountsEnabled, required: accountsRequired, setupCode: ACCOUNT_SETUP_CODE}));
if (CUSTOMER_ACCOUNTS && !accountStore.hasAccounts()) console.log("ISAF accounts: no account yet. Create the Admin account in the app with an Admin seat code from MX Aero.");
else if (accountsEnabled() && !accountStore.hasAccounts()) console.log(`ISAF accounts: no account yet. Create the Owner account in the app${HOSTED_SERVICE ? ` with setup code ${ACCOUNT_SETUP_CODE}` : " (on this computer no setup code is needed; from another computer use setup code " + ACCOUNT_SETUP_CODE + ")"}.`);
const buildJobs = createBuildJobStore(repository, {
  root: path.join(process.env.ISAF_REPOSITORY_DIR || path.join(__dirname,"repository"), "build-jobs"),
  organizationId: process.env.ISAF_ORGANIZATION_ID,
});
const connectors=createConnectorService({root:process.env.ISAF_REPOSITORY_DIR||path.join(__dirname,"repository")});
const operations=createOperationsCenter({root:process.env.ISAF_REPOSITORY_DIR||path.join(__dirname,"repository"),environment:process.env,version:"6.0.3",edition:appEdition(),metadata:repository.metadata,organizationId:process.env.ISAF_ORGANIZATION_ID});

app.get("/api/session",requireAuth,(req,res)=>res.json({
  edition:appEdition(), version:"6.0.3", authentication:authentication.mode,
  user:{id:req.auth.id||null,subject:req.auth.subject,displayName:req.auth.displayName,email:req.auth.email||null,role:req.auth.role},
  organizationId:req.auth.organizationId||process.env.ISAF_ORGANIZATION_ID||null,
  capabilities:{teamAdministration:authentication.mode==="oidc"&&hasPermission(req.auth.role,"organization.manage"),durableBuilds:!!repository?.metadata?.withTenant,integrationAdministration:hasPermission(req.auth.role,"integration.manage"),hosted:HOSTED_SERVICE},
}));

app.get("/api/admin/members",requireAuth,authorize("organization.manage"),async(req,res)=>{try{res.json(await authentication.memberships.list(req.auth.organizationId));}catch(error){res.status(error.status||500).json({error:error.message});}});
app.put("/api/admin/members",requireAuth,authorize("organization.manage"),async(req,res)=>{try{res.json(await authentication.memberships.save(req.auth.organizationId,req.body));}catch(error){res.status(error.status||500).json({error:error.message});}});
app.delete("/api/admin/members/:id",requireAuth,authorize("organization.manage"),async(req,res)=>{try{res.json(await authentication.memberships.deactivate(req.auth.organizationId,req.params.id));}catch(error){res.status(error.status||500).json({error:error.message});}});

app.get("/api/admin/readiness",requireAuth,authorize("operations.view"),async(req,res)=>{
  res.json({...await operations.snapshot({authenticationMode:authentication.mode,cloud:!!repository?.metadata?.withTenant,integrations:connectors.definitions()}),procedures:{deployment:"00_Docs/CUSTOMER_HOSTED_DEPLOYMENT.md",connectors:"00_Docs/ENTERPRISE_CONNECTOR_GUIDE.md"}});
});
app.get("/api/admin/activation-evidence",requireAuth,authorize("operations.view"),async(req,res)=>{const evidence=await operations.evidence({authenticationMode:authentication.mode,cloud:!!repository?.metadata?.withTenant,integrations:connectors.definitions()});res.attachment(`ISAF_Activation_Evidence_${evidence.generatedAt.slice(0,10)}.json`).type("application/json").send(`${JSON.stringify(evidence,null,2)}\n`);});

// Requirements tool connections (tool_connections.js, jama.js, polarion.js): a real read-only import from
// Jama Connect and Siemens Polarion, as opposed to the generic connector contract below. Connections are kept
// outside the app folder so they survive an app update, the secret is never sent back to a browser, and a
// server can supply them through environment variables instead (hosted sites should, their disk being
// temporary). Setting one up needs integration.manage; importing needs build.run, the same as a build.
const toolStore=createConnectionStore(path.join(customerDataDir(),"ISAF_Tool_Connections.json"));
const toolFail=(res,error)=>res.status(error.status||502).json({error:error.message});
// An Admin app offers every tool; a Customer app offers only the ones licensed for that customer
// (EDITION.json tools, written by Create/Publish). An unlicensed tool is not shown and not reachable.
// "files" is the ReqIF, Excel and CSV import; the others are live tool connections. All of them are licensed
// per customer (Customers tab), so a Customer app offers only what its license names.
const IMPORT_CAPABILITIES=REQUIREMENTS_IMPORT.filter(o=>o.available).map(o=>o.id);
const licensedTools=()=>{
  if(appEdition()!=="customer")return IMPORT_CAPABILITIES;
  const manifest=editionManifest();
  return Array.isArray(manifest.tools)?manifest.tools.map(String).filter(t=>IMPORT_CAPABILITIES.includes(t)):[];
};
// A DOORS customer is licensed for the file import through "DOORS ReqIF"; either file entry switches it on.
const fileImportLicensed=()=>licensedTools().some(t=>FILE_IMPORT_IDS.includes(t));
const requireFileImport=(req,res,next)=>fileImportLicensed()?next():res.status(403).json({error:"Importing requirements from a file is not part of this ISAF license. MX Aero can add it."});
const toolAllowed=(res,tool)=>{
  if(licensedTools().includes(String(tool)))return true;
  res.status(403).json({error:`${TOOLS[tool]?.label||"That tool"} is not part of this ISAF license. Requirements can still be imported as ReqIF, Excel or CSV files, and MX Aero can add the connection to your license.`});
  return false;
};
const toolClient=req=>{
  const connection=toolStore.get(String(req.params.id||""));
  if(!licensedTools().includes(String(connection.tool)))throw Object.assign(new Error(`${TOOLS[connection.tool]?.label||"That tool"} is not part of this ISAF license.`),{status:403});
  return toolStore.client(String(req.params.id||""),{log:console.log});
};
app.get("/api/tools",requireAuth,authorize("build.run"),(req,res)=>{
  const allowed=licensedTools().filter(t=>Object.keys(TOOLS).includes(t));
  res.json({tools:toolStore.tools().filter(t=>allowed.includes(t.id)),connections:toolStore.list(req.query.tool?String(req.query.tool):"").filter(c=>allowed.includes(c.tool)),file:toolStore.file,licensed:allowed});
});
app.put("/api/tools/connections",requireAuth,authorize("integration.manage"),express.json(),(req,res)=>{
  if(!toolAllowed(res,String(req.body?.tool||"")))return;
  try{res.json(toolStore.save(req.body||{}));}catch(error){toolFail(res,error);}
});
app.delete("/api/tools/connections/:id",requireAuth,authorize("integration.manage"),(req,res)=>{try{res.json(toolStore.remove(req.params.id));}catch(error){toolFail(res,error);}});
app.post("/api/tools/connections/:id/test",requireAuth,authorize("integration.manage"),async(req,res)=>{
  try{const result=await toolClient(req).testConnection();res.json(toolStore.recordTest(req.params.id,result));}
  catch(error){console.warn(`[ISAF tools] connection test failed: ${error.message}`);toolFail(res,error);}
});
app.get("/api/tools/connections/:id/projects",requireAuth,authorize("build.run"),async(req,res)=>{
  try{res.json({projects:await toolClient(req).projects()});}catch(error){toolFail(res,error);}
});
app.get("/api/tools/connections/:id/itemtypes",requireAuth,authorize("build.run"),async(req,res)=>{
  try{res.json({itemTypes:await toolClient(req).itemTypes(req.query.project)});}catch(error){toolFail(res,error);}
});
// Read the chosen item or work item types as import sources shaped like inspected requirements files, so the
// Import tab reviews them exactly as it reviews a ReqIF or Excel file. Read-only: nothing is written back.
app.post("/api/tools/connections/:id/pull",requireAuth,authorize("build.run"),express.json(),async(req,res)=>{
  try{
    const result=await toolClient(req).pull({
      project:req.body?.project,
      itemTypes:Array.isArray(req.body?.itemTypes)?req.body.itemTypes:[],
      query:String(req.body?.query||""),
      max:Math.min(Number(req.body?.max)||DEFAULT_MAX_ITEMS,DEFAULT_MAX_ITEMS),
    });
    res.json(result);
  }catch(error){toolFail(res,error);}
});
app.get("/api/integrations/profiles",requireAuth,authorize("integration.manage"),(_req,res)=>res.json(connectors.profiles()));
app.get("/api/integrations",requireAuth,authorize("integration.manage"),(_req,res)=>res.json(connectors.definitions()));
app.put("/api/integrations/:id",requireAuth,authorize("integration.manage"),(req,res)=>{try{res.json(connectors.saveDefinition({...req.body,id:req.params.id}));}catch(error){res.status(error.status||500).json({error:error.message});}});
app.delete("/api/integrations/:id",requireAuth,authorize("integration.manage"),(req,res)=>{try{res.json(connectors.deleteDefinition(req.params.id));}catch(error){res.status(error.status||500).json({error:error.message});}});
app.post("/api/integrations/:id/test",requireAuth,authorize("integration.manage"),async(req,res)=>{try{res.json(await connectors.test(req.params.id));}catch(error){res.status(error.status||500).json({error:error.message});}});
app.post("/api/integrations/:id/discover",requireAuth,authorize("integration.manage"),async(req,res)=>{try{res.json(await connectors.discover(req.params.id));}catch(error){res.status(error.status||500).json({error:error.message});}});
app.get("/api/integrations/:id/links",requireAuth,authorize("integration.manage"),(req,res)=>res.json(connectors.links().filter(item=>item.integrationId===req.params.id)));
app.post("/api/integrations/:id/preview",requireAuth,authorize("integration.manage"),(req,res)=>{try{res.json(connectors.preview(req.params.id,req.body.local||{},req.body.operation||{}));}catch(error){res.status(error.status||500).json({error:error.message});}});
app.post("/api/integrations/:id/transfer",requireAuth,authorize("integration.manage"),async(req,res)=>{try{res.json(await connectors.transfer(req.params.id,req.body.local||{},req.body.operation||{}));}catch(error){res.status(error.status||500).json({error:error.message});}});

function registerBuildDownload(result, identity = {}) {
  const directory = path.resolve(String(result.outputDir || ""));
  if (!result.buildId || !fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw Object.assign(new Error("The build completed, but its download folder is unavailable."), { status: 500 });
  }
  const id = crypto.randomUUID();
  const phase = demoFilenamePart(String(result.phase || "build").toUpperCase(), "Build");
  const filename = `ISAF_${phase}_${String(result.buildId).slice(0, 8)}.zip`;
  const record = { directory, filename, expiresAt: Date.now() + BUILD_DOWNLOAD_TTL_MS, organizationId: identity.organizationId || null };
  buildDownloads.set(id, record);
  const timer = setTimeout(() => {
    if (buildDownloads.get(id) === record) buildDownloads.delete(id);
  }, BUILD_DOWNLOAD_TTL_MS);
  timer.unref?.();
  return { ...result, downloadId: id, downloadUrl: `/api/download?id=${encodeURIComponent(id)}`, downloadFilename: filename };
}

// Stream a completed build folder as a ZIP. The random ID avoids exposing a
// server path, and the normal API-key middleware protects hosted deployments.
// Downloads live in this server's memory and temporary folder: they expire after BUILD_DOWNLOAD_TTL_MS and are
// lost when the service restarts (a hosted site restarts after an update, and on some plans after a period
// without use).
const DOWNLOAD_GONE = "This build download is no longer available. Finished builds are kept for up to 60 minutes and are cleared when the web app restarts (after an update, or after a period without use). Run the build again and download the ZIP when it finishes.";
// Stream one completed build folder, or several (?ids=a,b,c: one ZIP with a folder per phase), as a ZIP. The
// random IDs avoid exposing a server path, and the normal API-key middleware protects hosted deployments.
app.get("/api/download", requireAuth, authorize("repository.read"), (req, res) => {
  const ids = String(req.query.ids || req.query.id || "").split(",").map(x => x.trim()).filter(Boolean).slice(0, 20);
  if (!ids.length) return res.status(404).json({ error: DOWNLOAD_GONE });
  const records = [];
  for (const id of ids) {
    const record = buildDownloads.get(id);
    if (!record) return res.status(404).json({ error: DOWNLOAD_GONE });
    if (record.expiresAt <= Date.now()) { buildDownloads.delete(id); return res.status(410).json({ error: DOWNLOAD_GONE }); }
    if (record.organizationId && record.organizationId !== req.auth?.organizationId) return res.status(403).json({error: "This build belongs to another organization."});
    if (!fs.existsSync(record.directory) || !fs.statSync(record.directory).isDirectory()) { buildDownloads.delete(id); return res.status(404).json({ error: DOWNLOAD_GONE }); }
    records.push(record);
  }
  const several = records.length > 1;
  res.attachment(several ? `ISAF_All_Phases_${new Date().toISOString().slice(0, 10)}.zip` : records[0].filename);
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("warning", error => console.warn("Build ZIP warning:", error.message));
  archive.on("error", error => {
    console.error("Build ZIP failed:", error);
    if (!res.headersSent) res.status(500).json({ error: "The build ZIP could not be prepared." });
    else res.destroy(error);
  });
  res.on("close", () => { if (!res.writableEnded) archive.abort(); });
  archive.pipe(res);
  for (const record of records) archive.directory(record.directory, several ? record.filename.replace(/\.zip$/i, "") : false);
  archive.finalize();
});

// Durable builds are submitted here and processed by the separate `npm run worker` process.
app.post("/api/jobs", requireAuth, authorize("build.run"), requireUpToDate, upload.single("workbook"), async (req,res)=>{
  if(!req.file)return res.status(400).json({error:"Choose a workbook."});
  try{
    const programId=String(req.body.programId||"").trim();
    if(!programId)return res.status(400).json({error:"Select a repository program before submitting a durable build."});
    const unlicensed=phaseNotLicensed(req.body.phase);if(unlicensed)return res.status(403).json({error:unlicensed});
    if(hostedTrial())return res.status(403).json({error:TRIAL_NO_DOCUMENT_CONTROL});
    await enforceLicensedWorkbook(req.file.path);
    const job=await buildJobs.submit({
      organizationId:req.auth.organizationId||null,programId,requestedBy:req.auth.id||null,
      actor:requestActor(req,req.body.actor),phase:String(req.body.phase||"all").toLowerCase(),
      engineVersion:"6.0.3",filename:req.file.originalname,
      // The imported requirements are resolved here rather than in the worker: a Postgres-backed
      // repository has no program folder to read a link from, and the job must build with the
      // requirements as they were when it was submitted. They are part of the idempotency key
      // (build_jobs.submit digests options), so changing the requirements queues a new build
      // instead of handing back the package of one that was built without them.
      options:{mode:req.body.mode||"normal",acknowledge:req.body.acknowledge===true||req.body.acknowledge==="true",timeZone:req.body.timeZone||"",requirements:requirementsForBuild({store:repository,programId,supplied:suppliedRequirements(req.body?.requirements)})},
    },fs.readFileSync(req.file.path));
    res.status(job.reused?200:202).json(job);
  }catch(error){res.status(error.status||500).json({error:error.message||"The durable build could not be submitted."});}
  finally{fs.rm(req.file.path,{force:true},()=>{});}
});
app.get("/api/jobs",requireAuth,authorize("repository.read"),async(_req,res)=>res.json(await buildJobs.list()));
app.get("/api/jobs/:jobId",requireAuth,authorize("repository.read"),async(req,res)=>{const job=await buildJobs.read(req.params.jobId);if(!job?.id)return res.status(404).json({error:"Build job not found."});res.json(job);});
app.post("/api/jobs/:jobId/retry",requireAuth,authorize("build.run"),requireUpToDate,async(req,res)=>{try{res.status(202).json(await buildJobs.retry(req.params.jobId));}catch(error){res.status(409).json({error:error.message});}});
app.get("/api/jobs/:jobId/package",requireAuth,authorize("repository.read"),async(req,res)=>{
  const job=await buildJobs.read(req.params.jobId);if(!job?.id)return res.status(404).json({error:"Build job not found."});
  if(job.status!=="succeeded"||!job.result?.package?.hash)return res.status(409).json({error:"The build package is not available yet."});
  res.attachment(`ISAF_${String(job.phase||"Build").toUpperCase()}_${job.id.slice(0,8)}.zip`);res.type("application/zip").send(await buildJobs.objectStore.get(job.result.package.hash));
});

const TRIAL_NO_DOCUMENT_CONTROL="Document Control is not available in the hosted trial: no documents are kept on this server. Download each build. Install ISAF on your company network to keep controlled documents.";
app.use("/api/repository",(req,res,next)=>hostedTrial()?res.status(403).json({error:TRIAL_NO_DOCUMENT_CONTROL}):next());
app.use("/api/repository",repositoryRoutes(repository,requireAuth,{
 authorize,
 includeSourceWorkbook:appEdition()!=="demo",
 async demo(demoPath){const base=path.resolve(__dirname,'../04_Demos');if(typeof demoPath!=='string')throw Object.assign(Error('Load a workbook first.'),{status:400});const file=path.resolve(__dirname,'..',demoPath);if(!file.startsWith(base+path.sep)||!/\.xlsx$/i.test(file))throw Object.assign(Error('Invalid demo workbook.'),{status:400});return {bytes:fs.readFileSync(file),filename:path.basename(file)};},
 async parse(bytes){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'isaf-config-'));try{const file=path.join(folder,'config.xlsx');fs.writeFileSync(file,bytes);const parsed=await execFileAsync(process.execPath,[PARSE_SCRIPT,file],{maxBuffer:10*1024*1024});return JSON.parse(parsed.stdout);}finally{fs.rmSync(folder,{recursive:true,force:true});}}
}));

// List available demo workbooks
app.get("/api/demos", requireAuth, authorize("repository.read"), (_req, res) => {
  const demosDir = path.resolve(__dirname, "../04_Demos");
  const demos = [];
  try {
    const profile=appEdition()==="demo"?demoProfile():null;
    if(profile?.generic){
      for(const sample of profile.samples||[]){
        const fullPath=path.resolve(__dirname,"..",sample.sampleWorkbook);
        if(!fullPath.startsWith(demosDir+path.sep)||!fs.existsSync(fullPath))continue;
        demos.push({
          name:sample.sampleLabel,
          file:path.basename(fullPath),
          path:sample.sampleWorkbook,
          programType:sample.programType,
          phases:Object.values(profile.previewMatrix||{}).filter(entry=>entry.programType===sample.programType).map(entry=>entry.phaseId),
        });
      }
      return res.json(demos);
    }
    for (const dir of fs.readdirSync(demosDir)) {
      const inputsDir = path.join(demosDir, dir, "inputs");
      if (fs.existsSync(inputsDir)) {
        for (const file of fs.readdirSync(inputsDir)) {
          if (file.endsWith(".xlsx") || file.endsWith(".xlsm")) {
            demos.push({
              name: dir === "Starter" ? `${editionManifest().customer_name || "Company"} starter configuration` : dir.replace(/_/g, " "),
              variant: /do-?160/i.test(file) ? "with DO-160" : "",
              file: file,
              path: `04_Demos/${dir}/inputs/${file}`,
            });
          }
        }
      }
    }
  } catch { /* no demos dir */ }
  res.json(demos);
});

// Persistent user settings (saved to disk)
const SETTINGS_PATH = path.resolve(__dirname, "user_settings.json");
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")); }
  catch { return {}; }
}
function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// Draft numbering scheme only: does not allocate numbers or modify workbook data.
app.get('/api/document-pns', requireAuth, authorize('repository.read'), (req,res)=>{
 res.json({settings:loadSettings().documentPNs||null});
});
app.put('/api/document-pns', requireAuth, authorize('settings.manage'), express.json({limit:'16kb'}), (req,res)=>{
 const {settings,errors}=validateDocumentPNs(req.body);
 if(errors.length)return res.status(400).json({errors});
 try{const existing=loadSettings();existing.documentPNs=settings;saveSettings(existing);res.json({settings});}
 catch(e){res.status(500).json({error:'Could not save document numbering settings.'});}
});

// Default output base: ~/Documents/ISAF_Output/
function defaultOutputBase() {
  const settings = loadSettings();
  if (settings.outputBase) return settings.outputBase;
  const docs = path.join(os.homedir(), "Documents");
  return fs.existsSync(docs) ? path.join(docs, "ISAF_Output") : path.join(os.homedir(), "ISAF_Output");
}

// Map UI phase IDs → engine --milestone keys
const PHASE_TO_MILESTONE = {
  "codr": "CoDR",
  "srr":  "SRR",
  "pdr":  "PDR",
  "soi1": "SOI-1",
  "cdr":  "CDR",
  "soi2": "SOI-2",
  "soi3": "SOI-3",
  "trr":  "TRR",
  "soi4": "SOI-4",
  "tia":  "TIA",
  "all":  null,   // no --milestone flag = full build
};
function demoProfile(){
  const manifest=editionManifest();
  if(manifest.demo_generic===true||manifest.demo_profile?.generic===true)return {...(manifest.demo_profile||{}),generic:true,previewMatrix:manifest.demo_preview_matrix||manifest.demo_profile?.previewMatrix||{}};
  const milestone=manifest.demo_milestone||manifest.demo_profile?.milestone||"SOI-1";
  const phaseId=Object.entries(PHASE_TO_MILESTONE).find(([,key])=>key===milestone)?.[0]||"soi1";
  return {...(manifest.demo_profile||{}),generic:false,milestone,phaseId};
}
function demoSampleProfile(demoPath){
  const profile=demoProfile();
  if(!profile.generic)return profile.sampleWorkbook===demoPath?profile:null;
  return (profile.samples||[]).find(sample=>sample.sampleWorkbook===demoPath)||null;
}
function demoPreviewProfile(programType,phaseId){
  const profile=demoProfile();
  if(!profile.generic)return phaseId===profile.phaseId?profile:null;
  return profile.previewMatrix?.[`${programType}:${phaseId}`]||null;
}
// Customer-specific apps: phases outside the licensed set are refused (EDITION.json licensed_phases).
function licensedPhases(){const list=editionManifest().licensed_phases;return Array.isArray(list)?list.map(p=>String(p).toLowerCase()):[];}
// Licensed program types (EDITION.json licensed_program_types: AIRCRAFT, SYSTEM, LRU). Empty = no restriction.
function licensedProgramTypesFromEdition(){const list=editionManifest().licensed_program_types;return appEdition()==="customer"&&Array.isArray(list)?list.map(t=>String(t).toUpperCase()):[];}
function phaseNotLicensed(phaseId){const list=licensedPhases();if(appEdition()!=="customer"||!list.length)return "";const id=String(phaseId||"all").toLowerCase();const label=p=>({codr:"CoDR",srr:"SRR",pdr:"PDR",soi1:"SOI 1",cdr:"CDR",soi2:"SOI 2",soi3:"SOI 3",trr:"TRR",soi4:"SOI 4",tia:"TIA"}[p]||p.toUpperCase());return list.includes(id)?"":`The ${id==="all"?"full (All phases)":label(id)} build is not licensed. Licensed phases: ${list.map(label).join(", ")}.`;}
// Customer-specific apps: values set in the Admin Customers tab (EDITION.json licensed_values) are
// re-applied to every workbook the app reads, builds or saves, so editing the Excel file cannot change them.
function licensedValues(){const v=editionManifest().licensed_values;return appEdition()==="customer"&&v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).length?v:null;}
async function enforceLicensedWorkbook(file){
  const values=licensedValues();if(!values)return file;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"isaf-licensed-"));
  try{
    const source=path.join(dir,"source.xlsx");fs.copyFileSync(file,source); // uploads have no extension; openpyxl needs .xlsx
    const job=execFileAsync(PYTHON_COMMAND,[SAVE_SCRIPT],{timeout:60000,maxBuffer:10*1024*1024});
    job.child.stdin.on("error",()=>{});job.child.stdin.end(JSON.stringify({source,modifications:values,output_dir:dir,output_name:"licensed.xlsx",exact_name:true}));
    const result=JSON.parse((await job).stdout||"{}");if(result.error||!result.output)throw new Error("Licensed values could not be applied: "+(result.error||"no output"));
    fs.copyFileSync(result.output,file);return file;
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
// Hosted trial (customer-specific app hosted by MX Aero, EDITION.json hosted_trial): no customer data is
// kept on the server. Document Control is off; each build uses a temporary register that is deleted after
// the build, and its ZIP is deleted when the download expires. Paying customers install ISAF on their network.
function hostedTrial(){return appEdition()==="customer"&&editionManifest().hosted_trial===true;}
function trialBuildStorage(req){
  if(!hostedTrial())return {store:repository,outputBase:req.body.outputDir||defaultOutputBase(),programId:req.body.programId,actor:requestActor(req,req.body.actor),cleanup:()=>{}};
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"isaf-trial-")),outputBase=path.join(root,"output");fs.mkdirSync(outputBase);
  return {store:new RepositoryStore(path.join(root,"register")),outputBase,programId:"",actor:"Hosted trial user",cleanup:()=>{fs.rmSync(path.join(root,"register"),{recursive:true,force:true});setTimeout(()=>fs.rm(root,{recursive:true,force:true},()=>{}),BUILD_DOWNLOAD_TTL_MS+60000).unref?.();},fail:()=>fs.rmSync(root,{recursive:true,force:true})};
}
// Imported requirements for one build. A hosted trial keeps nothing between sessions, so there the
// browser sends the review it holds; with Document Control the program's own link is used unless
// the request carries one. Multipart requests arrive as text, JSON requests as an object.
function suppliedRequirements(value){
  if(value===undefined||value===null||value==="")return null;
  if(typeof value==="object")return value;
  try{return JSON.parse(String(value));}
  catch{const e=new Error('The imported requirements sent with the build are not valid JSON.');e.status=400;throw e;}
}
function buildRequirements(req,storage){
  return requirementsForBuild({store:storage.store,programId:storage.programId,supplied:suppliedRequirements(req.body?.requirements)});
}
function demoAllowedPhase(phaseId){
  const profile=demoProfile();
  if(!profile.generic)return phaseId===profile.phaseId;
  return Object.values(profile.previewMatrix||{}).some(entry=>entry.phaseId===phaseId);
}
function clientDemoProfile(){
  const profile=demoProfile();
  if(!profile.generic)return profile;
  const previewMatrix=Object.fromEntries(Object.entries(profile.previewMatrix||{}).map(([key,entry])=>[key,{programType:entry.programType,phaseId:entry.phaseId,milestone:entry.milestone}]));
  return {generic:true,user:profile.user,company:profile.company,allowedProgramTypes:profile.allowedProgramTypes||[],samples:(profile.samples||[]).map(({programType,sampleLabel})=>({programType,sampleLabel})),previewMatrix};
}
const DEMO_REGISTER_PATH=path.resolve(__dirname,"..","09-User Demos","ISAF_Demo_Register.xlsx");
const DEMO_REGISTER_SCRIPT=path.resolve(__dirname,"..","scripts","demo_register.py");
const HOSTED_DEMO_CONFIG=path.resolve(__dirname,"..","Hosted_Demo_GitHub_Deploy.json");
const EDITION_PUBLISHER=path.resolve(__dirname,"..","scripts","publish_customer_github.py");
const PYTHON_COMMAND=process.platform==="win32"?"python":"python3";
let demoRegisterQueue=Promise.resolve();
function runDemoRegister(args){
  const task=demoRegisterQueue.then(()=>execFileAsync(PYTHON_COMMAND,[DEMO_REGISTER_SCRIPT,"--register",DEMO_REGISTER_PATH,...args],{cwd:path.resolve(__dirname,".."),timeout:30000,maxBuffer:5*1024*1024}));
  demoRegisterQueue=task.then(()=>undefined,()=>undefined);
  return task;
}

function makeOutputDir(workbookName, phaseId, customBase) {
  const name = workbookName.replace(/\.[^.]+$/, ""); // strip extension
  // Use the engine milestone key for the folder suffix (e.g. CoDR, SOI-1)
  // so each milestone build gets its own folder and never reuses a prior
  // full-build manifest.
  const milestoneKey = PHASE_TO_MILESTONE[phaseId];
  const phase = milestoneKey ? `_${milestoneKey.replace(/-/g, "")}` : "";
  const base = customBase || defaultOutputBase();
  const outDir = path.join(base, `${name}${phase}`);
  fs.mkdirSync(outDir, { recursive: true });
  return outDir;
}

/** Count .docx files recursively in a directory. */
function countDocx(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countDocx(path.join(dir, e.name));
    else if (e.name.endsWith(".docx")) n++;
  }
  return n;
}

// Optional output processing: DEMO watermark (requested, or always in a Customer
// Edition created with watermarking) and PDF copies (local installations only).
const wantFlag=v=>v===true||v==="true"||v==="1"||v==="on";
async function applyOutputOptions(result,req){
  const edition=editionManifest(),forced=edition.watermark_documents===true;
  const watermark=forced||wantFlag(req.body?.watermark);
  const text=watermarkText(forced?edition.watermark_text:req.body?.watermarkText);
  const pdf=wantFlag(req.body?.pdf)&&!HOSTED_SERVICE;
  if(!watermark&&!pdf)return;
  const notes=await postprocessOutput(result.outputDir,{watermark,watermarkText:text,pdf});
  if(notes.length)result.postprocess=notes;
}

// Build from a demo workbook — outputs files to disk
app.post("/api/build-demo", requireAuth, authorize("build.run"), requireUpToDate, async (req,res)=>{
  res=deferBuildResponse(req,res);
  try {
    const demoPath=req.body?.path,base=path.resolve(__dirname,'../04_Demos');
    if(typeof demoPath!=='string')return res.status(400).json({error:'Select a demo workbook.'});
    const phaseId=String(req.body?.phase||"all").toLowerCase();
    const unlicensed=phaseNotLicensed(phaseId);if(unlicensed)return res.status(403).json({error:unlicensed});
    if(appEdition()==="demo"){
      const sample=demoSampleProfile(demoPath);
      if(!sample)return res.status(403).json({error:'This workbook is not included in the Demo preview.'});
      if(!demoPreviewProfile(sample.programType,phaseId))return res.status(403).json({error:`The selected phase is not available for the ${sample.programType} Demo preview.`});
    }
    const fullPath=path.resolve(__dirname,'..',demoPath);
    if(!fullPath.startsWith(base+path.sep)||!fs.existsSync(fullPath))return res.status(400).json({error:'Invalid demo workbook path.'});
    const storage=trialBuildStorage(req);let result;
    try{result = await runRepositoryBuild({store:storage.store,workbookPath:fullPath,phaseId:req.body.phase||'all',outputBase:storage.outputBase,programId:storage.programId,actor:storage.actor,mode:req.body.mode,acknowledge:req.body.acknowledge,buildScript:BUILD_SCRIPT,parseScript:PARSE_SCRIPT,settingsPath:SETTINGS_PATH,phaseMap:PHASE_TO_MILESTONE,includeSourceWorkbook:appEdition()!=="demo",signal:req.buildSignal,allowedProgramTypes:licensedProgramTypesFromEdition(),valueTags:req.body?.valueTags===undefined?undefined:wantFlag(req.body.valueTags),timeZone:req.body?.timeZone||req.query?.timeZone,requirements:buildRequirements(req,storage)});}
    catch(error){storage.fail?.();throw error;}
    storage.cleanup();
    // A hosted trial keeps nothing on the server, so a working folder keeps its own _ISAF_backup copies there.
    if(hostedTrial())result.recordKept=false;
    await applyOutputOptions(result,req);
    recordBuildUsage(req,result,result.phase||req.body?.phase||req.query?.phase);
    res.json(registerBuildDownload(result,req.auth));
  } catch(err){const failure=buildErrorResponse(err);res.status(err.status||failure.status).json(err.status?{error:err.message}:failure.body);}
});

// Parse a demo workbook (no upload needed)
app.post("/api/parse-demo", requireAuth, authorize("intake.write"), express.json(), async (req, res) => {
  const demoPath = req.body?.path;
  if (!demoPath || !demoPath.startsWith("04_Demos/")) {
    return res.status(400).json({ error: "Invalid demo path." });
  }
  if(appEdition()==="demo"&&!demoSampleProfile(demoPath))return res.status(403).json({error:"This workbook is not included in the Demo preview."});
  const fullPath = path.resolve(__dirname, "..", demoPath);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: "Demo workbook not found." });
  }
  try {
    const { stdout } = await execFileAsync("node", [PARSE_SCRIPT, fullPath],
      { timeout: 30_000, maxBuffer: 50 * 1024 * 1024 });
    res.json(JSON.parse(stdout));
  } catch (err) {
    res.status(500).json({ error: "Parse failed.", detail: err.message });
  }
});

// Save modified config to a new .xlsx file
const SAVE_SCRIPT = path.resolve(__dirname, "save_config.py");
const savedConfigDownloads=new Map();
app.get('/api/saved-config/:id',requireAuth,authorize('configuration.write'),(req,res)=>{
 const file=savedConfigDownloads.get(req.params.id);
 if(!file||!fs.existsSync(file))return res.status(404).json({error:'This download is no longer available. Save the workbook again.'});
 // Hosted trial: the saved workbook leaves the server with the download.
 res.download(file,path.basename(file),()=>{if(hostedTrial()||HOSTED_SERVICE){savedConfigDownloads.delete(req.params.id);const dir=path.dirname(file);fs.rm(path.basename(dir).startsWith("isaf-save-")?dir:file,{recursive:true,force:true},()=>{});}});
});

app.post("/api/save-config", requireAuth, authorize("configuration.write"), express.json(), upload.single("workbook"), async (req, res) => {
  const { source } = req.body || {};
  let modifications=req.body?.modifications;
  if(typeof modifications==='string'){try{modifications=JSON.parse(modifications);}catch{return res.status(400).json({error:"Invalid modifications"});}}
  if (!source || !modifications) {
    return res.status(400).json({ error: "Missing source path or modifications." });
  }
  if(licensedValues()&&typeof modifications==="object")modifications={...modifications,...licensedValues()};
  if(modifications._documentPNs){
    const checked=validateDocumentPNs(modifications._documentPNs);
    if(checked.errors.length)return res.status(400).json({error:'Invalid Document PN schema.',errors:checked.errors});
    modifications._documentPNs=checked.settings;
  }

  // Resolve source path (demo workbooks or uploaded files)
  let fullSource = source;
  if(req.file){fullSource=path.join(UPLOAD_DIR,`edit_${Date.now()}_${path.basename(req.file.originalname)}`);fs.renameSync(req.file.path,fullSource);}
  else if (source.startsWith("04_Demos/")) {
    fullSource = path.resolve(__dirname, "..", source);
  }
  if (!fs.existsSync(fullSource)) {
    return res.status(404).json({ error: "Source workbook not found." });
  }

  try {
    // Save As: the user chose the exact file name and folder. Otherwise keep the versioned copy beside the original.
    // saveTarget: the workbook already loaded, saved over in place (Save Configuration Workbook).
    const knownTarget=!HOSTED_SERVICE&&req.body?.saveTarget?configTargetPath(req.body.saveTarget):null;
    if(req.body?.saveTarget&&!knownTarget)return res.status(400).json({error:"ISAF no longer knows where the loaded workbook is. Use File → Save Configuration… to choose where to save it."});
    const saveTarget=knownTarget?{path:knownTarget}:req.body?.saveToken?pendingConfigSaveTargets.get(req.body.saveToken):null;
    if(!knownTarget&&req.body?.saveToken){pendingConfigSaveTargets.delete(req.body.saveToken);if(!saveTarget||saveTarget.expires<Date.now())return res.status(400).json({error:"The Save As selection expired. Select Save Configuration Workbook again."});}
    // Hosted sites: the saved copy goes to a temporary folder and is downloaded by the browser; nothing is kept.
    const destination=saveTarget?path.dirname(saveTarget.path):HOSTED_SERVICE?fs.mkdtempSync(path.join(os.tmpdir(),"isaf-save-")):req.file?req.body.outputDir:path.dirname(path.resolve(fullSource));
    if(!destination||!path.isAbsolute(destination)||!fs.existsSync(destination)||!fs.statSync(destination).isDirectory()) {
      return res.status(400).json({error:saveTarget?'The selected save folder is no longer available.':'Select the original workbook folder before saving.'});
    }
    const input = JSON.stringify({source:fullSource, modifications, output_dir:destination, output_name:saveTarget?path.basename(saveTarget.path):path.basename(req.file?req.file.originalname:fullSource), exact_name:!!saveTarget});
    const saveJob = execFileAsync("python3", [SAVE_SCRIPT], {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    saveJob.child.stdin.on("error",()=>{});
    saveJob.child.stdin.end(input);
    const {stdout}=await saveJob;
    const result = JSON.parse(stdout);
    if (result.error) {
      return res.status(500).json({ error: result.error });
    }
    const downloadId=crypto.randomUUID();savedConfigDownloads.set(downloadId,result.output);
    if(hostedTrial()||HOSTED_SERVICE){if(req.file)fs.rm(fullSource,{force:true},()=>{});setTimeout(()=>{savedConfigDownloads.delete(downloadId);fs.rm(result.output,{force:true},()=>{});},15*60*1000).unref?.();}
    result.downloadId=downloadId;result.filename=path.basename(result.output);
    // The saved workbook is now the loaded one, so the next Save Configuration Workbook writes over it.
    if(!HOSTED_SERVICE&&!hostedTrial())result.target=rememberConfigTarget(result.output);
    console.log(`Config saved: ${result.output} (${result.applied}/${result.total_modifications} fields applied)`);
    res.json(result);
  } catch (err) {
    console.error("Save config failed:", err.message);
    res.status(500).json({ error: "Failed to save config.", detail: [err.stderr, err.stdout].filter(Boolean).join("\n").slice(-12000) || err.message });
  }
});

// Open a folder in the OS file manager
app.post("/api/open-folder", requireAuth, authorize("filesystem.local"), express.json(), (req, res) => {
  const folderPath = req.body?.path;
  if (!folderPath) return res.status(400).json({ error: "No path provided." });

  // Ensure the folder exists
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  const cmd = process.platform === "darwin" ? "open"
            : process.platform === "win32" ? "explorer"
            : "xdg-open";
  execFile(cmd, [folderPath], (err) => {
    if (err) console.warn("Could not open folder:", err.message);
  });
  res.json({ ok: true });
});

// Return the default output base path
app.get("/api/output-default", requireAuth, authorize("filesystem.local"), (_req, res) => {
  res.json({ path: defaultOutputBase() });
});

// Save a new output base path (persists across restarts)
app.post("/api/output-default", requireAuth, authorize("filesystem.local"), express.json(), (req, res) => {
  const newPath = req.body?.path;
  if (!newPath) return res.status(400).json({ error: "No path provided." });
  const settings = loadSettings();
  settings.outputBase = newPath;
  saveSettings(settings);
  console.log(`Output base saved: ${newPath}`);
  res.json({ path: newPath, saved: true });
});

// Native folder picker — opens OS dialog and returns selected path
const pendingConfigSaveTargets=new Map();
function safeWorkbookName(value){
  let name=path.basename(String(value||"Program_Config.xlsx")).replace(/[<>:"/\\|?*\x00-\x1f]/g,"_");
  if(!/\.xlsx$/i.test(name))name+=".xlsx";return name||"Program_Config.xlsx";
}

// Save Configuration Workbook overwrites the workbook that is loaded (owner, 21 November 2026); only File → Save
// Configuration… asks for a new name. On an installed app the server remembers where each workbook the user opened
// or saved through these windows lives, under an id the page keeps, so the next save can write over the same file.
// The ids last while the server runs; after a restart the first save asks where to save once.
const configSaveTargets=new Map();
function rememberConfigTarget(file){
  const resolved=path.resolve(file);
  for(const [id,known] of configSaveTargets)if(known===resolved)return id;
  const id=crypto.randomUUID();configSaveTargets.set(id,resolved);return id;
}
function configTargetPath(id){
  const known=configSaveTargets.get(String(id||""));
  return known&&fs.existsSync(path.dirname(known))&&fs.statSync(path.dirname(known)).isDirectory()?known:null;
}
let lastConfigFolder="";

// Native Open window for a configuration workbook (installed app). A browser's file window does not tell the page
// where the file is, so without this the loaded workbook could not be saved over.
app.get("/api/config-open",requireAuth,authorize("filesystem.local"),(req,res)=>{
  const start=lastConfigFolder&&fs.existsSync(lastConfigFolder)?lastConfigFolder:path.resolve(__dirname,"..");
  let selectedPath=null;
  try{
    if(process.platform==="darwin"){
      const script='on run argv\nset startFolder to POSIX file (item 1 of argv) as alias\nset chosenFile to choose file with prompt "Open configuration workbook:" of type {"xlsx", "xlsm", "org.openxmlformats.spreadsheetml.sheet", "org.openxmlformats.spreadsheetml.sheet.macroenabled"} default location startFolder\nreturn POSIX path of chosenFile\nend run';
      const result=spawnSync("osascript",["-e",script,"--",start],{encoding:"utf8",timeout:300000});
      if(result.status===0&&result.stdout.trim())selectedPath=result.stdout.trim();
      else if(result.status!==0&&!/-128/.test(result.stderr||""))return res.status(500).json({error:(result.stderr||"The Open window could not be shown.").trim()});
    }else if(process.platform==="win32"){
      const quote=value=>String(value).replace(/'/g,"''"),ps=[
        "Add-Type -AssemblyName System.Windows.Forms;",
        "$f = New-Object System.Windows.Forms.OpenFileDialog;",
        "$f.Title = 'Open configuration workbook';",
        "$f.Filter = 'Excel workbook (*.xlsx;*.xlsm)|*.xlsx;*.xlsm';",
        `$f.InitialDirectory = '${quote(start)}';`,
        "if ($f.ShowDialog() -eq 'OK') { $f.FileName }",
      ].join(" ");
      const result=spawnSync("powershell",["-NoProfile","-Command",ps],{encoding:"utf8",timeout:300000});
      if(result.error)throw result.error;
      if(result.status===0&&result.stdout.trim())selectedPath=result.stdout.trim();
    }else{
      const result=spawnSync("zenity",["--file-selection","--file-filter=Excel workbook | *.xlsx *.xlsm",`--filename=${start}${path.sep}`,"--title=Open configuration workbook"],{encoding:"utf8",timeout:300000});
      if(result.error)throw result.error;
      if(result.status===0&&result.stdout.trim())selectedPath=result.stdout.trim();
    }
  }catch(error){return res.status(500).json({error:"The Open window could not be shown: "+error.message});}
  if(!selectedPath)return res.json({cancelled:true});
  selectedPath=path.resolve(selectedPath);
  if(!/\.xls[xm]$/i.test(selectedPath)||!fs.existsSync(selectedPath))return res.status(400).json({error:"Choose an Excel workbook (.xlsx)."});
  lastConfigFolder=path.dirname(selectedPath);
  res.json({target:rememberConfigTarget(selectedPath),filename:path.basename(selectedPath)});
});
app.get("/api/config-open-file",requireAuth,authorize("filesystem.local"),(req,res)=>{
  const file=configTargetPath(req.query.target);
  if(!file||!fs.existsSync(file))return res.status(404).json({error:"The workbook is no longer at the place it was opened from."});
  res.sendFile(file,{headers:{"Cache-Control":"no-store"}});
});

// Native workbook Save As picker. It starts in the folder of the running ISAF package,
// so a newly extracted release does not inherit an older browser download directory.
app.get("/api/config-save-as",requireAuth,authorize("filesystem.local"),(req,res)=>{
  const suggested=safeWorkbookName(req.query.name),packageRoot=path.resolve(__dirname,"..");
  let selectedPath=null;
  try{
    if(process.platform==="darwin"){
      const script='on run argv\nset startFolder to POSIX file (item 1 of argv) as alias\nset chosenFile to choose file name with prompt "Save configuration workbook as:" default location startFolder default name (item 2 of argv)\nreturn POSIX path of chosenFile\nend run';
      const result=spawnSync("osascript",["-e",script,"--",packageRoot,suggested],{encoding:"utf8",timeout:60000});
      if(result.status===0&&result.stdout.trim())selectedPath=result.stdout.trim();
    }else if(process.platform==="win32"){
      const quote=value=>String(value).replace(/'/g,"''"),ps=[
        "Add-Type -AssemblyName System.Windows.Forms;",
        "$f = New-Object System.Windows.Forms.SaveFileDialog;",
        "$f.Title = 'Save configuration workbook as';",
        "$f.Filter = 'Excel workbook (*.xlsx)|*.xlsx';",
        `$f.InitialDirectory = '${quote(packageRoot)}';`,
        `$f.FileName = '${quote(suggested)}';`,
        "if ($f.ShowDialog() -eq 'OK') { $f.FileName }",
      ].join(" ");
      const result=spawnSync("powershell",["-NoProfile","-Command",ps],{encoding:"utf8",timeout:60000});
      if(result.status===0&&result.stdout.trim())selectedPath=result.stdout.trim();
    }else{
      const result=spawnSync("zenity",["--file-selection","--save","--confirm-overwrite",`--filename=${path.join(packageRoot,suggested)}`,"--title=Save configuration workbook as"],{encoding:"utf8",timeout:60000});
      if(result.status===0&&result.stdout.trim())selectedPath=result.stdout.trim();
    }
  }catch(error){return res.status(500).json({error:"Save As could not be opened: "+error.message});}
  if(!selectedPath)return res.json({cancelled:true});
  selectedPath=path.resolve(path.dirname(selectedPath),safeWorkbookName(path.basename(selectedPath)));lastConfigFolder=path.dirname(selectedPath);
  const token=crypto.randomUUID();pendingConfigSaveTargets.set(token,{path:selectedPath,expires:Date.now()+5*60*1000});
  setTimeout(()=>pendingConfigSaveTargets.delete(token),5*60*1000).unref?.();
  res.json({token,filename:path.basename(selectedPath)});
});
app.post("/api/config-save-file",requireAuth,authorize("filesystem.local"),upload.single("workbook"),(req,res)=>{
  // A Save As selection (token, used once) or the workbook already loaded (target: Save Configuration Workbook).
  const known=req.body?.target?configTargetPath(req.body.target):null;
  const target=known?{path:known,expires:Infinity}:pendingConfigSaveTargets.get(req.body?.token);pendingConfigSaveTargets.delete(req.body?.token);
  try{
    if(req.body?.target&&!known)return res.status(400).json({error:"ISAF no longer knows where the loaded workbook is. Use File → Save Configuration… to choose where to save it."});
    if(!req.file||!target||target.expires<Date.now())return res.status(400).json({error:"The Save As selection expired. Select Save Configuration Workbook again."});
    if(!fs.existsSync(path.dirname(target.path))||!fs.statSync(path.dirname(target.path)).isDirectory())return res.status(400).json({error:"The selected save folder is no longer available."});
    const partial=target.path+".isaf-saving";
    try{fs.copyFileSync(req.file.path,partial);fs.renameSync(partial,target.path);}finally{fs.rmSync(partial,{force:true});}
    res.json({filename:path.basename(target.path),target:rememberConfigTarget(target.path)});
  }catch(error){res.status(500).json({error:"The configuration workbook could not be saved: "+error.message});}
  finally{if(req.file)fs.rm(req.file.path,{force:true},()=>{});}
});

app.get("/api/browse-folder", requireAuth, authorize("filesystem.local"), async (_req, res) => {
  const configSave=_req.query.purpose==='config-save';
  const platform = process.platform;
  let selectedPath = null;

  try {
    if (platform === "darwin") {
      // macOS — AppleScript folder chooser
      const r = spawnSync("osascript", [
        "-e",
        configSave?'tell app "Finder" to POSIX path of (choose folder with prompt "Select the original workbook folder for the new XLSX copy:")':'tell app "Finder" to POSIX path of (choose folder with prompt "Select output folder:")',
      ], { encoding: "utf8", timeout: 60000 });
      if (r.status === 0 && r.stdout.trim()) {
        selectedPath = r.stdout.trim().replace(/\/$/, "");
      }
    } else if (platform === "win32") {
      // Windows — PowerShell FolderBrowserDialog
      const ps = [
        "Add-Type -AssemblyName System.Windows.Forms;",
        "$f = New-Object System.Windows.Forms.FolderBrowserDialog;",
        configSave?"$f.Description = 'Select the original workbook folder for the new XLSX copy';":"$f.Description = 'Select output folder';",
        "$f.ShowNewFolderButton = $true;",
        "if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }",
      ].join(" ");
      const r = spawnSync("powershell", ["-Command", ps], {
        encoding: "utf8", timeout: 60000,
      });
      if (r.status === 0 && r.stdout.trim()) {
        selectedPath = r.stdout.trim();
      }
    } else {
      // Linux fallback — zenity if available
      const r = spawnSync("zenity", [
        "--file-selection", "--directory", configSave?"--title=Select original workbook folder":"--title=Select output folder",
      ], { encoding: "utf8", timeout: 60000 });
      if (r.status === 0 && r.stdout.trim()) {
        selectedPath = r.stdout.trim();
      }
    }
  } catch (err) {
    return res.status(500).json({ error: "Folder picker failed: " + err.message });
  }

  if (!selectedPath) {
    return res.json({ cancelled: true });
  }

  if(configSave)return res.json({path:selectedPath});
  // Persist and return
  const settings = loadSettings();
  settings.outputBase = selectedPath;
  saveSettings(settings);
  res.json({ path: selectedPath, saved: true });
});

function inspectSelectedLogo(filename) {
  const stat=fs.statSync(filename);
  if(!stat.isFile())throw new Error("The selected logo path is not a file.");
  if(stat.size>20*1024*1024)throw new Error("The selected logo exceeds 20 MB.");
  const bytes=fs.readFileSync(filename);let width=0,height=0,format="";
  if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){format="PNG";width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);}
  else if(bytes[0]===255&&bytes[1]===216){format="JPEG";let pos=2;while(pos+3<bytes.length){if(bytes[pos++]!==255)continue;while(bytes[pos]===255)pos++;const code=bytes[pos++];if(code===217||code===218)break;if(code===1||(code>=208&&code<=215))continue;if(pos+2>bytes.length)break;const size=bytes.readUInt16BE(pos);if(size<2||pos+size>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(code)&&size>=7){height=bytes.readUInt16BE(pos+3);width=bytes.readUInt16BE(pos+5);break;}pos+=size;}}
  else {const text=bytes.toString('utf8'),root=text.match(/<svg\b[^>]*>/i)?.[0];if(root){const attr=n=>root.match(new RegExp(`\\b${n}\\s*=\\s*["']([^"']+)["']`,'i'))?.[1]||'',len=v=>{const m=String(v).trim().match(/^([0-9]*\.?[0-9]+)\s*(px|in|cm|mm|pt|pc)?$/i);if(!m)return 0;return Number(m[1])*({px:1,in:96,cm:96/2.54,mm:96/25.4,pt:96/72,pc:16}[(m[2]||'px').toLowerCase()]||1);};width=len(attr('width'));height=len(attr('height'));const view=attr('viewBox').trim().split(/[\s,]+/).map(Number);if((!width||!height)&&view.length===4&&view.every(Number.isFinite)&&view[2]>0&&view[3]>0){width||=view[2];height||=view[3];}if(width&&height)format='SVG';}}
  if(!width||!height)throw new Error("The selected file is not a readable SVG, PNG, or JPEG image.");
  return {format,width,height,bytes:stat.size};
}

// Native logo picker — returns a local SVG/PNG/JPEG path without uploading it.
// The path is stored in the workbook so the local document builder can embed it.
app.get("/api/browse-logo", requireAuth, authorize("filesystem.local"), (_req, res) => {
  const platform = process.platform;
  let selectedPath = null;
  try {
    if (platform === "darwin") {
      const result = spawnSync("osascript", [
        "-e",
        'POSIX path of (choose file with prompt "Select an SVG, PNG, or JPEG company logo:" of type {"public.svg-image", "public.png", "public.jpeg"})',
      ], { encoding: "utf8", timeout: 60000 });
      if (result.status === 0 && result.stdout.trim()) selectedPath = result.stdout.trim();
    } else if (platform === "win32") {
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms;",
        "$f = New-Object System.Windows.Forms.OpenFileDialog;",
        "$f.Title = 'Select an SVG, PNG, or JPEG company logo';",
        "$f.Filter = 'Image files (*.svg;*.png;*.jpg;*.jpeg)|*.svg;*.png;*.jpg;*.jpeg|All files (*.*)|*.*';",
        "if ($f.ShowDialog() -eq 'OK') { $f.FileName }",
      ].join(" ");
      const result = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8", timeout: 60000 });
      if (result.status === 0 && result.stdout.trim()) selectedPath = result.stdout.trim();
    } else {
      const result = spawnSync("zenity", [
        "--file-selection",
        "--title=Select an SVG, PNG, or JPEG company logo",
        "--file-filter=Image files | *.svg *.png *.jpg *.jpeg",
      ], { encoding: "utf8", timeout: 60000 });
      if (result.status === 0 && result.stdout.trim()) selectedPath = result.stdout.trim();
    }
  } catch (err) {
    return res.status(500).json({ error: "Logo picker failed: " + err.message });
  }
  if (!selectedPath) return res.json({ cancelled: true });
  if (!/\.(svg|png|jpe?g)$/i.test(selectedPath)) return res.status(400).json({ error: "Select an SVG, PNG, or JPEG image." });
  try {
    if (!fs.existsSync(selectedPath)) throw new Error("The selected logo file is not available.");
    res.json({ path: selectedPath, ...inspectSelectedLogo(selectedPath) });
  } catch(error) { res.status(400).json({error:error.message}); }
});

app.post("/api/validate-logo", requireAuth, authorize("intake.write"), express.json(), (req,res)=>{
  const filename=String(req.body?.path||'').trim();
  if(!filename)return res.json({ok:true,blank:true});
  try { res.json({ok:true,path:filename,...inspectSelectedLogo(filename)}); }
  catch(error) { res.status(400).json({ok:false,error:error.message}); }
});

// Customer-specific app details shown in the UI: licensed company, licensed phases, starter configuration.
function customerEditionInfo(){const m=editionManifest(),info={};if(m.customer_name)info.customerName=String(m.customer_name);if(m.license_id)info.licenseId=String(m.license_id);if(licensedPhases().length)info.licensedPhases=licensedPhases();if(m.starter_workbook)info.starterWorkbook=String(m.starter_workbook);if(licensedValues())info.licensedValues=licensedValues();if(hostedTrial())info.hostedTrial=true;if(licensedProgramTypesFromEdition().length)info.licensedProgramTypes=licensedProgramTypesFromEdition();info.importCapabilities=licensedTools();info.fileImport=fileImportLicensed();return info;}
// Health check
app.get("/api/health", (_req, res) => {
  const edition=appEdition();
  // pdfAvailable lets the Build tab say LibreOffice is missing BEFORE a build rather than after
  // one: the conversion runs on the exported folder, so without this the user waits out a full
  // build (1312 documents on an aircraft program) to be told the box they ticked could not run.
  res.json({ status: "ok", version: "6.0.3", edition, hosted:HOSTED_SERVICE, pdfAvailable: !HOSTED_SERVICE && Boolean(findSoffice()), authMode: authentication.mode, authRequired:authentication.mode==="oidc"||(Boolean(API_KEY||API_KEY_HASH||ACCESS_KEYS.length)&&!(CUSTOMER_ACCOUNTS&&accountStore.hasAccounts())), ...(edition==="demo"?{demoProfile:clientDemoProfile()}: {}), ...(edition==="customer"?customerEditionInfo():{}) });
});

app.get("/api/demo-register", requireAuth, authorize("demo.manage"), async(_req,res)=>{
  if(appEdition()!=="full")return res.status(403).json({error:"The Demo Register is available in the Admin app only."});
  try{
    const {stdout}=await runDemoRegister(["list"]),data=JSON.parse(stdout);
    res.json({...data,path:"09-User Demos/ISAF_Demo_Register.xlsx"});
  }catch(error){res.status(500).json({error:"Could not read the Demo Register.",detail:String(error.stderr||error.message).slice(-2000)});}
});

app.get("/api/demo-register.xlsx", requireAuth, authorize("demo.manage"), (req,res)=>{
  if(appEdition()!=="full")return res.status(403).json({error:"The Demo Register is available in the Admin app only."});
  if(!fs.existsSync(DEMO_REGISTER_PATH))return res.status(404).json({error:"No Demo Register exists yet. Create a Demo App first."});
  res.download(DEMO_REGISTER_PATH,"ISAF_Demo_Register.xlsx");
});

function requestedDemo(body){
  const user=String(body?.user||"").trim(),company=String(body?.company||"").trim(),programType=String(body?.programType||"").trim(),phase=String(body?.phase||"").trim();
  if(!user||!company)throw Object.assign(Error("Enter the user name and company."),{status:400});
  if(user.length>100||company.length>120)throw Object.assign(Error("User name or company name is too long."),{status:400});
  if(!["Aircraft","System","LRU"].includes(programType))throw Object.assign(Error("Select Aircraft, System, or LRU as the program type."),{status:400});
  const milestone=PHASE_TO_MILESTONE[phase];
  if(!milestone||phase==="all")throw Object.assign(Error("Select one supported program phase."),{status:400});
  const phaseLabel={codr:"CoDR",srr:"SRR",pdr:"PDR",soi1:"SOI 1",cdr:"CDR",soi2:"SOI 2",soi3:"SOI 3",trr:"TRR",soi4:"SOI 4",tia:"TIA"}[phase];
  return {user,company,programType,phase,milestone,phaseLabel};
}
function requestedHostedDemo(body){
  const user=String(body?.user||'').trim()||'Hosted Demo',company=String(body?.company||'').trim()||'All Visitors';
  if(user.length>100||company.length>120)throw Object.assign(Error('User name or company name is too long.'),{status:400});
  return {user,company,programType:'All',phaseLabel:'Selectable'};
}
async function createDemoArchive(profile,{hostedGeneric=false}={}){
  const source=path.resolve(__dirname,".."),builder=path.join(source,"scripts","make_edition.py"),tmp=fs.mkdtempSync(path.join(os.tmpdir(),"isaf-demo-app-"));
  try{
    const args=[builder,"--source",source,"--out",tmp,"--edition","demo","--skip-bundle"];
    if(hostedGeneric)args.push("--hosted-generic-demo");
    else args.push("--demo-user",profile.user,"--demo-company",profile.company,"--demo-milestone",profile.milestone,"--demo-program-type",profile.programType);
    const {stdout,stderr}=await execFileAsync(PYTHON_COMMAND,args,{cwd:source,timeout:600000,maxBuffer:20*1024*1024});
    const filename=hostedGeneric?"ISAF_Hosted_Demo.zip":`ISAF_Demo_App_${demoFilenamePart(profile.user,"User")}_${demoFilenamePart(profile.company,"Company")}.zip`,archive=path.join(tmp,filename);
    if(!fs.existsSync(archive))throw new Error((stderr||stdout||"The Demo App archive was not created.").slice(-4000));
    return {source,tmp,filename,archive};
  }catch(error){
    fs.rm(tmp,{recursive:true,force:true},()=>{});
    throw error;
  }
}
async function recordDemo(profile,filename,delivery,url=""){
  await runDemoRegister(["add","--user",profile.user,"--company",profile.company,"--type",profile.programType,"--phase",profile.phaseLabel,"--filename",filename,"--delivery",delivery,"--url",url]);
}

// Admin-only personalized Demo App builder. The archive is assembled in the
// system temporary directory and delivered as a browser download.
app.post("/api/create-demo", requireAuth, authorize("demo.manage"), async(req,res)=>{
  if(appEdition()!=="full")return res.status(403).json({error:"Only the Admin app can create Demo Apps."});
  let built;
  try{
    const profile=requestedDemo(req.body);built=await createDemoArchive(profile);
    try{await recordDemo(profile,built.filename,"Downloaded ZIP");}
    catch(registerError){registerError.userMessage="The Demo App was not downloaded because its entry could not be saved to 09-User Demos.";throw registerError;}
    res.download(built.archive,built.filename,()=>fs.rm(built.tmp,{recursive:true,force:true},()=>{}));
  }catch(error){
    if(built)fs.rm(built.tmp,{recursive:true,force:true},()=>{});
    res.status(error.status||500).json({error:error.userMessage||"Could not create the Demo App.",detail:String(error.stderr||error.stdout||error.message).slice(-4000)});
  }
});

// Admin-only customer register (Customers tab). Data lives outside the app folder.
const customerRegister=new CustomerRegister();
// Usage collected from Customer apps (usage.js). Settings come from the Admin computer's or the collector's
// environment and are never stored in the repository:
//   ISAF_USAGE_ENDPOINT          collector base URL built into new Customer apps (for example https://isaf-usage.onrender.com)
//   ISAF_USAGE_COLLECTOR_SECRET  signs each license's token (the same value on the collector and on the Admin computer)
//   ISAF_USAGE_COLLECTOR_KEY     lets the Admin app download collected usage (Sync usage)
const usageStore=createUsageStore(path.join(customerDataDir(),"usage"));
// On the Admin computer the three values can also be saved from the Customers tab (Usage collector settings) to
// ISAF_Usage_Settings.json in the Admin data folder (next to the customer register, outside the repository, kept
// across versions). Environment variables win over the file.
const USAGE_SETTINGS_FILE=path.join(customerDataDir(),"ISAF_Usage_Settings.json");
function usageSettings(){
  let file={};try{file=JSON.parse(fs.readFileSync(USAGE_SETTINGS_FILE,"utf8"));}catch{}
  return {endpoint:String(process.env.ISAF_USAGE_ENDPOINT||file.endpoint||"").trim().replace(/\/+$/,""),secret:process.env.ISAF_USAGE_COLLECTOR_SECRET||file.secret||"",key:process.env.ISAF_USAGE_COLLECTOR_KEY||file.key||""};
}
function usageAppSettings(customer){
  const {endpoint:base,secret}=usageSettings();
  return base&&secret&&customer?.license_id?{endpoint:base+"/api/usage/ingest",token:usageToken(secret,customer.license_id)}:{};
}
// App updates built into a new Customer app: where to ask whether a newer version is offered. Same license
// token as usage, and the same collector service (updates.js).
function updateAppSettings(customer){
  const {endpoint:base,secret}=usageSettings();
  return base&&secret&&customer?.license_id?{endpoint:base+"/api/updates/check",token:usageToken(secret,customer.license_id)}:{};
}
// Which live requirements tool connections a Customer app offers (Customers tab → Requirements tools).
// Left empty, the app offers none and the customer imports ReqIF, Excel and CSV files as before.
// Every licensed import entry travels, not just the live connections. Filtering
// this against TOOLS (jama, polarion) silently dropped "DOORS ReqIF" and "Other
// ReqIF, Excel and CSV files", so a customer licensed for file import got an app
// with fileImport false and no Import tab at all, however the Customers tab was
// ticked. Where the distinction matters, licensedTools() is narrowed to the live
// connectors at the point of use.
function toolsAppSettings(customer){
  return (customer?.requirements_tools||[]).map(String).filter(t=>AVAILABLE_IMPORT_IDS.includes(t));
}
// The releases offered to customers (Customers tab → App updates). On the Admin computer the register is the
// owner's; on the usage collector it is the copy the Admin app published and the one Customer apps read.
const releaseRegister=createReleaseRegister(path.join(customerDataDir(),"ISAF_Update_Releases.json"));
// Collector: a Customer app asks whether a newer version is offered (its license token, no sign-in).
app.get("/api/updates/check",(req,res)=>{
  const secret=process.env.ISAF_USAGE_COLLECTOR_SECRET||"";
  if(appEdition()!=="full"||!secret)return res.status(404).json({error:"This server does not answer update checks."});
  const license=String(req.query.license||"");
  if(!validToken(secret,license,String(req.headers["x-isaf-usage-token"]||"")))return res.status(401).json({error:"Invalid usage token."});
  res.json(releaseRegister.answerFor({version:String(req.query.version||"")}));
});
// Collector: the Admin app publishes the register of offered releases, with the collector key.
app.put("/api/updates/register",express.json({limit:"1mb"}),(req,res)=>{
  const key=process.env.ISAF_USAGE_COLLECTOR_KEY||"";
  const given=String(req.headers["x-isaf-collector-key"]||"");
  if(appEdition()!=="full"||!key||given.length!==key.length||!crypto.timingSafeEqual(Buffer.from(given),Buffer.from(key)))return res.status(401).json({error:"Invalid collector key."});
  const saved=releaseRegister.replace(req.body||{});
  res.json({ok:true,releases:saved.releases.length});
});
// Collector: Customer apps send their events here (no user sign-in; each request carries its license token).
app.post("/api/usage/ingest",express.json({limit:"2mb"}),(req,res)=>{
  const secret=process.env.ISAF_USAGE_COLLECTOR_SECRET||"";
  if(appEdition()!=="full"||!secret)return res.status(404).json({error:"This server does not collect usage."});
  const license=String(req.body?.license_id||"");
  if(!validToken(secret,license,String(req.headers["x-isaf-usage-token"]||"")))return res.status(401).json({error:"Invalid usage token."});
  const events=(Array.isArray(req.body?.events)?req.body.events:[]).slice(0,500);
  res.json(usageStore.add(events,{license}));
});
// Collector: the Admin app downloads collected usage (Sync usage), with the collector key.
app.get("/api/usage/export",(req,res)=>{
  const key=process.env.ISAF_USAGE_COLLECTOR_KEY||"";
  const given=String(req.headers["x-isaf-collector-key"]||"");
  if(appEdition()!=="full"||!key||given.length!==key.length||!crypto.timingSafeEqual(Buffer.from(given),Buffer.from(key)))return res.status(401).json({error:"Invalid collector key."});
  const licenses=String(req.query.licenses||"").split(",").map(x=>x.trim()).filter(Boolean).slice(0,500);
  res.json({events:licenses.flatMap(l=>usageStore.list(l))});
});

// Append one row to the Excel delivery register beside the Admin folders. A failure is
// reported but never undoes the delivery itself.
async function appendDelivery(customer,event,entry={}){
  const commit=(releaseVersions(path.resolve(__dirname,"..")).find(r=>r.version===(entry.version||customer.version_deployed))||{}).commit||"";
  try{
    const job=execFileAsync(PYTHON_COMMAND,[path.join(__dirname,"customer_register_xlsx.py"),deliveryRegisterFile()],{timeout:60000,maxBuffer:5*1024*1024});
    job.child.stdin.on("error",()=>{});job.child.stdin.end(JSON.stringify({row:deliveryRow(customer,{event,entry,commit})}));
    await job;return "";
  }catch(error){return ` The delivery register could not be updated (${String(error.stderr||error.message).trim().slice(-200)}). Close it in Excel and record this delivery manually.`;}
}
const fileSha256=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const adminOnly=(res)=>{if(appEdition()!=="full"){res.status(403).json({error:"Only the Admin app manages customers."});return false;}return true;};
app.get("/api/admin/customers",requireAuth,authorize("demo.manage"),(req,res)=>{
  if(!adminOnly(res))return;
  try{res.json({customers:customerRegister.read(),options:CUSTOMER_OPTIONS,importOptions:REQUIREMENTS_IMPORT,releases:releaseVersions(path.resolve(__dirname,"..")),currentVersion:editionManifest().version||"",dataFile:customerRegister.file,deliveryRegister:deliveryRegisterFile()});}
  catch(error){res.status(error.status||500).json({error:error.message});}
});
app.put("/api/admin/customers/:id",requireAuth,authorize("demo.manage"),express.json({limit:"1mb"}),async(req,res)=>{
  if(!adminOnly(res))return;
  try{
    const before=customerRegister.read().find(c=>c.id===req.params.id),customer=customerRegister.save(req.params.id,req.body||{});
    let warning="";if(licenseChanged(before,customer))warning=await appendDelivery(customer,before?"License or scope changed":"Customer added");
    res.json({customer,warning});
  }catch(error){res.status(error.status||500).json({error:error.message});}
});
app.delete("/api/admin/customers/:id",requireAuth,authorize("demo.manage"),(req,res)=>{
  if(!adminOnly(res))return;
  try{customerRegister.remove(req.params.id);res.json({ok:true});}
  catch(error){res.status(error.status||500).json({error:error.message});}
});
// Usage per customer (Admin Customers tab): events, a summary of programs and users, import, CSV and sync.
const customerById=id=>customerRegister.read().find(c=>c.id===id);
app.get("/api/admin/customers/:id/usage",requireAuth,authorize("demo.manage"),(req,res)=>{
  if(!adminOnly(res))return;const c=customerById(req.params.id);if(!c)return res.status(404).json({error:"Customer not found."});
  const events=usageStore.list(c.license_id);res.json({events:events.slice(-2000).reverse(),total:events.length,summary:summarizeUsage(events),collector:(({endpoint,secret,key})=>({configured:Boolean(endpoint&&secret),sync:Boolean(endpoint&&key),endpoint}))(usageSettings())});
});
app.get("/api/admin/customers/:id/usage.csv",requireAuth,authorize("demo.manage"),(req,res)=>{
  if(!adminOnly(res))return;const c=customerById(req.params.id);if(!c)return res.status(404).json({error:"Customer not found."});
  res.attachment(`ISAF_Usage_${String(c.company).replace(/[^A-Za-z0-9_-]+/g,"_")}_${new Date().toISOString().slice(0,10)}.csv`).type("text/csv");res.send("﻿"+usageCsv(usageStore.list(c.license_id)));
});
app.post("/api/admin/customers/:id/usage/import",requireAuth,authorize("demo.manage"),express.text({type:"*/*",limit:"20mb"}),(req,res)=>{
  if(!adminOnly(res))return;const c=customerById(req.params.id);if(!c)return res.status(404).json({error:"Customer not found."});
  const lines=String(req.body||"").split(/\r?\n/).filter(Boolean),events=[];
  for(const l of lines){try{events.push(JSON.parse(l));}catch{}}
  const other=events.filter(e=>e&&e.license_id&&e.license_id!==c.license_id).length;
  const result=usageStore.add(events,{license:c.license_id});
  res.json({...result,otherLicence:other});
});
// Usage collector settings on the Admin computer (values are never sent back; only whether they are set).
app.get("/api/admin/usage/settings",requireAuth,authorize("demo.manage"),(req,res)=>{
  if(!adminOnly(res))return;const u=usageSettings();
  res.json({endpoint:u.endpoint,secretSet:Boolean(u.secret),keySet:Boolean(u.key),fromEnvironment:Boolean(process.env.ISAF_USAGE_ENDPOINT||process.env.ISAF_USAGE_COLLECTOR_SECRET||process.env.ISAF_USAGE_COLLECTOR_KEY),file:USAGE_SETTINGS_FILE});
});
app.put("/api/admin/usage/settings",requireAuth,authorize("demo.manage"),express.json(),(req,res)=>{
  if(!adminOnly(res))return;
  let file={};try{file=JSON.parse(fs.readFileSync(USAGE_SETTINGS_FILE,"utf8"));}catch{}
  const endpoint=String(req.body?.endpoint??file.endpoint??"").trim().replace(/\/+$/,"");
  if(endpoint&&!/^https:\/\/[^\s/]+/i.test(endpoint)&&!/^http:\/\/localhost(:\d+)?$/i.test(endpoint))return res.status(400).json({error:"Enter the collector address starting with https://, for example https://isaf-usage.onrender.com"});
  const next={endpoint,secret:req.body?.secret?String(req.body.secret).trim():file.secret||"",key:req.body?.key?String(req.body.key).trim():file.key||""};
  for(const v of [next.secret,next.key])if(v&&v.length<24)return res.status(400).json({error:"The collector secret and key must be at least 24 characters. Use Generate."});
  fs.mkdirSync(path.dirname(USAGE_SETTINGS_FILE),{recursive:true});fs.writeFileSync(USAGE_SETTINGS_FILE,JSON.stringify(next,null,2),{mode:0o600});
  res.json({ok:true,endpoint:next.endpoint,secretSet:Boolean(next.secret),keySet:Boolean(next.key)});
});
app.post("/api/admin/usage/sync",requireAuth,authorize("demo.manage"),async(req,res)=>{
  if(!adminOnly(res))return;
  const {endpoint:base,key}=usageSettings();
  if(!base||!key)return res.status(409).json({error:"Usage sync is not set up yet. Enter the collector address and collector key under Usage collector settings (see Usage Tracking Setup)."});
  try{
    const licenses=customerRegister.read().map(c=>c.license_id).filter(Boolean);
    const r=await fetch(`${base}/api/usage/export?licenses=${encodeURIComponent(licenses.join(","))}`,{headers:{"x-isaf-collector-key":key},signal:AbortSignal.timeout(30000)});
    const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||`The usage collector answered ${r.status}.`);
    res.json(usageStore.add(body.events||[]));
  }catch(error){res.status(502).json({error:`Usage sync failed: ${error.message}`});}
});
// App updates offered to customers (Customers tab → App updates, all customers). Recorded here and published
// to the usage collector, which is the service Customer apps can reach (updates.js).
app.get("/api/admin/updates",requireAuth,authorize("demo.manage"),(req,res)=>{
  if(!adminOnly(res))return;
  const {endpoint,key}=usageSettings();
  res.json({...releaseRegister.read(),currentVersion:editionManifest().version||"",known:releaseVersions(path.resolve(__dirname,"..")).map(r=>r.version),file:releaseRegister.file,canPublish:Boolean(endpoint&&key),endpoint});
});
app.put("/api/admin/updates",requireAuth,authorize("demo.manage"),express.json({limit:"1mb"}),(req,res)=>{
  if(!adminOnly(res))return;
  try{
    if(typeof req.body?.contact==="string")releaseRegister.setContact(req.body.contact);
    if(req.body?.release)releaseRegister.save(req.body.release);
    res.json(releaseRegister.read());
  }catch(error){res.status(error.status||500).json({error:error.message});}
});
app.delete("/api/admin/updates/:version",requireAuth,authorize("demo.manage"),(req,res)=>{
  if(!adminOnly(res))return;
  releaseRegister.remove(req.params.version);res.json(releaseRegister.read());
});
app.post("/api/admin/updates/publish",requireAuth,authorize("demo.manage"),async(req,res)=>{
  if(!adminOnly(res))return;
  const {endpoint:base,key}=usageSettings();
  if(!base||!key)return res.status(409).json({error:"The update service is not set up yet. Enter the collector address and collector key under Usage collector settings (see Usage Tracking Setup)."});
  try{
    const r=await fetch(`${base}/api/updates/register`,{method:"PUT",headers:{"Content-Type":"application/json","x-isaf-collector-key":key},body:JSON.stringify(releaseRegister.read()),signal:AbortSignal.timeout(30000)});
    const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||`The update service answered ${r.status}.`);
    res.json({ok:true,published:body.releases||0,endpoint:base});
  }catch(error){res.status(502).json({error:`The releases were not published: ${error.message}`});}
});
// Named users (per-user access keys). The key is generated here (or entered), returned once, and only its
// SHA-256 is kept and built into the Customer app, which then records who used it.
const newKeyFor=entered=>{const key=String(entered||"").trim();if(key&&key.length<8)throw Object.assign(new Error("Use at least 8 characters for the key, or generate one."),{status:400});return key||crypto.randomBytes(18).toString("base64url");};
const sha=key=>crypto.createHash("sha256").update(key).digest("hex");
const userView=u=>({id:u.id,name:u.name,email:u.email||"",created:u.created,key_set:u.key_set||"",disabled:!!u.disabled,disabled_on:u.disabled_on||""});
app.post("/api/admin/customers/:id/users",requireAuth,authorize("demo.manage"),express.json(),(req,res)=>{
  if(!adminOnly(res))return;
  try{const key=newKeyFor(req.body?.key);const {user}=customerRegister.setUser(req.params.id,{name:req.body?.name,email:req.body?.email,sha256:sha(key)});res.json({user:userView(user),key:req.body?.key?undefined:key});}
  catch(error){res.status(error.status||500).json({error:error.message});}
});
app.post("/api/admin/customers/:id/users/:userId/key",requireAuth,authorize("demo.manage"),express.json(),(req,res)=>{
  if(!adminOnly(res))return;
  try{const key=newKeyFor(req.body?.key);const {user}=customerRegister.setUser(req.params.id,{userId:req.params.userId,sha256:sha(key)});res.json({user:userView(user),key:req.body?.key?undefined:key});}
  catch(error){res.status(error.status||500).json({error:error.message});}
});
app.patch("/api/admin/customers/:id/users/:userId",requireAuth,authorize("demo.manage"),express.json(),(req,res)=>{
  if(!adminOnly(res))return;
  try{const {user}=customerRegister.setUser(req.params.id,{userId:req.params.userId,name:req.body?.name,email:req.body?.email,disabled:typeof req.body?.disabled==="boolean"?req.body.disabled:undefined});res.json({user:userView(user)});}
  catch(error){res.status(error.status||500).json({error:error.message});}
});
app.delete("/api/admin/customers/:id/users/:userId",requireAuth,authorize("demo.manage"),(req,res)=>{
  if(!adminOnly(res))return;
  try{customerRegister.removeUser(req.params.id,req.params.userId);res.json({ok:true});}
  catch(error){res.status(error.status||500).json({error:error.message});}
});
// Customer access key: generated here (or entered, for example the ISAF_API_KEY already used on Render).
// Only its SHA-256 is stored and built into the Customer app, which then asks for the key even when it
// runs on a laptop or server without ISAF_API_KEY. The generated key is returned once.
app.post("/api/admin/customers/:id/access-key",requireAuth,authorize("demo.manage"),(req,res)=>{
  if(!adminOnly(res))return;
  try{
    const entered=String(req.body?.key||"").trim();
    if(entered&&entered.length<8)return res.status(400).json({error:"Use at least 8 characters for the access key. For a real deployment, use Generate new key."});
    const key=entered||crypto.randomBytes(24).toString("base64url");
    const record=customerRegister.setAccessKey(req.params.id,crypto.createHash("sha256").update(key).digest("hex"));
    res.json({ok:true,access_key_set:record.access_key_set,key:entered?undefined:key});
  }catch(error){res.status(error.status||500).json({error:error.message});}
});
// Seat codes for a customer's login accounts (owner, 22 November 2026). Signed with MX Aero's key, kept only in
// the Admin data folder; the codes issued may not add up to more than the customer's Seats. The first code a
// customer needs is an Admin seat code (it creates the Customer Admin account and counts as seats too).
const seatSigner=createSeatSigner(customerDataDir());
const issuedSeats=c=>(c.seat_codes||[]).reduce((n,x)=>n+(Number(x.seats)||0),0);
app.post("/api/admin/customers/:id/seat-codes",requireAuth,authorize("demo.manage"),(req,res)=>{
  if(!adminOnly(res))return;
  try{
    const customer=customerRegister.read().find(c=>c.id===req.params.id);
    if(!customer)return res.status(404).json({error:"Customer not found."});
    const seats=Number.parseInt(req.body?.seats,10)||1,limit=Number.parseInt(customer.seats,10);
    if(!(limit>=1))return res.status(400).json({error:"Set the customer's Seats first (the seats bought, or the company-wide maximum)."});
    if(issuedSeats(customer)+seats>limit)return res.status(409).json({error:`This would issue ${issuedSeats(customer)+seats} seats; the customer has ${limit}. Raise Seats first if they bought more.`});
    const {code,payload}=seatSigner.issue({licenseId:customer.license_id,company:customer.company,seats,admin:req.body?.admin===true});
    const record=customerRegister.addSeatCode(customer.id,{code,payload,note:req.body?.note,issuedBy:req.auth?.displayName||""});
    res.status(201).json({code,seat_codes:record.seat_codes,issued:issuedSeats(record),seats:limit});
  }catch(error){res.status(error.status||500).json({error:error.message});}
});
// Generate the Customer Edition zip from this Admin version and record the deployment.
// Licensed-scope enforcement (signed license file, licensed templates only) is a later phase.
const CUSTOMER_GITHUB_CONFIG=path.resolve(__dirname,"..","Customer_GitHub_Deploy.json");
async function buildCustomerArchive(customer,{watermark,text}){
  const source=path.resolve(__dirname,".."),builder=path.join(source,"scripts","make_edition.py"),tmp=fs.mkdtempSync(path.join(os.tmpdir(),"isaf-customer-app-"));
  try{
    // Starter configuration from the customer record (preloaded in the app) and licensed phases.
    const starterName=`ISAF_${demoFilenamePart(customer.company,"Customer")}_Starter_Configuration.xlsx`,starterDir=path.join(tmp,"starter");fs.mkdirSync(starterDir);
    const starterJob=execFileAsync(PYTHON_COMMAND,[SAVE_SCRIPT],{timeout:60000,maxBuffer:10*1024*1024});
    starterJob.child.stdin.on("error",()=>{});starterJob.child.stdin.end(JSON.stringify({source:path.join(source,"02_Configuration_Workbook","ISAF_WBK-001_Configuration_Workbook.xlsx"),modifications:{...CUSTOMER_DEFAULTS,...starterModifications(customer)},output_dir:starterDir,output_name:starterName,exact_name:true}));
    const starter=JSON.parse((await starterJob).stdout||"{}");if(starter.error||!starter.output)throw new Error("The starter configuration could not be created: "+(starter.error||"no output"));
    const builderArgs=[builder,"--source",source,"--out",tmp,"--edition","customer","--skip-bundle","--no-github","--customer-name",customer.company,"--license-id",String(customer.license_id||""),"--starter-workbook",starter.output,"--licensed-phases",licensedPhaseIds(customer).join(","),"--licensed-values-file",path.join(starterDir,"licensed_values.json")];
    if(customer.deployment_model==="Hosted by MX Aero")builderArgs.push("--hosted-trial");
    if(customer.access_key_sha256)builderArgs.push("--access-key-sha256",customer.access_key_sha256);
    // Named users and the usage collector (see usage.js). The collector token lets the app add usage records for this license only.
    fs.writeFileSync(path.join(starterDir,"app_settings.json"),JSON.stringify({access_keys:appAccessKeys(customer),usage:usageAppSettings(customer),updates:updateAppSettings(customer),tools:toolsAppSettings(customer),...(customer.license_id?{seat_public_key:seatSigner.publicKey(),license_type:customer.license_type||"",seats:customer.seats||""}:{})}));builderArgs.push("--app-settings-file",path.join(starterDir,"app_settings.json"));
    fs.writeFileSync(path.join(starterDir,"licensed_values.json"),JSON.stringify(starterModifications(customer)));
    if(licensedProgramTypes(customer).length)builderArgs.push("--licensed-program-types",licensedProgramTypes(customer).join(","));
    if(watermark)builderArgs.push("--watermark-documents","--watermark-text",text);
    const {stdout,stderr}=await execFileAsync(PYTHON_COMMAND,builderArgs,{cwd:source,timeout:600000,maxBuffer:20*1024*1024});
    const built=fs.readdirSync(tmp).find(f=>/^ISAF_Customer_Edition.*\.zip$/.test(f));
    if(!built)throw new Error((stderr||stdout||"The Customer Edition archive was not created.").slice(-4000));
    const version=editionManifest().version||"";
    return {source,tmp,archive:path.join(tmp,built),version,filename:`ISAF_Customer_Edition_v${version}_${demoFilenamePart(customer.company,"Customer")}.zip`};
  }catch(error){fs.rm(tmp,{recursive:true,force:true},()=>{});throw error;}
}
const customerWatermark=req=>{const watermark=wantFlag(req.query.watermark);return {watermark,text:watermarkText(req.query.text)};};
app.post("/api/admin/customers/:id/create-app",requireAuth,authorize("demo.manage"),async(req,res)=>{
  if(!adminOnly(res))return;
  const customer=customerRegister.read().find(c=>c.id===req.params.id);
  if(!customer)return res.status(404).json({error:"Save the customer before creating its app."});
  if(!customer.access_key_sha256&&!appAccessKeys(customer).length)return res.status(409).json({error:"This customer has no access key, so the app would open for anyone. Set one first: Deployment → Access key → type a key of at least 8 characters and press Set key, or press Generate new key and copy what ISAF shows — it is shown once and never stored. Adding a user under Users gives that person their own key instead."});
  let built;
  try{
    const mark=customerWatermark(req);built=await buildCustomerArchive(customer,mark);
    const entry={version:built.version,delivery:"Downloaded ZIP",filename:built.filename,sha256:fileSha256(built.archive),watermark:mark.watermark?`"${mark.text}" watermark`:""};
    const updated=customerRegister.recordDeployment(customer.id,entry),warning=await appendDelivery(updated,"Customer app created (ZIP)",entry);
    if(warning)res.setHeader("X-ISAF-Register-Warning",encodeURIComponent(warning));
    res.download(built.archive,built.filename,()=>fs.rm(built.tmp,{recursive:true,force:true},()=>{}));
  }catch(error){
    if(built)fs.rm(built.tmp,{recursive:true,force:true},()=>{});
    res.status(error.status||500).json({error:"Could not create the Customer app.",detail:String(error.stderr||error.stdout||error.message).slice(-4000)});
  }
});
// Customer integration record as an Excel workbook (pre-filled from the register).
app.get("/api/admin/customers/:id/record.xlsx",requireAuth,authorize("demo.manage"),async(req,res)=>{
  if(!adminOnly(res))return;
  const customer=customerRegister.read().find(c=>c.id===req.params.id);
  if(!customer)return res.status(404).json({error:"Customer not found."});
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"isaf-customer-record-")),out=path.join(tmp,"record.xlsx");
  try{
    const job=execFileAsync(PYTHON_COMMAND,[path.join(__dirname,"customer_record_xlsx.py"),out],{timeout:60000,maxBuffer:10*1024*1024});
    job.child.stdin.on("error",()=>{});job.child.stdin.end(JSON.stringify({customer,version:editionManifest().version||"",releases:releaseVersions(path.resolve(__dirname,".."))}));
    await job;
    res.download(out,`ISAF_Customer_Record_${demoFilenamePart(customer.company,"Customer")}_${new Date().toISOString().slice(0,10)}.xlsx`,()=>fs.rm(tmp,{recursive:true,force:true},()=>{}));
  }catch(error){fs.rm(tmp,{recursive:true,force:true},()=>{});res.status(500).json({error:"Could not create the customer record workbook.",detail:String(error.stderr||error.message).slice(-2000)});}
});

// Publish the customer's app to GitHub (Render redeploys from it), like Publish Generic
// Hosted Demo. Uses Customer_GitHub_Deploy.json for the Git identity and options; a
// customer-specific repository (customer record) gets its own local checkout so
// customers never overwrite each other. Without one, the shared Customer site is used.
app.post("/api/admin/customers/:id/publish-app",requireAuth,authorize("demo.manage"),async(req,res)=>{
  if(!adminOnly(res))return;
  const customer=customerRegister.read().find(c=>c.id===req.params.id);
  if(!customer)return res.status(404).json({error:"Save the customer before publishing its app."});
  if(!customer.access_key_sha256&&!appAccessKeys(customer).length)return res.status(409).json({error:"This customer has no access key, so the published app would open for anyone. Set one first: Deployment → Access key. If the Render service already has ISAF_API_KEY, type that same value and press Set key — the two must match or the app will not open. Otherwise press Generate new key, copy what ISAF shows (it is shown once and never stored) and set it as ISAF_API_KEY in Render. Adding a user under Users gives that person their own key instead."});
  if(!fs.existsSync(CUSTOMER_GITHUB_CONFIG))return res.status(409).json({error:"Customer publishing is not configured. Create Customer_GitHub_Deploy.json using the supplied example."});
  if(!fs.existsSync(EDITION_PUBLISHER))return res.status(500).json({error:"The Customer publisher is missing."});
  let built,configDir;
  try{
    const base=JSON.parse(fs.readFileSync(CUSTOMER_GITHUB_CONFIG,"utf8")),adminParent=path.dirname(path.dirname(CUSTOMER_GITHUB_CONFIG));
    const own=String(customer.publish_repository||"").trim();
    const config={...base,enabled:true};
    if(own){config.repository_url=own;config.local_checkout=path.join(adminParent,`ISAF_Customer_${demoFilenamePart(customer.company,"Customer")}_Repository`);config.hosted_url=String(customer.hosted_url||"").trim();}
    else{const checkout=String(base.local_checkout||"../ISAF_Customer_Edition_Repository");config.local_checkout=path.isAbsolute(checkout)?checkout:path.resolve(path.dirname(CUSTOMER_GITHUB_CONFIG),checkout);}
    config.commit_message=`Publish ISAF Customer Edition v{version} for ${customer.company}`;
    config.tag_label=demoFilenamePart(customer.company,"customer");
    configDir=fs.mkdtempSync(path.join(os.tmpdir(),"isaf-customer-publish-"));
    const configFile=path.join(configDir,"Customer_GitHub_Deploy.json");fs.writeFileSync(configFile,JSON.stringify(config,null,2));
    const mark=customerWatermark(req);built=await buildCustomerArchive(customer,mark);
    const {stdout,stderr}=await execFileAsync(PYTHON_COMMAND,[EDITION_PUBLISHER,"--archive",built.archive,"--config",configFile,"--source",built.source],{cwd:built.source,timeout:600000,maxBuffer:20*1024*1024});
    const url=String(config.hosted_url||"").trim(),repository=String(config.repository_url||"").replace(/^.*[:/]([^/]+\/[^/]+?)(\.git)?$/,"$1");
    const tag=(/^TAG: (\S+)/m.exec(String(stdout||""))||[])[1]||"";
    const entry={version:built.version,delivery:`Published to GitHub (${repository||"configured repository"})`,filename:url,repository,tag,sha256:fileSha256(built.archive),watermark:mark.watermark?`"${mark.text}" watermark`:""};
    const updated=customerRegister.recordDeployment(customer.id,entry),warning=await appendDelivery(updated,"Customer app published (GitHub)",entry);
    res.json({ok:true,url,tag,shared:!own,message:`Published to ${repository||"the configured repository"}${tag?" with baseline tag "+tag:""}.${url?"\nRender redeploys "+url+" automatically within a few minutes.":"\nRender redeploys the service automatically within a few minutes."}${warning?"\n"+warning.trim():""}`,detail:String(stdout||stderr||"").slice(-4000)});
  }catch(error){
    res.status(error.status||500).json({error:"Could not publish the Customer app.",detail:String(error.stderr||error.stdout||error.message).slice(-4000)});
  }finally{
    if(built)fs.rm(built.tmp,{recursive:true,force:true},()=>{});
    if(configDir)fs.rm(configDir,{recursive:true,force:true},()=>{});
  }
});

// Publish the shared generic Hosted Demo to a dedicated private GitHub
// repository. The hosted visitor chooses the sanitized program type and phase.
app.post("/api/publish-demo", requireAuth, authorize("demo.manage"), async(req,res)=>{
  if(appEdition()!=="full")return res.status(403).json({error:"Only the Admin app can publish Demo Apps."});
  if(!fs.existsSync(HOSTED_DEMO_CONFIG))return res.status(409).json({error:"Hosted Demo publishing is not configured. Create Hosted_Demo_GitHub_Deploy.json using the supplied example."});
  if(!fs.existsSync(EDITION_PUBLISHER))return res.status(500).json({error:"The Hosted Demo publisher is missing."});
  let built;
  try{
    const profile=requestedHostedDemo(req.body);built=await createDemoArchive(profile,{hostedGeneric:true});
    const {stdout,stderr}=await execFileAsync(PYTHON_COMMAND,[EDITION_PUBLISHER,"--archive",built.archive,"--config",HOSTED_DEMO_CONFIG,"--source",built.source],{cwd:built.source,timeout:600000,maxBuffer:20*1024*1024});
    const config=JSON.parse(fs.readFileSync(HOSTED_DEMO_CONFIG,"utf8")),url=String(config.hosted_url||"").trim();
    await recordDemo(profile,built.filename,"Hosted Demo",url);
    res.json({ok:true,url,message:url?"Hosted Demo published. Render will redeploy the site.":"Hosted Demo published. Render will redeploy the configured service.",detail:String(stdout||stderr||"").slice(-4000)});
  }catch(error){
    res.status(error.status||500).json({error:"Could not publish the Hosted Demo.",detail:String(error.stderr||error.stdout||error.message).slice(-4000)});
  }finally{
    if(built)fs.rm(built.tmp,{recursive:true,force:true},()=>{});
  }
});

// Parse endpoint: upload workbook, return config data as JSON
const PARSE_BUNDLE = path.resolve(__dirname, "parse_workbook.bundle.js");
const PARSE_SCRIPT = fs.existsSync(PARSE_BUNDLE)
  ? PARSE_BUNDLE
  : path.resolve(__dirname, "parse_workbook.js");

// Import tab (v5.3.28): requirements import (ReqIF, Excel, CSV), automatic review, trace and error report.
// Files are read in a temporary folder and deleted; nothing is kept on the server.
const IMPORT_SCRIPT=path.join(__dirname,"requirements_import.py");
const importUpload=multer({dest:path.join(os.tmpdir(),"isaf-import"),limits:{fileSize:50*1024*1024},fileFilter:(req,file,cb)=>{
  const ok=[".reqif",".reqifz",".xml",".xlsx",".xlsm",".csv"].includes(path.extname(file.originalname).toLowerCase());
  cb(ok?null:new Error("Use a ReqIF (.reqif, .reqifz), Excel (.xlsx) or CSV file."),ok);}});
app.post("/api/import/inspect",requireAuth,authorize("build.run"),requireFileImport,importUpload.single("file"),async(req,res)=>{
  if(!req.file)return res.status(400).json({error:"Choose a requirements file."});
  const named=req.file.path+path.extname(req.file.originalname).toLowerCase();
  try{fs.renameSync(req.file.path,named);
    const {stdout}=await execFileAsync(PYTHON_COMMAND,[IMPORT_SCRIPT,"inspect",named],{timeout:120000,maxBuffer:200*1024*1024});
    const data=JSON.parse(stdout);res.json({name:path.basename(req.file.originalname),...data});}
  catch(error){let message=error.message;try{message=JSON.parse(error.stdout||"{}").error||message;}catch{}res.status(400).json({error:`The file could not be read: ${message}`});}
  finally{fs.rm(named,{force:true},()=>{});fs.rm(req.file.path,{force:true},()=>{});}
});
app.get("/api/import/defaults",requireAuth,(req,res)=>res.json({levels:Object.fromEntries(Object.entries(REQUIREMENT_LEVELS).map(([k,v])=>[k,v.label])),options:REVIEW_DEFAULTS,documents:Object.keys(REQUIREMENT_TARGETS)}));
app.post("/api/import/review",requireAuth,authorize("build.run"),express.json({limit:"100mb"}),(req,res)=>{
  try{
    const files=Array.isArray(req.body?.files)?req.body.files:[];
    if(!files.length)return res.status(400).json({error:"Add at least one requirements file."});
    // The item comes from the row when an Item column is mapped (one DOORS module can carry several
    // software and hardware items), and from the file card otherwise. The card is the fallback for
    // rows that leave the column empty, not an override.
    const sets=files.map(f=>({level:REQUIREMENT_LEVELS[f.level]?f.level:"hlr",name:String(f.name||""),relations:Array.isArray(f.relations)?f.relations:[],requirements:normalizeRequirements(Array.isArray(f.objects)?f.objects:[],f.mapping||{},REQUIREMENT_LEVELS[f.level]?f.level:"hlr",String(f.name||"")).map(r=>({...r,item:(String(r.item||"").trim()||String(f.item||"").trim())}))}));
    const knownItems=Array.isArray(req.body?.items)?req.body.items.map(String):[];
    const result=reviewRequirements(sets,{...(req.body?.options||{}),knownItems});
    res.json({...result,meta:{program:String(req.body?.program||""),sources:files.map(f=>String(f.name||"")),generated:new Date().toISOString().replace("T"," ").slice(0,16)+" UTC",version:editionManifest().version||""}});
  }catch(error){res.status(400).json({error:error.message});}
});
// The requirements link: the reviewed import a program builds with. Saving one here is what makes a
// build write the requirements into its own documents, so the Import tab ends at a build rather than
// at a folder of documents to hand back. A hosted trial keeps nothing between sessions (storable
// false); there the browser holds the review and sends it with each build.
app.get("/api/import/link",requireAuth,(req,res)=>{
  try{
    const programId=String(req.query?.programId||"").trim();
    if(hostedTrial())return res.json({storable:false,reason:"This hosted app keeps nothing between sessions. The requirements stay in this browser and are sent with each build.",link:null});
    if(!programId)return res.json({storable:true,link:null});
    res.json({storable:true,link:requirementsLinkSummary(readRequirementsLink(repository,programId))||null});
  }catch(error){res.status(error.status||400).json({error:error.message});}
});
app.post("/api/import/link",requireAuth,authorize("build.run"),express.json({limit:"10mb"}),(req,res)=>{
  try{
    if(hostedTrial())return res.status(400).json({error:"This hosted app keeps nothing between sessions. The requirements stay in this browser and are sent with each build."});
    const programId=String(req.body?.programId||"").trim();
    if(!programId)return res.status(400).json({error:"Choose the program these requirements belong to."});
    const record=saveRequirementsLink(repository,programId,req.body?.review,requestActor(req,req.body?.actor));
    res.json({link:requirementsLinkSummary(record)});
  }catch(error){res.status(error.status||400).json({error:error.message});}
});
app.delete("/api/import/link",requireAuth,authorize("build.run"),express.json(),(req,res)=>{
  try{
    const programId=String(req.body?.programId||req.query?.programId||"").trim();
    if(!programId)return res.status(400).json({error:"Choose the program."});
    res.json({cleared:clearRequirementsLink(repository,programId)});
  }catch(error){res.status(error.status||400).json({error:error.message});}
});
app.post("/api/import/report",requireAuth,authorize("build.run"),express.json({limit:"100mb"}),async(req,res)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"isaf-import-report-")),input=path.join(dir,"review.json"),out=path.join(dir,"report.xlsx");
  try{fs.writeFileSync(input,JSON.stringify(req.body||{}));
    await execFileAsync(PYTHON_COMMAND,[IMPORT_SCRIPT,"report",input,out],{timeout:120000,maxBuffer:20*1024*1024});
    const program=String(req.body?.meta?.program||"Program").replace(/[^A-Za-z0-9_-]+/g,"_").slice(0,60);
    res.download(out,`ISAF_Requirements_Check_${program}_${new Date().toISOString().slice(0,10)}.xlsx`,()=>fs.rm(dir,{recursive:true,force:true},()=>{}));
  }catch(error){fs.rm(dir,{recursive:true,force:true},()=>{});res.status(500).json({error:`The report could not be written: ${error.message}`});}
});
// Put an import review into ISAF documents (Import tab → Update documents). Files are processed in memory and
// not kept. format=zip returns the updated documents and Import_Report.txt as a ZIP; otherwise JSON with the
// updated documents (base64) for the browser to write into the working folder.
const importDocsUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:25*1024*1024,files:300,fieldSize:100*1024*1024}});
// Editing documents that were already generated is an Admin capability (owner, v5.3.41). In a
// Customer or Demo app the imported requirements reach documents one way only: a build writes them
// in. The UI does not render the block there, and the route refuses it, so hiding it is a fact
// rather than an appearance.
const documentUpdateEdition=()=>appEdition()==="full";
app.post("/api/import/apply",requireAuth,authorize("build.run"),requireUpToDate,importDocsUpload.array("documents",300),async(req,res)=>{
  try{
    if(!documentUpdateEdition())return res.status(403).json({error:"Updating documents that were already generated is not part of this ISAF app. Attach the requirements in the Import tab and build: the build writes them into the documents it generates."});
    let review;try{review=JSON.parse(String(req.body?.review||""));}catch{return res.status(400).json({error:"Run the review first."});}
    if(!Array.isArray(review?.requirements))return res.status(400).json({error:"Run the review first."});
    const files=req.files||[];
    if(!files.length)return res.status(400).json({error:"Add the ISAF documents to update."});
    let paths=[];try{paths=JSON.parse(String(req.body?.paths||"[]"));}catch{}
    const results=files.map((f,i)=>{const name=String((Array.isArray(paths)&&typeof paths[i]==="string"&&paths[i])||f.originalname||"document.docx");try{return {name,...applyRequirementsImport(f.buffer,review)};}catch(error){return {name,changed:false,bytes:f.buffer,report:{blocks:[],edited:[],skipped:""},error:`could not be read (${error.message})`};}});
    const report=importReportText(results,review);
    // The copies of the documents this update replaces, and its report, are kept with the program as a support
    // record (owner, 22 November 2026) instead of an _ISAF_backup folder and Import_Report.txt in the user's folder.
    // Without a program register (hosted trial, or none loaded) the browser keeps its local copies as before.
    let recordKept=false;
    const programId=String(req.body?.programId||"");
    if(programId&&!hostedTrial()){
      try{
        const changed=results.filter(r=>r.changed),original=new Map(files.map((f,i)=>[results[i],f.buffer]));
        if(changed.length){await repository.addRecord(programId,{kind:"import",title:String(req.body?.title||"Import update").slice(0,200),actor:requestActor(req,req.body?.actor)||"ISAF user",files:[{name:"Import_Report.txt",bytes:Buffer.from(report)},...changed.map(r=>({name:`Replaced documents/${r.name}`,bytes:original.get(r),role:"replaced"}))]});recordKept=true;}
      }catch(error){accessLog(`Import update record not kept: ${error.message}`,req);}
    }
    if(String(req.query.format||req.body?.format||"")==="zip"){
      res.attachment(`ISAF_Import_Documents_${new Date().toISOString().slice(0,10)}.zip`);res.set("X-ISAF-Record-Kept",recordKept?"yes":"no");
      const archive=archiver("zip",{zlib:{level:6}});archive.on("error",error=>{if(!res.headersSent)res.status(500).json({error:error.message});else res.destroy(error);});
      archive.pipe(res);
      for(const r of results)if(r.changed)archive.append(r.bytes,{name:r.name.replace(/\\/g,"/").split("/").filter(p=>p&&p!=="."&&p!=="..").join("/")||"document.docx"});
      if(!recordKept)archive.append(report,{name:"Import_Report.txt"});
      return archive.finalize();
    }
    res.json({report,recordKept,results:results.map(r=>({name:r.name,changed:r.changed,code:r.report.code,item:r.report.item,blocks:r.report.blocks,rows:r.report.rows,edited:r.report.edited,skipped:r.report.skipped||r.error||"",data:r.changed?Buffer.from(r.bytes).toString("base64"):undefined}))});
  }catch(error){res.status(500).json({error:error.message});}
});
app.use("/api/intake",intakeRoutes({requireAuth,authorize,serviceDir:__dirname,parseScript:PARSE_SCRIPT,licensedValues,licensedProgramTypes:licensedProgramTypesFromEdition,newDefaults:()=>appEdition()==="customer"?CUSTOMER_DEFAULTS:null,warmNew:!process.env.ISAF_NO_INTAKE_WARM}));

// Configuration check: runs the build engine's validator on the configuration shown in the browser, so Config
// Data and the Build tab can show blocking problems before a build starts (same rules as the build).
// The browser reports when a key-protected app is opened (key entered, or page reopened with the remembered key).
// Who is using the app: the named user whose key unlocked it (blank for the company key or no key).
const whoami=req=>{const m=editionManifest();return {user:req.auth?.user?.name||"",userId:req.auth?.user?.id||"",company:m.customer_name||"",licenseId:m.license_id||"",userLevel:"Admin"};};
app.post("/api/access/opened", requireAuth, (req, res) => {
  if (API_KEY || API_KEY_HASH || ACCESS_KEYS.length) { accessLog(req.body?.remembered ? "App opened (remembered key)" : "App opened (access key accepted)", req); usageRecorder.record("app-opened", req.auth); }
  res.json({ ok: true, ...whoami(req) });
});
app.get("/api/whoami", requireAuth, (req, res) => res.json(whoami(req)));
// The customer's usage report (offline installs send it to MX Aero; Admin imports it in the Customers tab).
app.get("/api/usage/report", requireAuth, (req, res) => {
  if (!usageRecorder.enabled) return res.status(404).json({ error: "Usage records are kept in Customer apps only." });
  const m = editionManifest(), events = usageRecorder.report();
  res.attachment(`ISAF_Usage_Report_${String(m.customer_name || "Customer").replace(/[^A-Za-z0-9_-]+/g, "_")}_${new Date().toISOString().slice(0, 10)}.jsonl`).type("application/x-ndjson");
  res.send(events.map(e => JSON.stringify(e)).join("\n") + (events.length ? "\n" : ""));
});

// App updates in a Customer app (updates.js): what this user should see, a forced check ("Check for updates"),
// and this user's answer to the notice. A critical update cannot be skipped.
app.get("/api/update/status", requireAuth, (req, res) => res.json(updateClient.status(req.auth)));
app.post("/api/update/check", requireAuth, async (req, res) => {
  if (!updateClient.enabled) return res.json(updateClient.status(req.auth));
  await updateClient.check({ force: true });
  res.json(updateClient.status(req.auth));
});
app.post("/api/update/choice", requireAuth, express.json(), (req, res) => {
  try { res.json(updateClient.choose(req.auth, String(req.body?.action || "later"))); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});

app.post("/api/check-config", requireAuth, authorize("intake.write"), express.json({ limit: "25mb" }), (req, res) => {
  const data = req.body?.data;
  if (!data || typeof data !== "object") return res.status(400).json({ error: "No configuration data supplied." });
  try {
    let findings = validateConfiguration(structuredClone(data)).map(({ id, severity, message, hint }) => ({ id, severity, message, hint: hint || "" }));
    // Program logo: the build uses the logo file chosen on the Build tab instead of the workbook's Program Logo Path,
    // and a hosted site can never read a path on the user's computer. Match the build, and on a hosted site say what to do.
    if (req.body?.logoSelected) findings = findings.filter(f => f.id !== "V141");
    else if (HOSTED_SERVICE) findings = findings.map(f => f.id !== "V141" ? f : { ...f, message: "Program Logo Path is set in the workbook, but this hosted site cannot read files on your computer.", hint: "On the Build tab, under Program logo, select Choose File and pick the logo (or clear Program Logo Path in Config Data)." });
    res.json({ findings });
  } catch (err) {
    res.status(500).json({ error: "The configuration check could not run.", detail: err.message });
  }
});

app.post("/api/parse", requireAuth, authorize("intake.write"), upload.single("workbook"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No workbook file uploaded." });
  }

  const workbookPath = path.join(UPLOAD_DIR, `parse_${Date.now()}_${req.file.originalname}`);
  fs.renameSync(req.file.path, workbookPath);

  try {
    await enforceLicensedWorkbook(workbookPath);
    const { stdout } = await execFileAsync("node", [
      PARSE_SCRIPT, workbookPath,
    ], { timeout: 30_000, maxBuffer: 50 * 1024 * 1024 });

    const data = JSON.parse(stdout);
    res.json(data);
  } catch (err) {
    console.error("Parse failed:", err.message);
    res.status(500).json({ error: "Failed to parse workbook.", detail: [err.stderr, err.stdout].filter(Boolean).join("\n").slice(-12000) || err.message });
  } finally {
    setTimeout(() => fs.rm(workbookPath, { force: true }, () => {}), 2000);
  }
});

// Phase → folder mapping (which output folders to KEEP for each phase)
// null means keep everything in that folder; an array means keep only matching docs
const PHASE_FOLDERS = {
  codr:  { Plans: null },
  soi1:  { Plans: null, Standards: null, ConfigData: null, Reviews: "soi1" },
  pdr:   { Plans: null, Standards: null, LifecycleData: null, ConfigData: null, Reviews: "pdr" },
  soi2:  { Plans: null, Standards: null, LifecycleData: null, ConfigData: null, Hardware: null, Reviews: "soi2" },
  cdr:   { Plans: null, Standards: null, LifecycleData: null, ConfigData: null, Hardware: null, Reviews: "cdr" },
  soi3:  { Plans: null, Standards: null, LifecycleData: null, ConfigData: null, Hardware: null, Reviews: "soi3", ToolQual: null, Safety: null },
  soi4:  null, // everything
  all:   null, // everything
};

// Document-level filter for Reviews: which review docs belong to each phase
// Patterns are matched against filenames (case-insensitive)
const REVIEW_PHASE_DOCS = {
  soi1: [
    // SW plan/standards peer reviews
    "Peer_Review_PSAC", "Peer_Review_SDP", "Peer_Review_SVP",
    "Peer_Review_SCMP", "Peer_Review_SQAP",
    "Peer_Review_SRS", "Peer_Review_SDS", "Peer_Review_SCS",
    "Peer_Review_SMS", "Peer_Review_General_Planning",
    // HW plan/standards peer reviews
    "PR_PHAC", "PR_HDP", "PR_HVP", "PR_HCMP", "PR_HPAP",
    "PR_HRS", "PR_HDS", "PR_HVV",
    // System plan peer reviews
    "PR_PSCP", "PR_SEMP", "PR_SPAC", "PR_SysVP", "PR_SysValP",
    "PR_SysCMP", "PR_SysPAP", "PR_SysReqStd",
    // Transition checklists: planning gates
    "SW_Pre_SRR", "SW_SRR",
    "HW_SRR", "Sys_SRR",
  ],
  pdr: [
    // Requirements peer reviews
    "Peer_Review_SWRD", "PR_HRD",
    "Requirements_Review",
    // Safety: PSSA
    "PR_PSSA",
    // Transition checklists: requirements gates
    "SW_PDR", "HW_PDR", "Sys_PDR",
  ],
  soi2: [
    // Design peer reviews
    "Peer_Review_SDD", "Peer_Review_Design_Code",
    "Design_Review", "Code_Review",
    // Transition checklists: design gates
    "SW_CDR",
    "HW_CDR", "Sys_CDR",
  ],
  cdr: [
    // Verification peer reviews
    "Peer_Review_SVCP", "Peer_Review_SVR", "Peer_Review_STM",
    "Peer_Review_PDI", "PR_HTR",
    "Test_Procedure_Review", "Test_Results_Review", "Traceability_Review",
    // Transition checklists: test readiness gates
    "SW_TRR",
    "HW_TRR", "HW_VER",
    "Sys_TRR",
  ],
  soi3: [
    // Audit and conformity
    "Peer_Review_General_Audit",
    // Safety: SSA
    "PR_SSA",
    // Transition checklists: conformity gate
    "SW_SCR",
  ],
  soi4: [
    // Final docs peer reviews
    "Peer_Review_SAS", "Peer_Review_SCI", "Peer_Review_SECI",
    "PR_HAS", "PR_HCI", "PR_HECI",
    // Transition checklists: final certification gates
    "SW_FCR", "Sys_FCR",
  ],
};

// Each phase gets ONLY its own review documents (not cumulative).
// Transition checklists are one-time gates at their specific milestone.
// Peer reviews match the documents being produced in that phase.

/**
 * After a full build, remove files/folders that don't belong to the selected phase.
 * Returns the count of docs remaining.
 */
function applyPhaseFilter(outDir, phaseId) {
  const phaseConfig = PHASE_FOLDERS[phaseId];
  if (!phaseConfig) return null; // no filtering (all/soi4)

  const entries = fs.readdirSync(outDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderName = entry.name;
    const folderPath = path.join(outDir, folderName);

    if (!(folderName in phaseConfig)) {
      // Folder not in this phase at all — remove entirely
      fs.rmSync(folderPath, { recursive: true, force: true });
    } else if (phaseConfig[folderName] !== null) {
      // Folder is included but needs document-level filtering
      const reviewPhase = phaseConfig[folderName];
      const patterns = REVIEW_PHASE_DOCS[reviewPhase] || [];
      filterReviewDocs(folderPath, patterns);
    }
    // else: null means keep entire folder as-is
  }

  // Recount remaining docs
  let docCount = 0;
  function countDocs(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) countDocs(path.join(dir, e.name));
      else if (e.name.endsWith('.docx')) docCount++;
    }
  }
  countDocs(outDir);
  return docCount;
}

/**
 * Remove review docs that don't match any pattern for the phase.
 * Recurses into subdirectories (Peer/, Transition/, HW_Peer/, HW_Transition/).
 */
function filterReviewDocs(dir, patterns) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      filterReviewDocs(path.join(dir, entry.name), patterns);
      // Remove empty subdirectories
      try {
        const remaining = fs.readdirSync(path.join(dir, entry.name));
        if (remaining.length === 0) fs.rmdirSync(path.join(dir, entry.name));
      } catch { /* ignore */ }
    } else if (entry.name.endsWith('.docx')) {
      const matches = patterns.some(p => entry.name.includes(p));
      if (!matches) {
        fs.rmSync(path.join(dir, entry.name), { force: true });
      }
    }
  }
}

// Build endpoint for uploaded workbooks — outputs files to disk
// Background builds for hosted sites. Hosting proxies (for example Cloudflare in front of Render) close a
// request after about 100 seconds, which a build on a small instance can exceed. With async=1 the build
// route answers 202 {jobId} at once, runs the same work in the background and keeps its response; the
// browser polls GET /api/build-jobs/:id. Jobs live in memory: a server restart loses them (404).
const buildJobsInMemory=new Map();
function deferBuildResponse(req,res){
  if(!wantFlag(req.body?.async??req.query.async))return res;
  const id=crypto.randomUUID(),job={status:"running",http:200,body:null,organizationId:req.auth?.organizationId||null,started:Date.now(),controller:new AbortController()};
  req.buildSignal=job.controller.signal; // Stop build: POST /api/build-jobs/:id/cancel
  buildJobsInMemory.set(id,job);
  const finish=()=>{job.status="done";setTimeout(()=>buildJobsInMemory.delete(id),BUILD_DOWNLOAD_TTL_MS).unref?.();};
  res.status(202).json({jobId:id});
  return {status(code){job.http=code;return this;},json(body){job.body=body;finish();return this;},setHeader(){return this;},headersSent:false};
}
app.post("/api/build-jobs/:id/cancel",requireAuth,authorize("build.run"),(req,res)=>{
  const job=buildJobsInMemory.get(req.params.id);
  if(!job||(job.organizationId&&job.organizationId!==(req.auth?.organizationId||null)))return res.status(404).json({error:"This build is no longer running."});
  if(job.status==="running")job.controller.abort();
  res.json({ok:true,status:job.status});
});
app.get("/api/build-jobs/:id",requireAuth,authorize("build.run"),(req,res)=>{
  const job=buildJobsInMemory.get(req.params.id);
  if(!job||(job.organizationId&&job.organizationId!==(req.auth?.organizationId||null)))return res.status(404).json({error:"This build is no longer known to the server (it may have restarted). Run the build again."});
  if(job.status==="running")return res.json({status:"running",elapsed:Math.round((Date.now()-job.started)/1000)});
  res.json({status:"done",http:job.http,body:job.body});
});

app.post("/api/build", requireAuth, authorize("build.run"), requireUpToDate, upload.fields([{name:"workbook",maxCount:1},{name:"logo",maxCount:1},{name:"previous",maxCount:300}]), async (req,res)=>{
  res=deferBuildResponse(req,res);
  const workbookFile=req.files?.workbook?.[0],logoFile=req.files?.logo?.[0],previousFiles=req.files?.previous||[];
  const removePrevious=()=>{for(const f of previousFiles)fs.rm(f.path,{force:true},()=>{});};
  if(!workbookFile)removePrevious();
  if(!workbookFile)return res.status(400).json({error:'Choose a workbook.'});
  const unlicensed=phaseNotLicensed(req.body.phase||req.query.phase);
  if(unlicensed){fs.rm(workbookFile.path,{force:true},()=>{});if(logoFile)fs.rm(logoFile.path,{force:true},()=>{});removePrevious();return res.status(403).json({error:unlicensed});}
  if(appEdition()==="demo"&&!demoAllowedPhase(String(req.body.phase||req.query.phase||"all").toLowerCase())){
    fs.rm(workbookFile.path,{force:true},()=>{});if(logoFile)fs.rm(logoFile.path,{force:true},()=>{});removePrevious();
    return res.status(403).json({error:'Select one available Demo preview phase.'});
  }
  try{
    await enforceLicensedWorkbook(workbookFile.path);
    const storage=trialBuildStorage(req);let result;
    try{result = await runRepositoryBuild({store:storage.store,workbookPath:workbookFile.path,logoPath:logoFile?.path,phaseId:req.body.phase||req.query.phase||'all',outputBase:storage.outputBase,programId:storage.programId,actor:storage.actor,mode:req.body.mode,acknowledge:req.body.acknowledge,buildScript:BUILD_SCRIPT,parseScript:PARSE_SCRIPT,settingsPath:SETTINGS_PATH,phaseMap:PHASE_TO_MILESTONE,includeSourceWorkbook:appEdition()!=="demo",signal:req.buildSignal,allowedProgramTypes:licensedProgramTypesFromEdition(),valueTags:req.body?.valueTags===undefined?undefined:wantFlag(req.body.valueTags),timeZone:req.body?.timeZone||req.query?.timeZone,requirements:buildRequirements(req,storage),previous:previousFiles.map(f=>({name:path.basename(f.originalname),bytes:fs.readFileSync(f.path)}))});}
    catch(error){storage.fail?.();throw error;}
    storage.cleanup();
    // A hosted trial keeps nothing on the server, so a working folder keeps its own _ISAF_backup copies there.
    if(hostedTrial())result.recordKept=false;
    await applyOutputOptions(result,req);
    recordBuildUsage(req,result,result.phase||req.body?.phase||req.query?.phase);
    res.json(registerBuildDownload(result,req.auth));
  }catch(err){const failure=buildErrorResponse(err);res.status(err.status||failure.status).json(err.status?{error:err.message}:failure.body);}
  finally{fs.rm(workbookFile.path,{force:true},()=>{});if(logoFile)fs.rm(logoFile.path,{force:true},()=>{});removePrevious();}
});

// Error handler for multer
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, process.env.HOST || "0.0.0.0", () => {
  console.log(`ISAF Web Service running on http://localhost:${PORT}`);
  console.log(`Auth: ${authentication.mode === "oidc" ? "OIDC" : (ACCESS_KEYS.length ? `named user keys (${ACCESS_KEYS.length})${API_KEY_HASH?" and company key":""}` : API_KEY_HASH ? "customer access key" : API_KEY ? "API key" : "DISABLED (dev mode)")}`);
});
