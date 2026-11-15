// Optional processing of an exported build folder:
//  - DEMO watermark on the exported Word copies (the repository versions stay clean)
//  - PDF copies next to each Word file, converted with LibreOffice
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import PizZip from "../03_Build_Engine/node_modules/pizzip/js/index.js";
import {addDemoWatermark} from "./demo_watermark.js";
const exec = promisify(execFile);

export function listDocx(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listDocx(full));
    else if (entry.isFile() && /\.docx$/i.test(entry.name) && !entry.name.startsWith("~$")) out.push(full);
  }
  return out;
}

export function watermarkFolder(dir, text = "DEMO") {
  let count = 0;
  for (const file of listDocx(dir)) {
    const zip = new PizZip(fs.readFileSync(file));
    addDemoWatermark(zip, text);
    fs.writeFileSync(file, zip.generate({type: "nodebuffer", compression: "DEFLATE"}));
    count++;
  }
  return count;
}

export function findSoffice(environment = process.env) {
  const candidates = [
    environment.ISAF_SOFFICE,
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    "/usr/bin/soffice", "/usr/local/bin/soffice", "/opt/homebrew/bin/soffice", "/snap/bin/libreoffice",
  ].filter(Boolean);
  return candidates.find(file => { try { return fs.statSync(file).isFile(); } catch { return false; } }) || null;
}

// Word shows a header watermark washed out; LibreOffice prints it at full strength.
// PDFs are therefore made from a temporary copy whose watermark is semi-transparent,
// leaving the delivered Word file exactly as approved.
function pdfSource(file, tempDir) {
  const zip = new PizZip(fs.readFileSync(file));
  const headers = Object.keys(zip.files).filter(n => /^word\/header\d+\.xml$/.test(n));
  if (!headers.some(n => zip.file(n).asText().includes("ISAF_DEMO_WATERMARK"))) return file;
  for (const name of headers) {
    const xml = zip.file(name).asText();
    if (xml.includes("ISAF_DEMO_WATERMARK") && !xml.includes('<v:fill opacity="0.25"/>')) zip.file(name, xml.replace(/(alt="ISAF_DEMO_WATERMARK"[^>]*stroked="f">)/g, '$1<v:fill opacity="0.25"/>'));
  }
  const dir = fs.mkdtempSync(path.join(tempDir, "src-")), copy = path.join(dir, path.basename(file));
  fs.writeFileSync(copy, zip.generate({type: "nodebuffer", compression: "DEFLATE"}));
  return copy;
}

// Convert every Word file in the folder tree to PDF beside it. Uses a private
// LibreOffice profile so an open LibreOffice window on the computer is not affected.
export async function pdfFolder(dir, {timeoutMs = 60 * 60 * 1000} = {}) {
  const soffice = findSoffice();
  if (!soffice) throw Object.assign(new Error("PDF copies need LibreOffice (free, libreoffice.org). Install it, then build again. The Word documents were created normally."), {status: 424});
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "isaf-pdf-profile-"));
  const started = Date.now();
  let count = 0;
  try {
    const byFolder = new Map();
    for (const file of listDocx(dir)) { const folder = path.dirname(file); byFolder.set(folder, [...(byFolder.get(folder) || []), file]); }
    for (const [folder, files] of byFolder) {
      for (let i = 0; i < files.length; i += 40) {
        const batch = files.slice(i, i + 40), left = timeoutMs - (Date.now() - started), sources = batch.map(f => pdfSource(f, profile));
        if (left <= 0) throw Object.assign(new Error(`PDF conversion stopped after ${count} files because it took too long.`), {status: 504});
        await exec(soffice, ["--headless", "--norestore", `-env:UserInstallation=file://${profile.replace(/\\/g, "/")}`, "--convert-to", "pdf", "--outdir", folder, ...sources], {timeout: left, maxBuffer: 20 * 1024 * 1024});
        count += batch.filter(f => fs.existsSync(f.replace(/\.docx$/i, ".pdf"))).length;
      }
    }
  } finally { fs.rmSync(profile, {recursive: true, force: true}); }
  return {count, converter: "LibreOffice", seconds: Math.round((Date.now() - started) / 1000)};
}

// Apply the requested options to an export folder; failures in PDF conversion are
// reported without discarding the Word build.
export async function postprocessOutput(dir, {watermark = false, watermarkText = "DEMO", pdf = false} = {}) {
  const notes = [];
  if (!dir || !fs.existsSync(dir)) return notes;
  if (watermark) notes.push(`"${watermarkText}" watermark added to ${watermarkFolder(dir, watermarkText)} Word documents.`);
  if (pdf) {
    try { const r = await pdfFolder(dir); notes.push(`PDF copies created: ${r.count} (${r.converter}, ${r.seconds} s).`); }
    catch (error) { notes.push(`PDF copies not created: ${error.message}`); }
  }
  return notes;
}
