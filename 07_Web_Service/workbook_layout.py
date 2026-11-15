"""Maintain the configuration workbook layout when saving from the app.

Program values are located by field keys. Legacy addresses are fallback only.
Item PNs are user-controlled values and are never allocated by this module.
"""
import json,re
from copy import copy,deepcopy
from pathlib import Path
from openpyxl.styles import Font,PatternFill,Border,Side,Alignment
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.comments import Comment

HERE=Path(__file__).parent
SPEC=json.loads((HERE/'config-layout.json').read_text())
COLORS=json.loads((HERE/'config-palette.json').read_text())
PN_SHEET='17. Document PNs'
PN_SCALARS=[
    ('Scheme Name','name','Program document numbering'),
    ('Document Prefix','prefix','PREFIX'),
    ('Preview Discipline','program','SYS'),
    ('Separator','separator','-'),
    ('Segment Order','order','prefix-program-type-sequence'),
    ('Sequence Length','digits',5),
    ('Starting Number','start',1),
    ('Sequence Scope','scope','per-type'),
    ('Document Type Codes','types','PLN, PROC, WI, STD, SPEC, RPT, CHK, FRM, MIN, REG, POL'),
    ('Revision Format','revision','letters'),
    ('Initial Revision','initialRevision','A'),
]
PN_TYPES=[
    ('PLN','Plan','Project plan, SDP, PSAC, configuration management plan'),
    ('PROC','Procedure','CCB process, document control, purchasing procedure'),
    ('WI','Work instruction','Inspection steps, assembly instructions, tool setup'),
    ('STD','Standard','Coding standard, drawing standard, engineering rules'),
    ('SPEC','Specification','System requirements, interface or procurement specification'),
    ('RPT','Report / assessment','Test report, safety assessment, internal audit report'),
    ('CHK','Checklist','Peer review, release readiness, inspection checklist'),
    ('FRM','Form','Change request, approval record, training form'),
    ('MIN','Meeting minutes','CCB decisions, design review minutes, team meeting record'),
    ('REG','Register / log','Document register, risk register, action log'),
    ('POL','Policy','Quality policy, records retention policy'),
]
TARGETS={key:row for _,_,fields in SPEC['groups'] for row,key in fields}
LABELS={'customer_name':'Company Name','customer_short_name':'Company Short Name','name':'Program Name','short_name':'Program Short Name','type':'Program Type','doc_prefix':'Document Prefix','doc_revision':'Document Revision','brand_color_primary':'Primary Color','brand_color_accent':'Accent Color','target_tc_date':'Target Certification / Authorization Date','tso_category':'Applicable TSO / ETSO'}
REQUIRED=set(SPEC['required'])
def title(key):
    return ' '.join({'soi1':'SOI 1','soi2':'SOI 2','soi3':'SOI 3','soi4':'SOI 4','codr':'CoDR','pdr':'PDR','cdr':'CDR','trr':'TRR','eis':'EIS','mtow':'MTOW','kg':'kg','do160':'DO-160','tso':'TSO','tc':'TC','ata':'ATA','pn':'P/N','dal':'DAL','fdal':'FDAL','idal':'IDAL'}.get(w,w.title()) for w in key.split('_'))
def color_name(value):
    s=str(value or '').lstrip('#')
    return next((k for k,v in COLORS.items() if s.lower() in [k.lower(),v.lower()]),value)
