"""New-program workbooks and persisted intake answers; existing workbooks stay intact."""
import json, sys
from pathlib import Path
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.comments import Comment
from workbook_layout import normalize_workbook, title
from open_decisions import save_open_decisions

ROLES=['chief_engineer','cert_lead','lead_pm','systems_lead','safety_lead','software_lead','hardware_lead','process_assurance_lead','quality_lead','config_manager']
SUPPLIER_EXTRA={'country':'J','work_countries':'K','outside_us_percent':'L','percentage_basis':'M','oversight_notes':'N'}
SCHEMA=json.loads((Path(__file__).parent/'intake-schema.json').read_text())
INTAKE_FIELDS={f['key'] for f in SCHEMA['fields']}

def text_cell(cell,value):
    cell.value=value
    if isinstance(value,str):cell.data_type='s'

def supplier_headers(wb):
    ws=wb['8. Suppliers']
    for f in SCHEMA['suppliers']:
        key=f['key'];col=SUPPLIER_EXTRA[key];cell=ws[col+'4']
        cell.value=f['label'];cell.font=Font(name='Arial',size=11,bold=True,color='FFFFFF');cell.fill=PatternFill('solid',fgColor='1F3A5F');cell.alignment=Alignment(wrap_text=True,vertical='center')
        cell.comment=Comment(f['help'],'ISAF');ws[col+'5']='suppliers.'+key;ws.column_dimensions[col].width=32 if key!='outside_us_percent' else 24
        for r in range(6,51):
            c=ws[f'{col}{r}'];c.font=Font(name='Arial',size=11);c.fill=PatternFill('solid',fgColor='E2EFD9');c.alignment=Alignment(wrap_text=True,vertical='center')
    ws.row_dimensions[4].height=max(ws.row_dimensions[4].height or 0,34)
    if not any(str(d.sqref)=='L6:L50' and d.type=='decimal' for d in ws.data_validations.dataValidation):
        dv=DataValidation(type='decimal',operator='between',formula1=0,formula2=100,allow_blank=True)
        dv.errorTitle='Enter a percentage';dv.error='Enter a number from 0 to 100, or leave blank while unknown.';dv.showErrorMessage=True
        ws.add_data_validation(dv);dv.add('L6:L50')

def read_intake(wb):
    if '16. Program Intake' not in wb.sheetnames:return {}
    ws=wb['16. Program Intake'];modern=ws['B4'].value=='Field Key'
    result={}
    for r in range(5,ws.max_row+1):
        key=ws.cell(r,2 if modern else 1).value
        if key is None:continue
        key=str(key).removeprefix('intake.');v=ws.cell(r,3 if modern else 2).value
        result[key]='' if v is None else v
    return result

