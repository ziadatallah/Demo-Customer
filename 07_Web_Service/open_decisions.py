"""Persist unresolved decisions without replacing boolean/numeric engineering inputs."""
import json,re
from openpyxl.styles import Font,PatternFill,Alignment
SHEET='15. Open Decisions'
def save_open_decisions(wb,decisions):
    if not isinstance(decisions,list):raise ValueError('Open decisions must be a list')
    ws=wb[SHEET] if SHEET in wb.sheetnames else wb.create_sheet(SHEET)
    # This sheet contains only this register; refresh it from the complete editor state.
    for row in ws:
        for c in row:c.value=None
    ws['A1']='To Be Determined'
    ws['A2']='Unresolved configuration inputs. Complete the decision and remove its row before building.'
    headers=['Field Path','Item ID','Owner','Target Resolution Date','Previous Value']
    for c,h in enumerate(headers,1):
        cell=ws.cell(4,c,h);cell.fill=PatternFill('solid',fgColor='1F3A5F');cell.font=Font(bold=True,color='FFFFFF')
    seen=set()
    for entry in decisions:
        path=str(entry.get('path','')).strip()
        # Document prefix is optional. A blank/TBD prefix is not an unresolved
        # certification input and therefore does not belong in this register.
        if path == 'program.doc_prefix':continue
        if not re.fullmatch(r'[a-zA-Z_]\w*(?:\[\d+\])?(?:\.\w+)+',path):raise ValueError('Invalid unresolved field path')
        if path in seen:continue
        seen.add(path);r=4+len(seen)
        for c,k in enumerate(['path','item_id','owner','target_date','previous_value'],1):
            cell=ws.cell(r,c,str(entry.get(k,'') or ''));cell.alignment=Alignment(wrap_text=True,vertical='top');cell.fill=PatternFill('solid',fgColor='E2EFD9')
    for k,w in {'A':58,'B':28,'C':30,'D':26,'E':48}.items():ws.column_dimensions[k].width=w
    ws.freeze_panes='A5';ws.sheet_view.showGridLines=False