def normalize_workbook(wb):
    normalize_personnel(wb)
    ws=wb['1. Program'];already=ws['B3'].value=='isaf.program_layout.v3'
    found={str(ws.cell(r,2).value)[8:]:r for r in range(1,ws.max_row+1) if str(ws.cell(r,2).value).startswith('program.')}
    if not already:
        # Every spec field, not only the ones with a legacy address: a field absent from this map
        # had its value erased by the migration, because it never reached `values` below. Keys
        # found in column B always win; a legacy address is used only for a workbook that has
        # never been stamped, where there are no keys to find.
        stamped=str(ws['B3'].value or '').startswith('isaf.program_layout.')
        def _legacy_row(k):
            if stamped or k=='target_codr_date' or k not in SPEC['legacy']:return None
            return int(SPEC['legacy'][k][1:])
        source={k:found.get(k,_legacy_row(k)) for _,_,fields in SPEC['groups'] for _,k in fields}
        values={k:(ws.cell(r,3).value if r else None) for k,r in source.items()};comments={k:(copy(ws.cell(r,3).comment) if r else None) for k,r in source.items()}
        rowmap={r:TARGETS[k] for k,r in source.items() if r}
        def refs(value):return re.sub(r"('1\. Program'!\$?C\$?)(\d+)",lambda m:m[1]+str(rowmap.get(int(m[2]),int(m[2]))),value)
        for sheet in wb:
            if sheet is ws:continue
            for row in sheet:
                for c in row:
                    if c.data_type=='f':c.value=refs(c.value)
        for name in wb.defined_names.values():
            if name.attr_text:name.attr_text=refs(name.attr_text)
        for area in list(ws.merged_cells.ranges):ws.unmerge_cells(str(area))
        for row in ws:
            for c in row:c.value=None;c.comment=None;c._style=None
        ws.data_validations.dataValidation=[]
        ws.conditional_formatting._cf_rules.clear()
        for r in range(1,58):ws.row_dimensions[r].height=28;ws.row_dimensions[r].hidden=False
        for col,width in {'A':38,'B':39,'C':53,'D':23,'E':25}.items():ws.column_dimensions[col].width=width
        for r,text in [(1,'Program Metadata'),(2,'Enter company and program data in the green cells. Requirements are listed in the final column.')]:
            ws.merge_cells(start_row=r,start_column=1,end_row=r,end_column=5);ws.cell(r,1,text);ws.cell(r,1).font=Font(name='Arial',size=16 if r==1 else 10,bold=r==1,color='1F3A5F' if r==1 else '666666')
        ws['B3']='isaf.program_layout.v3'
        line=Side(style='thin',color='CCD3DA')
        for header,text,fields in SPEC['groups']:
            ws.merge_cells(start_row=header,start_column=1,end_row=header,end_column=5);c=ws.cell(header,1,text);c.fill=PatternFill('solid',fgColor='1F3A5F');c.font=Font(name='Arial',size=11,bold=True,color='FFFFFF')
            for r,k in fields:
                requirement='Required' if k in REQUIRED else 'Required For Aircraft' if k=='cert_basis_part' else 'Optional'
                rowvalues=[LABELS.get(k,title(k)),'program.'+k,values.get(k),'Aircraft' if k in ['cert_basis_part','mtow_kg','passenger_count'] else 'All Programs',requirement]
                for col,value in enumerate(rowvalues,1):
                    cell=ws.cell(r,col,value);cell.font=Font(name='Arial',size=9 if col==2 else 11,bold=col==1,color='777777' if col==2 else 'C00000' if col==5 and k in REQUIRED else '000000');cell.alignment=Alignment(wrap_text=True,vertical='center');cell.border=Border(left=line,right=line,top=line,bottom=line)
                ws.cell(r,3).fill=PatternFill('solid',fgColor='E2EFD9');ws.cell(r,3).comment=comments.get(k)
                ws.row_dimensions[r].height=max(28,((len(str(values.get(k) or ''))+53)//54)*14+8)
        ws.freeze_panes='A5';ws.sheet_view.showGridLines=False
        validations={'type':['AIRCRAFT','SYSTEM','LRU'],'target_authority_primary':['FAA','EASA','TCCA','ANAC','CAAC','OTHER'],'cert_basis_type':['TC','STC','TSO','ETSO','PMA','OTHER'],'cert_regime':['CIVIL','MILITARY'],'do160_in_scope':['Yes','No']}
        for k,options in validations.items():
            dv=DataValidation(type='list',formula1='"'+','.join(options)+'"',allow_blank=True);ws.add_data_validation(dv);dv.add('C'+str(TARGETS[k]))
    # Program values are located by their key in column B, and the key column is written only by
    # the one-time migration above. A field added to the layout AFTER a workbook reached v3 has no
    # key row, so the reader cannot see it however it is saved: save_config falls back to a legacy
    # address, the value lands in a cell nothing reads, and the field appears to be dropped on
    # every save. Restore any missing key row here. Only a row whose key cell is empty is filled,
    # so a workbook laid out differently from the spec is left for a full migration instead of
    # having another field's key overwritten.
    present={str(ws.cell(r,2).value)[8:] for r in range(1,ws.max_row+1) if str(ws.cell(r,2).value).startswith('program.')}
    keyline=Side(style='thin',color='CCD3DA')
    for _,_,fields in SPEC['groups']:
        for r,k in fields:
            if k in present or str(ws.cell(r,2).value or '').strip():continue
            cell=ws.cell(r,2,'program.'+k)
            cell.font=Font(name='Arial',size=9,color='777777');cell.alignment=Alignment(wrap_text=True,vertical='center')
            cell.border=Border(left=keyline,right=keyline,top=keyline,bottom=keyline)
            ws.cell(r,3).fill=PatternFill('solid',fgColor='E2EFD9')
    for k in ['brand_color_primary','brand_color_accent']:
        addr='C'+str(TARGETS[k]);ws[addr]=color_name(ws[addr].value)
        ws[addr].comment=Comment("Choose a basic named color for document branding. The app resolves the selected color for document formatting.","ISAF")
        # Remove an existing validation on this scalar before applying the palette.
        for dv in list(ws.data_validations.dataValidation):
            if addr in dv:dv.ranges.remove(addr) if str(dv.sqref)!=addr else ws.data_validations.dataValidation.remove(dv)
        dv=DataValidation(type='list',formula1='"'+','.join(COLORS)+'"',allow_blank=True);ws.add_data_validation(dv);dv.add(addr)
    for r in [3,55,56,57]:ws.row_dimensions[r].hidden=True
    for r,k in [(r,k) for _,_,fields in SPEC['groups'] for r,k in fields]:
        ws.cell(r,1,LABELS.get(k,title(k)))
        ws.cell(r,5,'Required' if k in REQUIRED else 'Required For Aircraft' if k=='cert_basis_part' else 'Optional')
        if k=='target_codr_date': ws.cell(r,3).comment=Comment('Planned Conceptual Design Review date. Enter YYYY-MM-DD or Not applicable: reason. Available to program scheduling templates.','ISAF')
    ensure_document_pns(wb)
    for name,col in SPEC['pnColumns'].items():
        sheet=wb[name];move_pn_after_name(sheet, {'4. Systems':'J','6. Software Items':'M','7. Hardware Items':'L'}[name]);sheet[col+'4']='PN';sheet[col+'5']={'4. Systems':'sys.pn','6. Software Items':'sw.pn','7. Hardware Items':'hw.pn'}[name]
        sheet[col+'4'].font=Font(name='Arial',size=11,bold=True,color='FFFFFF');sheet[col+'4'].fill=PatternFill('solid',fgColor='1F3A5F');sheet.column_dimensions[col].width=26
        sheet[col+'4'].comment=Comment('Required: company-assigned item PN, separate from item ID and document PN. Used in configuration index and identification documents.','ISAF')
        for r in range(6,31 if name=='4. Systems' else 61):sheet[col+str(r)].fill=PatternFill('solid',fgColor='E2EFD9');sheet[col+str(r)].alignment=Alignment(wrap_text=True,vertical='center')
    ensure_system_ata(wb)

def ensure_system_ata(wb):
    """Add the per-system ATA chapter column (always K, after the PN columns) to an older workbook.

    Also repairs a workbook written by the intake between 11 Nov 2026 and this fix, which put the
    ATA chapter in column L because the intake's own copy of the PN shim shifted it. The value is
    moved back to K and the stray column removed.

    The intake wrote data rows only, never a header, so L5 is empty in a damaged workbook and the
    key test below never matched: values typed in Program Intake stayed stranded in L and were
    never recovered. The Systems sheet defines columns A to K only, so any value in L is either
    that stray ATA chapter or not ISAF data; either way it does not belong there, and it is moved
    into K where K is empty rather than left where no reader looks.
    """
    sheet=wb['4. Systems']
    header_present=str(sheet['K5'].value or '').strip() in ('system.ata_chapter','sys.ata_chapter')
    stray_header=str(sheet['L5'].value or '').strip()
    if stray_header in ('systems.ata_chapter','sys.ata_chapter') or (
            header_present and not stray_header and any(
                sheet['L'+str(r)].value not in (None,'') for r in range(6,31))):
        for r in range(6,31):
            stray=sheet['L'+str(r)].value
            if stray not in (None,'') and sheet['K'+str(r)].value in (None,''):
                sheet['K'+str(r)]=stray
            sheet['L'+str(r)]=None
        sheet['L4']=None;sheet['L5']=None
    if str(sheet['K5'].value or '').strip() in ('system.ata_chapter','sys.ata_chapter'):return
    sheet['K4']='ATA Chapter';sheet['K5']='system.ata_chapter'
    sheet['K4'].font=Font(name='Arial',size=11,bold=True,color='FFFFFF');sheet['K4'].fill=PatternFill('solid',fgColor='1F3A5F')
    sheet.column_dimensions['K'].width=14
    sheet['K4'].comment=Comment('Optional: ATA chapter for this system or LRU (for example 24 for Electrical Power, 34 for Navigation). Used on item-scope document covers; the program ATA chapter applies where this is blank.','ISAF')
    for r in range(6,31):sheet['K'+str(r)].fill=PatternFill('solid',fgColor='E2EFD9');sheet['K'+str(r)].alignment=Alignment(wrap_text=True,vertical='center')

def _program_value(wb,key,default=''):
    ws=wb['1. Program']
    for row in range(1,ws.max_row+1):
        if ws.cell(row,2).value=='program.'+key:return ws.cell(row,3).value or default
    return default

def _intake_value(wb,key,default=''):
    if '16. Program Intake' not in wb.sheetnames:return default
    ws=wb['16. Program Intake']
    key='intake.'+key
    for row in range(1,ws.max_row+1):
        if ws.cell(row,2).value==key:return ws.cell(row,3).value or default
    return default

def ensure_document_pns(wb,settings=None):
    """Create/update the program-owned Document PNs sheet."""
    created=PN_SHEET not in wb.sheetnames
    ws=wb.create_sheet(PN_SHEET) if created else wb[PN_SHEET]
    existing={str(ws.cell(row,2).value or '').strip():ws.cell(row,3).value for row in range(5,20) if str(ws.cell(row,2).value or '').strip()}
    if created:
        ws.sheet_view.showGridLines=False
        ws.freeze_panes='A5'
        ws.column_dimensions['A'].width=27;ws.column_dimensions['B'].width=31;ws.column_dimensions['C'].width=76
        ws.merge_cells('A1:C1');ws['A1']='Document PN Schema';ws['A1'].font=Font(name='Arial',size=16,bold=True,color='1F3A5F')
        ws.merge_cells('A2:C2');ws['A2']='Program-specific document numbering settings. Green cells are configurable; prefix and revision remain synchronized with Program.';ws['A2'].font=Font(name='Arial',size=10,color='666666');ws['A2'].alignment=Alignment(wrap_text=True)
        ws['B3']='isaf.document_pns.v2';ws.row_dimensions[3].hidden=True
        for col,value in enumerate(['Setting','Field Key','Value'],1):ws.cell(4,col,value)
        for col,value in enumerate(['Code','Meaning','Examples / Intended Use'],1):ws.cell(20,col,value)
        for row in [4,20]:
            for cell in ws[row]:cell.fill=PatternFill('solid',fgColor='1F3A5F');cell.font=Font(name='Arial',size=11,bold=True,color='FFFFFF');cell.alignment=Alignment(wrap_text=True,vertical='center')
        for i,(label,key,default) in enumerate(PN_SCALARS,5):
            ws.cell(i,1,label);ws.cell(i,2,key);ws.cell(i,3,default)
        for i,(code,name,examples) in enumerate(PN_TYPES,21):
            ws.cell(i,1,code);ws.cell(i,2,name);ws.cell(i,3,examples)
    ws['B3']='isaf.document_pns.v2'
    ws['A2']='Program-specific document numbering settings. Green cells are configurable; prefix and revision remain synchronized with Program.'
    # Workbook-controlled values are initialized from the owning program.
    defaults={key:default for _,key,default in PN_SCALARS}
    defaults.update({key:value for key,value in existing.items() if key in defaults})
    program_prefix=str(_program_value(wb,'doc_prefix','') or '').strip()
    defaults.update(prefix='' if program_prefix.upper()=='TBD' else program_prefix,initialRevision=_program_value(wb,'doc_revision','A'))
    if settings is not None:
        if not isinstance(settings,dict):raise ValueError('Document PN settings must be an object')
        defaults.update({k:v for k,v in settings.items() if k in defaults})
    for row in range(5,20):
        for col in range(1,4):ws.cell(row,col).value=None
    for i,(label,key,_) in enumerate(PN_SCALARS,5):
        ws.cell(i,1,label);ws.cell(i,2,key)
        ws.cell(i,3,defaults[key])
        ws.cell(i,3).fill=PatternFill('solid',fgColor='E2EFD9');ws.cell(i,3).font=Font(name='Arial',size=11);ws.cell(i,3).alignment=Alignment(wrap_text=True,vertical='center')
    definitions=settings.get('typeDefinitions') if isinstance(settings,dict) else None
    if definitions is not None:
        if not isinstance(definitions,list) or len(definitions)>30:raise ValueError('Document PN typeDefinitions must contain no more than 30 rows')
        for row in range(21,51):
            for col in range(1,4):ws.cell(row,col).value=None
        for row,item in enumerate(definitions,21):
            if not isinstance(item,dict):raise ValueError('Each document PN type definition must be an object')
            ws.cell(row,1,str(item.get('code','')).strip().upper())
            ws.cell(row,2,str(item.get('name','')).strip())
            ws.cell(row,3,str(item.get('examples','')).strip())
    for row in range(21,51):
        for col in range(1,4):
            cell=ws.cell(row,col);cell.fill=PatternFill('solid',fgColor='E2EFD9');cell.font=Font(name='Arial',size=10);cell.alignment=Alignment(wrap_text=True,vertical='top')
    ws.sheet_properties.pageSetUpPr.fitToPage=True
    ws.page_setup.fitToWidth=1;ws.page_setup.fitToHeight=0
    return ws

def move_pn_after_name(ws,legacy):
    """Move the controlled PN column while preserving cell data, notes and rules."""
    if str(ws['C5'].value).endswith('.pn'):return
    end=ord(legacy)-64
    mapping={i:(3 if i==end else i+1) for i in range(3,end+1)}
    snapshots={(r,c):copy(ws.cell(r,c)) for r in range(4,ws.max_row+1) for c in mapping}
    dims={c:copy(ws.column_dimensions[chr(64+c)]) for c in mapping}
    for (r,c),old in snapshots.items():
        new=ws.cell(r,mapping[c]);new.value=old.value;new._style=copy(old._style);new.comment=copy(old.comment);new.hyperlink=copy(old.hyperlink)
    for c,dim in dims.items():
        key=chr(64+mapping[c]);dim.index=key;dim.min=mapping[c];dim.max=mapping[c];ws.column_dimensions[key]=dim
    from openpyxl.worksheet.cell_range import CellRange
    def ranges(old):
        result=[]
        for span in str(old).split():
            area=CellRange(span)
            for c in range(area.min_col,area.max_col+1):
                dest=mapping.get(c,c);letter=chr(64+dest)
                result.append(f'{letter}{area.min_row}:{letter}{area.max_row}')
        return ' '.join(result)
    for dv in ws.data_validations.dataValidation:dv.sqref=ranges(dv.sqref)
    rules=list(ws.conditional_formatting._cf_rules.items());ws.conditional_formatting._cf_rules.clear()
    for cf,items in rules:
        for rule in items:ws.conditional_formatting.add(ranges(cf.sqref),rule)

def normalize_personnel(wb):
    """Remove the obsolete Personnel Organization column when saving old inputs."""
    ws=wb['2. Personnel']
    if str(ws['E4'].value).lower()!='organization':return
    merges=[str(r) for r in ws.merged_cells.ranges]
    for area in merges:ws.unmerge_cells(area)
    source={(r,c):copy(ws.cell(r,c)) for r in range(4,ws.max_row+1) for c in range(6,9)}
    for r in range(4,ws.max_row+1):
        for c in range(5,9):cell=ws.cell(r,c);cell.value=None;cell.comment=None;cell._style=None
    for (r,c),old in source.items():
        cell=ws.cell(r,c-1);cell.value=old.value;cell._style=copy(old._style);cell.comment=copy(old.comment)
    for c in range(5,8):ws.column_dimensions[chr(64+c)].width=ws.column_dimensions[chr(65+c)].width
    ws.column_dimensions.pop('H',None)
    def shift(ref):
        return re.sub(r'([F-H])(\d+)',lambda m:chr(ord(m[1])-1)+m[2],str(ref))
    for dv in ws.data_validations.dataValidation:dv.sqref=shift(dv.sqref)
    rules=list(ws.conditional_formatting._cf_rules.items());ws.conditional_formatting._cf_rules.clear()
    for cf,items in rules:
        for rule in items:ws.conditional_formatting.add(shift(cf.sqref),rule)
    for area in merges:
        ws.merge_cells('A1:G1' if area=='A1:E1' else 'A2:G2' if area=='A2:E2' else shift(area))
