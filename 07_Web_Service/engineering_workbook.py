"""Preserve and expose the optional engineering sheets in every save/new-workbook path."""
import json
from pathlib import Path
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.comments import Comment
from openpyxl.worksheet.datavalidation import DataValidation
SCHEMA=json.loads((Path(__file__).parent/'engineering-schema.json').read_text())
def ensure_engineering(wb):
 for section,spec in SCHEMA.items():
  ws=wb[spec['sheet']] if spec['sheet'] in wb.sheetnames else wb.create_sheet(spec['sheet'])
  ws.sheet_view.showGridLines=False;ws.freeze_panes='C6' if section!='dev_environment' else 'C5'
  ws['A1']={'dev_environment':'Development Environment','environmental_baseline':'Environmental Evidence','environmental_flow_down':'Environmental Requirements'}[section]
  ws['A1'].font=Font(name='Arial',size=16,bold=True,color='1F3A5F')
  ws['A2']='Program-controlled inputs. Blank means unknown; use the app to track TBD decisions. Qualification evidence and installation requirements are separate.'
  ws['A2'].font=Font(name='Arial',size=10,color='666666');ws['A2'].alignment=Alignment(wrap_text=True);ws.row_dimensions[2].height=34
  if section=='dev_environment':
   for col,label,width in [('A','Field',34),('B','Field Key',47),('C','Value',48),('D','Purpose And Use',75),('E','Requirement',23)]:
    ws[col+'4']=label;ws.column_dimensions[col].width=width
   for f in spec['fields']:
    r=f['row'];ws[f'A{r}']=f['label'];ws[f'B{r}']=section+'.'+f['key'];ws[f'D{r}']=f['help'];ws[f'E{r}']='When Applicable';ws[f'C{r}'].comment=Comment(f['help'],'ISAF');ws.row_dimensions[r].height=40
    if f.get('options') and not any(str(d.sqref)==f'C{r}' for d in ws.data_validations.dataValidation):
     dv=DataValidation(type='list',formula1='"'+','.join(f['options'])+'"',allow_blank=True);ws.add_data_validation(dv);dv.add(f'C{r}')
  else:
   for f in spec['fields']:
    col=f['column'];ws[col+'4']=f['label'];ws[col+'4'].comment=Comment(f['help'],'ISAF');ws[col+'5']=section+'.'+f['key'];ws.column_dimensions[col].width=32 if col not in ['A','B'] else 23
   ws.row_dimensions[5].hidden=True;ws.row_dimensions[4].height=36
   if section=='environmental_baseline' and not any(str(d.sqref)=='D6:D500' for d in ws.data_validations.dataValidation):
    dv=DataValidation(type='list',formula1='"Yes,No,TBD"',allow_blank=True);ws.add_data_validation(dv);dv.add('D6:D500')
  end=max(ws.max_row,21 if section=='dev_environment' else 12)
  for row in ws.iter_rows(min_row=4,max_row=end,max_col=5 if section=='dev_environment' else len(spec['fields'])):
   for c in row:
    c.font=Font(name='Arial',size=10,color='FFFFFF' if c.row==4 else '000000',bold=c.row==4)
    c.alignment=Alignment(wrap_text=True,vertical='center')
    c.fill=PatternFill('solid',fgColor='1F3A5F' if c.row==4 else 'E2EFD9' if (section=='dev_environment' and c.column==3 or section!='dev_environment' and c.row>5) else 'FFFFFF')
