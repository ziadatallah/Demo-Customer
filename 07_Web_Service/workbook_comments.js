import path from 'node:path';
import fs from 'node:fs';
const engineering=JSON.parse(fs.readFileSync(new URL('./engineering-schema.json',import.meta.url),'utf8'));
import {itemColumn, fixedColumnsFor, programFieldAddress, readZip, parseSharedStrings, parseWorkbookSheetMap, parseSheet, decodeEntities, normalizeSpreadsheetXml} from '../03_Build_Engine/src/read_workbook.js';
import ITEM_SHEETS from './workbook-items.json' with { type: 'json' };
const scalar = {"program": {"sheet": "1. Program", "fields": {"customer_name": "C5", "customer_short_name": "C6", "name": "C7", "short_name": "C8", "type": "C11", "doc_prefix": "C12", "doc_revision": "C13", "target_authority_primary": "C16", "target_authority_secondary": "C17", "cert_basis_type": "C18", "cert_basis_part": "C19", "tso_category": "C20", "target_tc_date": "C23", "target_soi1_date": "C24", "target_soi2_date": "C25", "target_soi3_date": "C26", "target_soi4_date": "C27", "brand_color_primary": "C30", "brand_color_accent": "C31", "logo_path": "C32", "do160_in_scope": "C33", "do160_revision": "C34", "cert_regime": "C35", "export_control_marking": "C36", "distribution_statement": "C37", "company_name": "C38", "aircraft_category": "C39", "mtow_kg": "C40", "passenger_count": "C41", "document_retention_years": "C42", "target_pdr_date": "C43", "target_cdr_date": "C44", "target_trr_date": "C45", "target_first_flight_date": "C46", "target_eis_date": "C47", "annual_flight_hours": "C48", "target_codr_date": "C49"}}, "safety": {"sheet": "5. Safety", "fields": {"aircraft_fha_classification_max": "C5", "system_fha_classification_max": "C6", "failure_conditions_catastrophic": "C7", "failure_conditions_hazardous": "C8", "failure_conditions_major": "C9", "failure_conditions_minor": "C10", "cca_in_scope": "C13", "zsa_in_scope": "C14", "pra_in_scope": "C15", "particular_risks": "C16", "do254_appendix_b_in_scope": "C17"}}, "personnel": {"sheet": "2. Personnel", "fields": {"independence_mechanism": "C16", "independence_description": "C17"}}, "authority": {"sheet": "3. Authority", "fields": {"poc_secondary": "C8", "partnering_arrangement": "C11", "partnering_ref": "C12"}}};
const arrays = {"systems": {"sheet": "4. Systems", "fields": {"id": "A", "name": "B", "short_name": "C", "function_summary": "D", "fdal": "E", "idal_max": "F", "software_item_count": "G", "hardware_item_count": "H", "primary_supplier": "I", "pn": "J", "ata_chapter": "K"}, "end": 30}, "software_items": {"sheet": "6. Software Items", "fields": {"id": "A", "name": "B", "parent_system": "C", "dal": "D", "supplier": "E", "language": "F", "loc_estimate": "G", "formal_methods": "H", "notes": "I", "additional_documents": "J", "software_control_category": "K", "worst_case_severity": "L", "pn": "M"}, "end": 60}, "hardware_items": {"sheet": "7. Hardware Items", "fields": {"id": "A", "name": "B", "parent_system": "C", "dal": "D", "supplier": "E", "technology": "F", "complexity": "G", "notes": "H", "language": "I", "additional_documents": "J", "do160_applies": "K", "pn": "L"}, "end": 60}, "suppliers": {"sheet": "8. Suppliers", "fields": {"id": "A", "name": "B", "role": "C", "items_delivered": "D", "highest_dal": "E", "cert_lead_name": "F", "cert_lead_email": "G", "flow_down_signed": "H", "flow_down_date": "I", "flow_down_letter_signed": "H"}, "end": 50}, "tools": {"sheet": "9. Tools", "fields": {"id": "A", "name": "B", "vendor": "C", "intended_use": "D", "lifecycle_data_affected": "E", "qualification_required": "F", "tql": "G", "qualification_status": "H"}, "end": 60}};

