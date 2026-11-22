#!/usr/bin/env python3
"""
Save modified ISAF config data back to a new .xlsx workbook.

Usage: echo '{"source":"path/to/original.xlsx","modifications":{"program.name":"NewName",...}}' | python3 save_config.py

Copies the original workbook, applies the modifications, and saves
to a new file with a _v<N> suffix. Outputs the new file path to stdout.
"""

import sys
import json
import os
import re
from copy import copy
from datetime import datetime

import openpyxl

def find_next_version(original_path):
    """Find the next available version number for the output file."""
    base, ext = os.path.splitext(original_path)
    # Strip existing _v<N> suffix if present
    base = re.sub(r'_v\d+$', '', base)
    for n in range(1, 1000):
        candidate = f"{base}_v{n}{ext}"
        if not os.path.exists(candidate):
            return candidate
    return f"{base}_v{datetime.now().strftime('%Y%m%d%H%M%S')}{ext}"

# Sheet name → config path mapping
SHEET_MAP = {
    '1. Program':        'program',
    '2. Personnel':      'personnel',
    '3. Authority':      'authority',
    '4. Systems':        'systems',
    '5. Safety':         'safety',
    '6. Software Items': 'software_items',
    '7. Hardware Items':  'hardware_items',
    '8. Suppliers':      'suppliers',
    '9. Tools':          'tools',
}

FIELD_MAP = {'program': {'sheet': '1. Program', 'fields': {'customer_name': 'C5', 'customer_short_name': 'C6', 'name': 'C7', 'short_name': 'C8', 'type': 'C11', 'doc_prefix': 'C12', 'doc_revision': 'C13', 'target_authority_primary': 'C16', 'target_authority_secondary': 'C17', 'cert_basis_type': 'C18', 'cert_basis_part': 'C19', 'tso_category': 'C20', 'target_tc_date': 'C23', 'target_soi1_date': 'C24', 'target_soi2_date': 'C25', 'target_soi3_date': 'C26', 'target_soi4_date': 'C27', 'brand_color_primary': 'C30', 'brand_color_accent': 'C31', 'logo_path': 'C32', 'do160_in_scope': 'C33', 'do160_revision': 'C34', 'cert_regime': 'C35', 'export_control_marking': 'C36', 'distribution_statement': 'C37', 'company_name': 'C38', 'aircraft_category': 'C39', 'mtow_kg': 'C40', 'passenger_count': 'C41', 'document_retention_years': 'C42', 'security_assurance_level': 'C21', 'no_end_user': 'C63', 'purchaser_name': 'C60', 'purchaser_address': 'C61', 'contract_number': 'C62', 'target_pdr_date': 'C43', 'target_cdr_date': 'C44', 'target_trr_date': 'C45', 'target_first_flight_date': 'C46', 'target_eis_date': 'C47', 'annual_flight_hours': 'C48', 'target_codr_date': 'C49'}}, 'safety': {'sheet': '5. Safety', 'fields': {'aircraft_fha_classification_max': 'C5', 'system_fha_classification_max': 'C6', 'failure_conditions_catastrophic': 'C7', 'failure_conditions_hazardous': 'C8', 'failure_conditions_major': 'C9', 'failure_conditions_minor': 'C10', 'cca_in_scope': 'C13', 'zsa_in_scope': 'C14', 'pra_in_scope': 'C15', 'particular_risks': 'C16', 'do254_appendix_b_in_scope': 'C17'}}, 'personnel': {'sheet': '2. Personnel', 'fields': {'independence_mechanism': 'C16', 'independence_description': 'C17'}}, 'authority': {'sheet': '3. Authority', 'fields': {'poc_secondary': 'C8', 'partnering_arrangement': 'C11', 'partnering_ref': 'C12'}}, 'systems': {'sheet': '4. Systems', 'fields': {'id': 'A', 'name': 'B', 'short_name': 'C', 'function_summary': 'D', 'fdal': 'E', 'idal_max': 'F', 'software_item_count': 'G', 'hardware_item_count': 'H', 'primary_supplier': 'I', 'pn': 'J', 'ata_chapter': 'K'}, 'end': 30}, 'software_items': {'sheet': '6. Software Items', 'fields': {'id': 'A', 'name': 'B', 'parent_system': 'C', 'dal': 'D', 'supplier': 'E', 'language': 'F', 'loc_estimate': 'G', 'formal_methods': 'H', 'notes': 'I', 'additional_documents': 'J', 'software_control_category': 'K', 'worst_case_severity': 'L', 'pn': 'M'}, 'end': 60}, 'hardware_items': {'sheet': '7. Hardware Items', 'fields': {'id': 'A', 'name': 'B', 'parent_system': 'C', 'dal': 'D', 'supplier': 'E', 'technology': 'F', 'complexity': 'G', 'notes': 'H', 'language': 'I', 'additional_documents': 'J', 'do160_applies': 'K', 'pn': 'L'}, 'end': 60}, 'suppliers': {'sheet': '8. Suppliers', 'fields': {'id': 'A', 'name': 'B', 'role': 'C', 'items_delivered': 'D', 'highest_dal': 'E', 'cert_lead_name': 'F', 'cert_lead_email': 'G', 'flow_down_signed': 'H', 'flow_down_date': 'I', 'flow_down_letter_signed': 'H'}, 'end': 50}, 'tools': {'sheet': '9. Tools', 'fields': {'id': 'A', 'name': 'B', 'vendor': 'C', 'intended_use': 'D', 'lifecycle_data_affected': 'E', 'qualification_required': 'F', 'tql': 'G', 'qualification_status': 'H'}, 'end': 60}}

