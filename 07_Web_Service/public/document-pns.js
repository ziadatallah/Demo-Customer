export const recommendedTypes = [{"code": "PLN", "name": "Plan", "examples": "Project plan, SDP, PSAC, configuration management plan"}, {"code": "PROC", "name": "Procedure", "examples": "CCB process, document control, purchasing procedure"}, {"code": "WI", "name": "Work instruction", "examples": "Inspection steps, assembly instructions, tool setup"}, {"code": "STD", "name": "Standard", "examples": "Coding standard, drawing standard, engineering rules"}, {"code": "SPEC", "name": "Specification", "examples": "System requirements, interface or procurement specification"}, {"code": "RPT", "name": "Report / assessment", "examples": "Test report, safety assessment, internal audit report"}, {"code": "CHK", "name": "Checklist", "examples": "Peer review, release readiness, inspection checklist"}, {"code": "FRM", "name": "Form", "examples": "Change request, approval record, training form"}, {"code": "MIN", "name": "Meeting minutes", "examples": "CCB decisions, design review minutes, team meeting record"}, {"code": "REG", "name": "Register / log", "examples": "Document register, risk register, action log"}, {"code": "POL", "name": "Policy", "examples": "Quality policy, records retention policy"}];
// Shared validation for the editor and settings API. This does not allocate identifiers.
export const defaults = {name:'Program document numbering', prefix:'PREFIX', program:'SYS', separator:'-', order:'prefix-program-type-sequence', digits:5, start:1, scope:'per-type', types:recommendedTypes.map(t=>t.code).join(', '), typeDefinitions:recommendedTypes, revision:'letters', initialRevision:'A'};
export function validate(input) {
 const s = Object.fromEntries(Object.keys(defaults).map(k=>[k,input?.[k]]));
 const errors=[];
 const definitions = input?.typeDefinitions;
 if (definitions !== undefined && (!Array.isArray(definitions) || definitions.length>30)) errors.push('Use no more than 30 document types.');
 s.typeDefinitions = Array.isArray(definitions) ? definitions.slice(0,30).map(t=>({code:String(t?.code||'').trim().toUpperCase(),name:String(t?.name||'').trim(),examples:String(t?.examples||'').trim()})) : String(input?.types||'').split(',').map(code=>({code:code.trim().toUpperCase(),name:recommendedTypes.find(t=>t.code===code.trim().toUpperCase())?.name||code.trim(),examples:recommendedTypes.find(t=>t.code===code.trim().toUpperCase())?.examples||''}));
 if(s.typeDefinitions.some(t=>!t.name||t.name.length>80||t.examples.length>500))errors.push('Every type needs a meaning (up to 80 characters); examples may contain up to 500 characters.');

 for (const k of ['name','prefix','program','separator','order','scope','types','revision','initialRevision']) s[k]=typeof s[k]==='string'?s[k].trim():'';
 if(/^TBD$/i.test(s.prefix))s.prefix='';
 for (const k of ['program','types']) s[k]=s[k].toUpperCase();
 if(!s.name || s.name.length>80) errors.push('Enter a scheme name of 1–80 characters.');
 if(s.prefix&&!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(s.prefix))errors.push('When provided, Doc Prefix must use 1–40 filename-safe characters.');
 if(!['SYS','SW','HW'].includes(s.program))errors.push('Choose a preview discipline.');
 if(!['-','_','.'].includes(s.separator)) errors.push('Choose a supported separator.');
 if(!['prefix-program-type-sequence','prefix-type-program-sequence','program-type-sequence','prefix-program-sequence'].includes(s.order)) errors.push('Choose a supported segment order.');
 s.digits=Number(s.digits);s.start=Number(s.start);
 if(!Number.isInteger(s.digits)||s.digits<3||s.digits>8) errors.push('Sequence length must be between 3 and 8 digits.');
 if(!Number.isSafeInteger(s.start)||s.start<1||s.start>=10**s.digits) errors.push('Starting number must be positive and fit the sequence length.');
 if(!['global','per-type'].includes(s.scope)) errors.push('Choose a sequence scope.');
 if(s.scope==='per-type'&&!s.order.includes('type')) errors.push('Include document type in the number when using separate sequences per type.');
 const types=s.typeDefinitions.map(t=>t.code);
 if(types.join(', ')!==s.types.split(',').map(x=>x.trim()).join(', '))errors.push('Type codes and the guide must match.');
 if(types.length<1||types.length>30||types.some(x=>!/^[A-Z][A-Z0-9]{1,7}$/.test(x))) errors.push('Enter 1–30 comma-separated type codes, each 2–8 characters starting with a letter.');
 if(new Set(types).size!==types.length) errors.push('Document type codes must be unique.');
 s.types=types.join(', ');
 if(!['letters','numbers'].includes(s.revision)) errors.push('Choose a revision format.');
 if(!/^[A-Za-z0-9][A-Za-z0-9.-]{0,11}$/.test(s.initialRevision))errors.push('Set a valid Doc Revision in the workbook.');
 return {settings:s, errors};
}
export function example(s,type,sequence=s.start) {
 const values={prefix:s.prefix,program:s.program,type,sequence:String(sequence).padStart(s.digits,'0')};
 return s.order.split('-').map(key=>values[key]).filter(Boolean).join(s.separator);
}
export function describe(s) {
 const segments=s.order.split('-').filter(key=>key!=='prefix'||s.prefix).map(key=>key==='program'?'discipline':key);return `Document numbers use ${segments.join(' / ')} separated by “${s.separator}”. Codes use uppercase letters and digits. The ${s.digits}-digit sequence starts at ${String(s.start).padStart(s.digits,'0')} and ${s.scope==='global'?'is shared across all document types':'runs separately for each document type'}. Revision starts at ${s.initialRevision} and is recorded separately from the permanent document number. Once issued, a number must never be reused; revisions retain the same document number. The generator assigns SYS, SW or HW by category and maintains a program register beside the output folders. Prefix is optional. Existing PNs are retained when settings change. Filenames end with _DocumentName_Rev Revision.docx.`;
}