// The three unit/item sections come from the shared layout, not from the literal above: that copy
// drifts the moment a column is added. Suppliers and Tools keep their own map, which is not shared.
for (const [name, spec] of Object.entries(ITEM_SHEETS.sheets))
  arrays[name] = {sheet: spec.sheet, fields: Object.fromEntries(spec.columns.map(c => [c[1], c[0]])), end: spec.endRow};

arrays.suppliers.fields={...arrays.suppliers.fields,country:'J',work_countries:'K',outside_us_percent:'L',percentage_basis:'M',oversight_notes:'N'};

for(const [key,spec]of Object.entries(engineering)){const target=key==='dev_environment'?scalar:arrays;target[key]={sheet:spec.sheet,fields:Object.fromEntries(spec.fields.map(f=>[f.key,f.column+(f.row||'')])),end:500};}

// Workbook comments are metadata for the editor, never engineering input values.
export function readWorkbookComments(filePath) {
  const files = readZip(filePath);
  const sheets = parseWorkbookSheetMap(files['xl/workbook.xml'].toString(), files['xl/_rels/workbook.xml.rels'].toString());
  const shared = parseSharedStrings(files['xl/sharedStrings.xml']);
  const fields = Object.create(null);
  function sheetData(name) {
    const file = sheets[name];
    if (!file) return {cells: {}, comments: {}};
    const cells = parseSheet(files[file], shared), comments = Object.create(null);
    const rel = path.posix.join(path.posix.dirname(file), '_rels', path.posix.basename(file)+'.rels');
    const xml = normalizeSpreadsheetXml(files[rel]?.toString() || '');
    for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const attr = m[1];
      if (!/Type="[^"]*\/comments"/.test(attr) || /TargetMode="External"/.test(attr)) continue;
      const target = /Target="([^"]+)"/.exec(attr)?.[1];
      if (!target) continue;
      const resolved = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeEntities(target)));
      const data = normalizeSpreadsheetXml(files[resolved]?.toString() || '');
      for (const c of data.matchAll(/<comment\b([^>]*)>([\s\S]*?)<\/comment>/g)) {
        const addr = /ref="([^"]+)"/.exec(c[1])?.[1];
        const text = [...c[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t=>decodeEntities(t[1])).join('');
        if (addr && text.trim()) comments[addr] = text;
      }
    }
    return {cells, comments};
  }
  for (const [section, spec] of Object.entries(scalar)) {
    const {comments,cells} = sheetData(spec.sheet);
    for (const [key, legacy] of Object.entries(spec.fields)) {
      const addr=section==='program'?programFieldAddress(cells,key,legacy):legacy;if(!addr)continue;
      const row = addr.replace(/[A-Z]/g, '');
      const text = comments[addr] || comments['B'+row] || comments['A'+row];
      if (text) fields[section+'.'+key] = text;
    }
  }
  {
    const {cells,comments}=sheetData('2. Personnel');
    const roles=['chief_engineer','cert_lead','lead_pm','systems_lead','safety_lead','software_lead','hardware_lead','process_assurance_lead','quality_lead','config_manager'];
    const modern=String(cells.E4).toLowerCase()==='title';
    for(const [key,col]of Object.entries({name:'C',email:'D',title:modern?'E':'F',signatory:modern?'F':'G'}))roles.forEach((role,i)=>{
      const note=comments[col+(i+5)]||comments[col+'4'];if(note)fields['personnel.'+role+'.'+key]=note;
    });
  }
  for (const [section, spec] of Object.entries(arrays)) {
    const {cells, comments} = sheetData(spec.sheet);
    for (const [key,legacy] of Object.entries(spec.fields)) {
      const col=itemColumn(cells,key,legacy,fixedColumnsFor(section));
      const header = comments[col+'4'] || comments[col+'5'];
      if (header) fields[section+'.'+key] = header;
      let index = 0;
      for (let row=6;row<=spec.end;row++) {
        if (!cells['A'+row] || !String(cells['A'+row]).trim()) continue;
        if (comments[col+row]) fields[section+'['+index+'].'+key] = comments[col+row];
        index++;
      }
    }
  }
  {
    const {cells,comments}=sheetData('16. Program Intake');
    const modern=cells.B4==='Field Key';
    for(let r=5;r<=100;r++){
      const key=cells[(modern?'B':'A')+r];if(!key)continue;
      const note=comments[(modern?'C':'B')+r]||cells['D'+r];
      if(note)fields['intake.'+String(key).replace(/^intake\./,'')]=note;
    }
  }
  return fields;
}