# The unit and item sheet layouts above are replaced by the shared map in workbook-items.json, which
# read_workbook.js and read_workbook.py read too. They used to be written out by hand in all three
# and had drifted: read_workbook.py was missing do160_applies, software_control_category and
# worst_case_severity. Defining them once is what makes a new item column a single edit.
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'workbook-items.json'), encoding='utf-8') as _f:
    ITEM_SHEETS = json.load(_f)
for _name, _spec in ITEM_SHEETS['sheets'].items():
    FIELD_MAP[_name] = {'sheet': _spec['sheet'],
                        'fields': {c[1]: c[0] for c in _spec['columns']},
                        'end': _spec['endRow']}

# Item columns added after the PN shim keep the same letter with PN in column C and without it, so
# they never ride on the shift below. The map is PER SHEET, because ata_chapter sits at a different
# letter on each (K / N / M) and a global map would collide with software_control_category and
# do160_applies at K. fixed_item_columns(section) is the accessor; callers that handle one section
# at a time pass its own map.
FIXED_ITEM_COLUMNS_BY_SHEET = {n: s.get('fixedColumns', {}) for n, s in ITEM_SHEETS['sheets'].items()}


def fixed_item_columns(section):
    """Fixed-letter columns for one sheet. {} for a sheet that has none."""
    return FIXED_ITEM_COLUMNS_BY_SHEET.get(section, {})
FIELD_MAP['program']['fields']['ata_chapter'] = 'C14'  # located by its program.ata_chapter key when present
# The IANA time zone that dates documents. Located by its program.time_zone key like the rest;
# C49 is the fallback for a workbook written before the key row existed.
FIELD_MAP['program']['fields']['time_zone'] = 'C49'
FIELD_MAP['suppliers']['fields'].update({'country':'J','work_countries':'K','outside_us_percent':'L','percentage_basis':'M','oversight_notes':'N'})

from engineering_workbook import SCHEMA as ENGINEERING_SCHEMA, ensure_engineering
for section,spec in ENGINEERING_SCHEMA.items():
    FIELD_MAP[section]={'sheet':spec['sheet'],'fields':{f['key']:f['column']+str(f['row']) if 'row' in f else f['column'] for f in spec['fields']}}
    if section!='dev_environment':FIELD_MAP[section]['end']=500