def save_intake(wb,values):
    if not isinstance(values,dict) or set(values)-INTAKE_FIELDS:raise ValueError('Unsupported intake field')
    ws=wb['16. Program Intake'] if '16. Program Intake' in wb.sheetnames else wb.create_sheet('16. Program Intake')
    for area in list(ws.merged_cells.ranges):ws.unmerge_cells(str(area))
    for row in ws:
        for c in row:c.value=None;c.comment=None
    ws.data_validations.dataValidation=[]
    ws['A1']='Program Intake';ws.merge_cells('A1:E1')
    ws['A2']='Complete the green answers. Required fields are identified in the final column. Use the app to track TBD decisions.';ws.merge_cells('A2:E2')
    ws['B3']='isaf.intake_layout.v1';ws.row_dimensions[3].hidden=True
    for c,v in enumerate(['Field','Field Key','Answer','Purpose And Use','Requirement'],1):ws.cell(4,c,v)
    for r,f in enumerate(SCHEMA['fields'],5):
        v=values.get(f['key'],'')
        if not isinstance(v,(str,int,float,bool)) and v is not None:raise ValueError('Intake answers must be text')
        if v is None:v=''
        elif isinstance(v,bool):v='Yes' if v else 'No'
        else:v=str(v)
        vals=[f['label'],'intake.'+f['key'],v,f['help'],'Required' if f['required'] else 'When Applicable']
        for c,value in enumerate(vals,1):text_cell(ws.cell(r,c),value)
        helptext=f['help']
        if f.get('optionLabels'):helptext+='\n\n'+'\n'.join(k+': '+label for k,label in f['optionLabels'].items())
        ws.cell(r,3).comment=Comment(helptext,'ISAF')
        if f.get('options'):
            dv=DataValidation(type='list',formula1='"'+','.join(f['options'])+'"',allow_blank=True);ws.add_data_validation(dv);dv.add('C'+str(r))
        ws.row_dimensions[r].height=max(42,14*(max((len(str(v))+48)//49,(len(f['help'])+64)//65)+1))
    style_sheet(ws,4,5)
    for row in ws.iter_rows(min_row=5,max_row=4+len(SCHEMA['fields']),max_col=5):
        for c in row:
            c.fill=PatternFill('solid',fgColor='E2EFD9' if c.column==3 else 'FFFFFF')
            c.font=Font(name='Arial',size=10 if c.column in [2,4,5] else 11,color='666666' if c.column in [2,4] else '000000',bold=c.column==1)
            c.alignment=Alignment(wrap_text=True,vertical='center')
    ws.freeze_panes='C5';ws.row_dimensions[2].height=30
    for col,width in {'A':33,'B':43,'C':55,'D':70,'E':22}.items():ws.column_dimensions[col].width=width

def style_sheet(ws,header,width):
    ws.sheet_view.showGridLines=False;ws.freeze_panes=f'C{header+2}'
    ws['A1'].font=Font(name='Arial',size=16,bold=True,color='1F3A5F')
    ws['A2'].font=Font(name='Arial',size=10,color='666666')
    for row in ws:
        for c in row:
            if c.row<3:continue
            c.font=Font(name='Arial',size=10)
            c.alignment=Alignment(wrap_text=True,vertical='top')
            if c.row==header:c.font=Font(name='Arial',bold=True,color='FFFFFF');c.fill=PatternFill('solid',fgColor='1F3A5F')
            elif c.row>header+1:c.fill=PatternFill('solid',fgColor='E2EFD9')
    for n in range(1,width+1):ws.column_dimensions[ws.cell(4,n).column_letter].width=28

def blank_workbook(kind):
    if kind not in ['AIRCRAFT','SYSTEM','LRU']:raise ValueError('Choose Aircraft, System or LRU')
    from save_config import FIELD_MAP, fixed_item_columns
    wb=Workbook();wb.remove(wb.active)
    for spec in FIELD_MAP.values():
        if spec['sheet'] not in wb.sheetnames:wb.create_sheet(spec['sheet'])
    # Normalize a truly empty workbook, never a populated demo.
    ws=wb['2. Personnel']
    for c,h in enumerate(['Role','Field Key','Name','Email','Title','Signatory','Requirement'],1):ws.cell(4,c,h)
    for r,role in enumerate(ROLES,5):
        ws.cell(r,1,title(role));ws.cell(r,2,'personnel.'+role);ws.cell(r,5,title(role));ws.cell(r,6,'No')
    ws['A16']='Independence Mechanism';ws['B16']='personnel.independence_mechanism'
    ws['A17']='Independence Description';ws['B17']='personnel.independence_description'
    normalize_workbook(wb)
    for section,spec in FIELD_MAP.items():
        ws=wb[spec['sheet']]
        if section=='program':continue
        ws['A1']=title(section);ws['A2']='Complete applicable inputs. Unresolved decisions are tracked in 15. Open Decisions.'
        if 'end' in spec:
            columns={k:v for k,v in spec['fields'].items() if k!='flow_down_letter_signed'}
            for key,col in columns.items():
                if section in ['systems','software_items','hardware_items']:
                    # The sheet's own fixed map keeps a late-added column on its own letter;
                    # without it a new workbook got its ATA chapter header one column right of
                    # the readers. It is per sheet: ata_chapter is K / N / M, not one letter.
                    col=fixed_item_columns(section).get(key) or ('C' if key=='pn' else chr(ord(col)+1) if col>='C' else col)
                ws[f'{col}4']=title(key)
                ws[f'{col}5']=({'systems':'sys','software_items':'sw','hardware_items':'hw'}.get(section,section))+'.'+key
            style_sheet(ws,4,len(columns))
        elif section!='personnel':
            for key,addr in spec['fields'].items():ws['A'+addr[1:]]=title(key);ws['B'+addr[1:]]=section+'.'+key
            ws['A4']='Field';ws['B4']='Field Key';ws['C4']='Value'
            style_sheet(ws,4,3)
        else:style_sheet(ws,4,7)
    ws=wb['3. Authority']
    for r,k in enumerate(['name','email','organization'],5):ws[f'A{r}']='Primary Contact '+title(k);ws[f'B{r}']='authority.poc_primary.'+k
    for c,k in enumerate(['type','ref','title','description','status'],1):ws.cell(16,c,title(k))
    decisions=[]
    def unknown(path):decisions.append({'path':path,'item_id':'','owner':'','target_date':''})
    spec=json.loads((Path(__file__).parent/'config-layout.json').read_text())
    for key in spec['required']:
        if key not in ['type','doc_revision','do160_revision']:unknown('program.'+key)
    if kind=='AIRCRAFT':unknown('program.cert_basis_part')
    for role in ['chief_engineer','cert_lead','lead_pm','process_assurance_lead','quality_lead']+(['safety_lead'] if kind!='LRU' else []):unknown('personnel.'+role+'.name')
    unknown('personnel.independence_mechanism')
    unknown('authority.partnering_arrangement')
    for key in FIELD_MAP['safety']['fields']:
        if key!='particular_risks':unknown('safety.'+key)
    # Blank boolean cells parse as false; an explicit TBD prevents accidental acceptance.
    for key in ['approval_path','software_scope','hardware_scope','supplier_scope']:unknown('intake.'+key)
    ws=wb['1. Program']
    for row in ws:
        if row[1].value in ['program.type','program.doc_revision','program.do160_revision','program.brand_color_primary','program.brand_color_accent']:
            row[2].value={'program.type':kind,'program.doc_revision':'A','program.do160_revision':'G','program.brand_color_primary':'Navy','program.brand_color_accent':'Light Blue'}[row[1].value]
    save_intake(wb,{k:('No' if k=='separate_cdp' else '') for k in INTAKE_FIELDS});supplier_headers(wb)
    from engineering_workbook import ensure_engineering
    ensure_engineering(wb)
    save_open_decisions(wb,decisions)
    return wb

def replace_rows(wb,section,rows):
    from save_config import FIELD_MAP, fixed_item_columns
    spec=FIELD_MAP.get(section)
    if not spec or 'end' not in spec or not isinstance(rows,list):raise ValueError('Unsupported intake item table')
    if len(rows)>spec['end']-5:raise ValueError('Too many '+section+' rows')
    ws=wb[spec['sheet']];mapping={k:v for k,v in spec['fields'].items() if k!='flow_down_letter_signed'}
    if section in ['systems','software_items','hardware_items'] and str(ws['C5'].value).endswith('.pn'):
        # Columns added after the PN shim keep their letter in both layouts. Without the sheet's
        # own fixed map here the intake wrote the ATA chapter one column right of where every
        # reader looks for it, so the value disappeared on the next load.
        _fixed=fixed_item_columns(section)
        mapping={k:(_fixed.get(k) or ('C' if k=='pn' else chr(ord(v)+1) if v>='C' else v))
                 for k,v in mapping.items()}
    seen=set()
    for row in rows:
        if section.startswith('environmental_'):continue # Incomplete rows are retained while the intake is being drafted.
        ident=str(row.get('id','')).strip()
        if not ident or ident in seen:raise ValueError('Every '+section+' row needs a unique ID')
        seen.add(ident)
    for r in range(6,spec['end']+1):
        for col in mapping.values():ws[f'{col}{r}'].value=None
    for r,item in enumerate(rows,6):
        for key,col in mapping.items():
            v=item.get(key,'')
            if isinstance(v,bool):v='Yes' if v else 'No'
            if isinstance(v,list):v=', '.join(str(x) for x in v)
            text_cell(ws[f'{col}{r}'],v)
    for key,col in mapping.items():
        if ws[f'{col}4'].value is None:ws[f'{col}4']=title(key);ws[f'{col}5']=section+'.'+key

def main():
    data=json.load(sys.stdin)
    if data.get('mode')=='new':
        wb=blank_workbook(data['type'])
        mods=data.get('modifications') or {}
        if mods:  # customer-specific app: licensed values from the Admin customer record
            from save_config import apply_modifications
            apply_modifications(wb,mods);normalize_workbook(wb)
    else:
        from save_config import apply_modifications
        wb=load_workbook(data['source']);mods=data.get('modifications',{})
        count=apply_modifications(wb,mods)
        if count!=len(mods):raise ValueError(f'Only {count} of {len(mods)} edits could be saved; no workbook was returned')
        normalize_workbook(wb)
    wb.save(data['output'])
    print(json.dumps({'output':data['output']}))
if __name__=='__main__':main()