def apply_modifications(wb, modifications):
    from workbook_layout import normalize_workbook,ensure_document_pns
    normalize_workbook(wb)
    ensure_engineering(wb)
    from intake_workbook import supplier_headers,save_intake,read_intake
    supplier_headers(wb)
    save_intake(wb,read_intake(wb))
    """Use the same cell addresses and nonblank-ID rows as the workbook reader."""
    applied = 0
    # Structural edits apply before cell edits. Existing save requests do not include these keys.
    if '_intakeRows' in modifications:
        from intake_workbook import replace_rows
        if not isinstance(modifications['_intakeRows'],dict):raise ValueError('Invalid item tables')
        for section, rows in modifications['_intakeRows'].items():replace_rows(wb,section,rows)
        applied += 1
    if '_intake' in modifications:
        save_intake(wb,modifications['_intake']);applied += 1
    if '_documentPNs' in modifications:
        ensure_document_pns(wb,modifications['_documentPNs']);applied += 1
    for mod_path, value in modifications.items():
        if mod_path in ['_intakeRows','_intake','_documentPNs']:continue
        if mod_path.startswith('intake.'):
            from intake_workbook import save_intake
            existing=read_intake(wb)
            existing[mod_path[7:]]=value;save_intake(wb,existing);applied+=1;continue
        if mod_path=='_openDecisions':
            from open_decisions import save_open_decisions
            save_open_decisions(wb,value)
            applied += 1
            continue
        if mod_path == 'program.doc_prefix' and str(value or '').strip().upper() == 'TBD':
            value = ''
        if isinstance(value, bool):
            value = 'Yes' if value else 'No'
        nested = re.fullmatch(r'personnel\.(\w+)\.(name|email|title|signatory)', mod_path)
        if nested:
            role, key = nested.groups()
            roles = ['chief_engineer','cert_lead','lead_pm','systems_lead','safety_lead','software_lead','hardware_lead','process_assurance_lead','quality_lead','config_manager']
            if role in roles:
                wb['2. Personnel'].cell(5 + roles.index(role), {'name':3,'email':4,'title':5,'signatory':6}[key], value)
                applied += 1
            continue
        contact = re.fullmatch(r'authority\.poc_primary\.(name|email|organization)', mod_path)
        if contact:
            wb['3. Authority']['C' + str({'name':5,'email':6,'organization':7}[contact.group(1)])] = value
            applied += 1
            continue
        issue = re.fullmatch(r'authority\.items\[(\d+)\]\.(type|ref|title|description|status)', mod_path)
        if issue:
            index, key = issue.groups()
            ws = wb['3. Authority']
            rows = [row for row in range(17,51) if ws.cell(row,1).value is not None and str(ws.cell(row,1).value).strip()]
            if int(index) < len(rows):
                ws.cell(rows[int(index)], {'type':1,'ref':2,'title':3,'description':4,'status':5}[key], value)
                applied += 1
            continue
        m = re.fullmatch(r'(\w+)(?:\[(\d+)\])?\.(\w+)', mod_path)
        if not m:
            continue
        section, index, key = m.groups()
        spec = FIELD_MAP.get(section)
        if not spec or key not in spec['fields'] or spec['sheet'] not in wb.sheetnames:
            continue
        ws = wb[spec['sheet']]
        target = spec['fields'][key]
        if section == 'program':
            matches = [r for r in range(1,ws.max_row+1) if ws.cell(r,2).value == 'program.'+key]
            # No key row means the value cannot be read back, because the reader locates program
            # fields by key. Writing to the legacy address anyway reported a successful save and
            # silently lost the edit, and 24 of those addresses no longer match the current
            # layout, so the write could land on a different field. normalize_workbook restores a
            # missing key row before we get here; if one is still absent, skip the edit so it is
            # counted as not applied and the app warns instead of claiming success.
            if not matches: continue
            target = 'C'+str(matches[0])
        if index is not None:
            if section in ['systems','software_items','hardware_items'] and str(ws['C5'].value).endswith('.pn'):
                target = fixed_item_columns(section).get(key) or ('C' if key=='pn' else chr(ord(target)+1) if target>='C' else target)
            rows = [row for row in range(6, spec['end']+1) if any(ws[f'{col}{row}'].value is not None and str(ws[f'{col}{row}'].value).strip() for col in (spec['fields'].values() if section.startswith('environmental_') else ['A']))]
            if int(index) >= len(rows):
                continue
            target += str(rows[int(index)])
        elif 'end' in spec:
            continue
        # parent_system is a list of unit ids: one software load installed in two LRUs is one
        # certified item, not two rows. A list reaches a cell as a comma-separated string, the same
        # shape read_workbook splits back apart and the same one items_delivered already uses.
        # openpyxl rejects a list outright, so without this the save failed rather than misbehaving.
        if isinstance(value, (list, tuple)):
            value = ', '.join(str(v).strip() for v in value if str(v).strip())
        ws[target] = value
        applied += 1
    return applied

def main():
    data = json.load(sys.stdin)
    source_path = data['source']
    modifications = data.get('modifications', {})

    if not os.path.exists(source_path):
        print(json.dumps({"error": f"Source file not found: {source_path}"}))
        sys.exit(1)

    # Copy and modify
    wb = openpyxl.load_workbook(source_path)
    applied = apply_modifications(wb, modifications)
    from workbook_layout import normalize_workbook
    normalize_workbook(wb)

    # Save to new versioned file
    destination = data.get('output_dir')
    if destination:
        os.makedirs(destination, exist_ok=True)
    if data.get('exact_name') and destination:
        # Save As: write exactly the file the user named (the dialog already confirmed any overwrite).
        output_path = os.path.join(destination, os.path.basename(data['output_name']))
    else:
        output_path = find_next_version(os.path.join(destination, os.path.basename(data.get('output_name') or source_path)) if destination else source_path)
    # Write a temporary copy first and then replace the file, so a save that fails part-way (Save
    # Configuration Workbook overwrites the loaded workbook, owner 21 November 2026) never leaves a
    # damaged workbook in place of the user's file.
    partial = output_path + '.isaf-saving'
    try:
        wb.save(partial)
        os.replace(partial, output_path)
    finally:
        if os.path.exists(partial):
            os.remove(partial)

    print(json.dumps({
        "output": output_path,
        "applied": applied,
        "total_modifications": len(modifications),
    }))

if __name__ == "__main__":
    main()
