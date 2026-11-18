/* Shared Config field descriptions, grounded in workbook reader and validator. */
const CONFIG_FIELD_HELP = {
  "pn": "Company-assigned part number of this system, software or hardware item. Kept separate from its internal item ID and document PN. Used in configuration identification and index documents; enter a controlled PN before certification release.",
  "customer_name": "Legal company name used on document covers.",
  "cage_code": "Five-character Commercial and Government Entity code for the legal company, when assigned. A non-U.S. organization may use an NCAGE. Printed with the company identity on generated document covers; it is never part of a document PN.",
  "company_address": "Legal or controlled program address printed with the company identity on generated document covers.",
  "customer_short_name": "Short company name used in the app banner and document identity fields.",
  "name": "Full name of this program, person, system, item, supplier or tool.",
  "short_name": "Abbreviated name used in document identity and references.",
  "type": "Program boundary: Aircraft, System or LRU. Controls which document families and validation rules apply.",
  "doc_prefix": "Optional short code at the beginning of the program's document numbers. Example: AST-SW-PLN-00001. Leave it blank to start document numbers with CAGE (when enabled), discipline or document type.",
  "doc_revision": "Configured document revision shown on generated covers, references and filenames; generation does not constitute release approval.",
  "target_authority_primary": "Lead certification or airworthiness authority identified in certification plans and cover information.",
  "target_authority_secondary": "Additional validating authorities identified in the program certification context.",
  "cert_basis_type": "Set automatically from Approval Path when that path defines a certification basis. For example, Supplier support to an aircraft TC applicant sets TC. Change Approval Path to change this value. Other and Military paths allow an explicit basis agreed with the certification lead. This field is the approval type; Aircraft Certification Basis / Allocation Reference records the detailed applicable requirements.",
  "cert_basis_part": "Enter the applicable airworthiness regulations and agreed amendment level, or a reference to the controlled certification-basis document. Example: 14 CFR Part 25, with amendments identified in the aircraft applicant's certification-basis document. For a System or LRU approved through an aircraft TC/STC, use the aircraft applicant's basis as applicable to your product. Record the detailed requirements allocation in Aircraft Certification Basis / Allocation Reference. For standalone TSO/ETSO approval with no aircraft installation work in scope, this field may be left blank; enter the applicable standard in TSO Category. Used in generated certification-basis summaries. The value is entered by the company and cannot be inferred from System or LRU alone.",
  "tso_category": "Identifies the applicable Technical Standard Order (TSO) or European TSO (ETSO). For TSO/ETSO authorization or a letter of TSO design approval, enter the exact standard number and revision, plus class/type where applicable. List each standard if more than one applies. A System or LRU does not automatically require a TSO. Used in certification planning and TSO review-package checks; ISAF does not determine which standard applies.",
  "brand_color_primary": "Choose a named primary document branding color. Used by document formatting that supports program branding.",
  "brand_color_accent": "Choose a named accent color. Used for document accents where the template supports program branding.",
  "logo_path": "SVG, PNG, or JPEG company logo embedded in generated document headers. SVG is recommended for sharp output at any size. Select Browse to fill the full local path, or enter the complete path without quotation marks. Keep the image at that location when building. The image keeps its proportions. Leave blank for no logo.",
  "do160_in_scope": "Whether environmental qualification documents are in scope. Used with each hardware item’s DO-160 Applies setting to select environmental outputs. Always Yes for an Aircraft program.",
  "do160_revision": "Environmental qualification standard issue used in environmental documentation; the current generator supports G.",
  "cert_regime": "Certification regime used to choose the permitted civil or military document families. Edition restrictions apply.",
  "no_end_user": "Set to Yes where the article is certified with no end user: a product you are taking through TSO approval before it is sold to anyone. Set to Yes, the End User and Contract Number read \"Not applicable\" on every generated document. Left blank, they read as unanswered, so a reviewer can tell the two apart.",
  "purchaser_name": "The End User: the organisation this article is supplied to, and the one named as purchaser on supplied forms such as the DDP and the DO-160 Environmental Qualification Form. This is NOT your own company - that is Company Name. If you build an article for an airframer or a Tier 1 integrator, they are the End User and you are the Company. Leave blank where the article is not supplied to a named organisation.",
  "purchaser_address": "The End User's address as it should appear on supplied documents. Leave blank where there is no named End User.",
  "contract_number": "The contract or purchase order this work is performed under, as the purchaser refers to it. It appears on document title blocks. Leave blank where the work is not against a named contract.",
  "security_assurance_level": "The security assurance level claimed for this program, where one applies (for example a DO-326A/ED-202A airworthiness security level). Leave blank where no security level is claimed.",
  "export_control_marking": "Company-approved export classification and marking printed on generated documents. Choose ECCN opens a searchable Commerce Control List reference; for example, ECCN 7A994 concerns certain navigation/avionics equipment, 7D994 software and 7E994 technology. Enter the classification approved for the document contents, which may differ from the product. EAR99 is a separate designation for items subject to the EAR but not described by a CCL entry; it does not mean unrestricted. Company Proprietary and CUI are not ECCNs. You can enter the complete approved marking manually or use TBD while classification is unresolved. ISAF does not classify the item or determine export authorization.",
  "distribution_statement": "Company-approved distribution notice supplied to supporting template fields.",
  "company_name": "Optional company identity exposed to program template adapters; falls back to Company Name if blank. No current Word master uses this tag. Company Name is the active cover identity.",
  "aircraft_category": "Optional description of the aircraft category exposed to program template adapters. No current Word master uses this tag, and it does not select a certification basis or calculate assurance levels.",
  "mtow_kg": "Maximum take-off mass in kilograms. Retained as optional configuration context; no active Word template or calculation currently uses it.",
  "passenger_count": "Planned passenger capacity. Retained as optional configuration context; no active Word template or calculation currently uses it.",
  "document_retention_years": "Planned records-retention period in years used by records-management template content.",
  "annual_flight_hours": "Planned annual flight hours. No active Word template or calculation currently uses this field. The legacy reader supplies 1,000 when blank.",
  "independence_mechanism": "How you keep the person checking the work separate from the person who did it. DO-178C and DO-254 mark some objectives \u201Cwith independence\u201D, meaning the check is carried out by someone other than whoever developed the item. For a small team, review by a person other than the author is a normal and perfectly acceptable answer. Required before documents can be generated, and it appears in the SEMP and in the software and hardware plans. Put anything specific to your arrangement in Independence Description.",
  "independence_description": "Optional detail on the independence arrangement chosen above: who reviews what, which reporting line applies, or how an external party is involved. Use it when the standard answer needs explaining; leave it blank when it does not.",
  "email": "Contact email used in personnel or authority coordination information.",
  "organization": "Organization represented by this person, used in role or authority contact information.",
  "title": "Job title for a person, or title of an authority issue. Used in the corresponding role/contact or certification issue record.",
  "signatory": "Whether this person is identified as a signatory in personnel information; Yes does not mean the document has been signed.",
  "poc_secondary": "Additional authority contacts, entered as name, email and organization, for certification coordination.",
  "partnering_arrangement": "Whether a partnering arrangement exists with the authority. Yes makes the agreement reference mandatory.",
  "partnering_ref": "Controlled agreement reference used in authority coordination when a partnering arrangement exists.",
  "id": "Unique identifier for this row. Used to connect configuration records and scope generated documents. Do not change an established ID without updating its references.",
  "time_zone": "IANA time zone that dates this program\u2019s documents, for example America/New_York or Europe/Toulouse. Document issue dates, the copyright year and the build report all resolve in this zone. Leave blank to use the clock of the machine running the build \u2014 on the hosted service that is UTC, which dates an evening build in the Americas as the following day. The current time in this zone is shown under the version number in the header.",
  "tso_numbers": "Technical Standard Orders this article is declared against, comma-separated with revisions, for example TSO-C113b, TSO-C115d, TSO-C153a. One article can hold several at once on a single nameplate. Printed in the Declaration of Design and Performance.",
  "modification_standard": "The article\u2019s current modification state as released by configuration management, for example Mod 3. Printed in the Declaration of Design and Performance (AMC 21.A.608 item 2)." ,
  "unit_weight": "Article weight with units, as measured on the qualified configuration rather than estimated in design, for example 2.4 kg. Leave blank where it does not apply \u2014 the declaration prints \u201cNot applicable\u201d rather than an unanswered placeholder.",
  "unit_dimensions": "Overall dimensions with units, for example 190 x 124 x 64 mm. Leave blank where it does not apply \u2014 the declaration prints \u201cNot applicable\u201d rather than an unanswered placeholder.",
  "time_rating": "How the article is rated for operating time: continuous, intermittent, or a duty cycle such as 10 min on / 20 min off. This applies to nearly every article, so it should rarely be left blank.",
  "radio_transmitter": "For a transmitting article only: frequency band, maximum transmitting power and emission designator. Leave blank where it does not apply \u2014 the declaration prints \u201cNot applicable\u201d rather than an unanswered placeholder.",
  "pressure_loads": "For a pressurised or load-bearing article only: working and ultimate values, with units. Leave blank where it does not apply \u2014 the declaration prints \u201cNot applicable\u201d rather than an unanswered placeholder.",
  "measuring_accuracy": "For a measuring or indicating article only: limits of accuracy over the declared operating range. Leave blank where it does not apply \u2014 the declaration prints \u201cNot applicable\u201d rather than an unanswered placeholder.",
  "unit_type": "What this row is: a SYSTEM, or an LRU inside one. Leave blank on a program with a single level \u2014 a blank row behaves exactly as it did before this field existed. An ARP4754 system that contains several line-replaceable units sets SYSTEM on the parent row and LRU on each unit.",
  "parent_unit": "For an LRU row, the id of the SYSTEM that contains it, from this same sheet. Leave blank on a SYSTEM row, or where the program has only one level. Software and hardware items do not use this \u2014 they name their units in Parent System on their own tab.",
  "parent_system": "The systems or LRUs this item belongs to, chosen from the Systems sheet. Pick more than one where the same item is installed in several units: one software load in two LRUs is one certified item with one document set, referenced by each, not two rows. Links the item to those units and scopes related document references. Tick each unit it belongs to in the dropdown. At least one is required where the program lists more than one unit; may be left blank only where a single LRU is the whole program boundary, or where field-loadable software is not bound to any unit in this program.",
  "function_summary": "Description of system function and scope used in system document context.",
  "fdal": "Assigned function development assurance level supplied by the safety/development process; used in system document context.",
  "idal_max": "Highest assigned item development assurance level for the system, used in system document context.",
  "software_item_count": "Configured count of software items belonging to the system, supplied to system planning context.",
  "hardware_item_count": "Configured count of hardware items belonging to the system, supplied to system planning context.",
  "primary_supplier": "Organization primarily responsible for this system, supplied to system planning context.",
  "aircraft_fha_classification_max": "Highest aircraft failure-condition classification established by the FHA. Enter the safety assessment result; ISAF does not calculate it. Used in safety and system planning context.",
  "system_fha_classification_max": "Highest system failure-condition classification established by the FHA. Enter the safety assessment result; ISAF does not calculate it. Used in safety and system planning context.",
  "cca_in_scope": "Whether Common Cause Analysis is in scope. Used to select the CCA document; ZSA or PRA in scope also enables the CCA family.",
  "zsa_in_scope": "Whether Zonal Safety Analysis is in scope. Used to select zonal safety documentation. It does not mean the assessment is complete.",
  "pra_in_scope": "Whether Particular Risk Analysis is in scope. Used to select particular-risk documentation. It does not mean the assessment is complete.",
  "particular_risks": "List of applicable external or installation hazards, such as lightning, fire or bird strike, supplied to safety assessment content.",
  "do254_appendix_b_in_scope": "Whether the program invokes the additional hardware considerations associated with DO-254 Appendix B. Supplied to safety/hardware template context; this is a company scope decision, not a calculated compliance result.",
  "dal": "Assigned software or hardware assurance level A–E. Controls document selection and level-dependent template content; ISAF does not perform the safety allocation.",
  "supplier": "Organization responsible for the item, supplied to item planning and supplier context.",
  "language": "Software programming language or hardware description language used by this item; supplied to development/certification template fields.",
  "loc_estimate": "Estimated software lines of code supplied to software planning context.",
  "formal_methods": "Whether formal methods are planned for this software item; supplied to software lifecycle planning.",
  "notes": "Additional program-specific context supplied to the corresponding item or review record.",
  "additional_documents": "Additional supported document module IDs requested for this item, used by document selection.",
  "software_control_category": "Military software control category identifier used with worst-case severity to derive the software criticality index.",
  "worst_case_severity": "Military mishap severity identifier used with software control category in the military software criticality calculation; separate from the Safety tab’s FHA categories.",
  "technology": "Hardware implementation technology used in hardware document context and applicability decisions.",
  "complexity": "Hardware complexity classification supplied to hardware assurance planning; determined by the program, not calculated by ISAF.",
  "do160_applies": "Whether environmental qualification applies to this hardware item. Used with the program DO-160 scope setting to select item environmental outputs.",
  "role": "Supplier responsibilities supplied to supplier management and flow-down content.",
  "items_delivered": "Comma-separated software/hardware item IDs delivered by this supplier. The validator checks that referenced item IDs exist.",
  "highest_dal": "Highest assurance level for the supplier’s delivered scope, supplied to supplier management content.",
  "cert_lead_name": "Supplier certification lead contact name used in supplier coordination.",
  "cert_lead_email": "Supplier certification lead contact email used in supplier coordination.",
  "flow_down_signed": "Whether the supplier flow-down letter is signed, supplied to supplier planning/status content.",
  "flow_down_date": "Date the supplier flow-down letter was signed, supplied to supplier status content.",
  "vendor": "Tool vendor named in the tool inventory and qualification context.",
  "intended_use": "Specific tool use on this program; supplied to tool qualification planning.",
  "lifecycle_data_affected": "Lifecycle data produced, modified or checked by the tool, supplied to tool qualification planning.",
  "qualification_required": "Whether tool qualification is required for the intended use. Yes makes TQL mandatory and controls tool qualification document selection.",
  "tql": "Tool Qualification Level supplied by the program’s qualification assessment; required when qualification is required. Used in tool qualification documentation.",
  "qualification_status": "Current tool qualification status supplied to tool planning and accomplishment context.",
  "ref": "Controlled reference for this authority issue, used in certification planning and issue tracking.",
  "description": "Description of the authority issue and its program impact, used in certification planning.",
  "status": "Current authority-issue disposition supplied to certification coordination records.",
  "failure_conditions_catastrophic": "Number of catastrophic failure conditions identified in the FHA. Enter a nonnegative whole-number count from the safety assessment, not a probability. Used in safety summaries; ISAF does not calculate this count. Zero means none identified, not an unfinished assessment.",
  "failure_conditions_hazardous": "Number of hazardous failure conditions identified in the FHA. Enter a nonnegative whole-number count from the safety assessment, not a probability. Used in safety summaries; ISAF does not calculate this count. Zero means none identified, not an unfinished assessment.",
  "failure_conditions_major": "Number of major failure conditions identified in the FHA. Enter a nonnegative whole-number count from the safety assessment, not a probability. Used in safety summaries; ISAF does not calculate this count. Zero means none identified, not an unfinished assessment.",
  "failure_conditions_minor": "Number of minor failure conditions identified in the FHA. Enter a nonnegative whole-number count from the safety assessment, not a probability. Used in safety summaries; ISAF does not calculate this count. Zero means none identified, not an unfinished assessment.",
  "target_soi1_date": "Planned date for SOI 1 planning review. Supplied to program scheduling template fields where supported. Enter YYYY-MM-DD; this is a target, not evidence of completion. Actual review timing and overlap are program-specific.",
  "target_pdr_date": "Planned date for Preliminary Design Review (PDR). Supplied to program scheduling template fields where supported. Enter YYYY-MM-DD; this is a target, not evidence of completion. Actual review timing and overlap are program-specific.",
  "target_soi2_date": "Planned date for SOI 2 development review. Supplied to program scheduling template fields where supported. Enter YYYY-MM-DD; this is a target, not evidence of completion. Actual review timing and overlap are program-specific.",
  "target_cdr_date": "Planned date for Critical Design Review (CDR). Supplied to program scheduling template fields where supported. Enter YYYY-MM-DD; this is a target, not evidence of completion. Actual review timing and overlap are program-specific.",
  "target_soi3_date": "Planned date for SOI 3 verification review. Supplied to program scheduling template fields where supported. Enter YYYY-MM-DD; this is a target, not evidence of completion. Actual review timing and overlap are program-specific.",
  "target_trr_date": "Planned date for Test Readiness Review (TRR). Supplied to program scheduling template fields where supported. Enter YYYY-MM-DD; this is a target, not evidence of completion. Actual review timing and overlap are program-specific.",
  "target_first_flight_date": "Planned date for first flight. Supplied to program scheduling template fields where supported. Enter YYYY-MM-DD; this is a target, not evidence of completion. Actual review timing and overlap are program-specific.",
  "target_soi4_date": "Planned date for SOI 4 final review. Supplied to program scheduling template fields where supported. Enter YYYY-MM-DD; this is a target, not evidence of completion. Actual review timing and overlap are program-specific.",
  "target_tc_date": "Planned date for certification/authorization. Supplied to program scheduling template fields where supported. Enter YYYY-MM-DD; this is a target, not evidence of completion. Actual review timing and overlap are program-specific.",
  "target_codr_date": "Planned Conceptual Design Review date. Stored with the program schedule and available to scheduling templates. Enter YYYY-MM-DD, or Not applicable: followed by a reason.",
  "target_eis_date": "Planned date for entry into service. Supplied to program scheduling template fields where supported. Enter YYYY-MM-DD; this is a target, not evidence of completion. Actual review timing and overlap are program-specific."
};
const CONFIG_BOOLEAN_KEYS = new Set(['no_end_user','do160_in_scope','partnering_arrangement','cca_in_scope','zsa_in_scope','pra_in_scope','do254_appendix_b_in_scope','formal_methods','do160_applies','flow_down_signed','flow_down_letter_signed','qualification_required','signatory']);
const CONFIG_DATE_ORDER=['target_codr_date','target_soi1_date','target_pdr_date','target_soi2_date','target_cdr_date','target_trr_date','target_soi3_date','target_first_flight_date','target_soi4_date','target_tc_date','target_eis_date'];
function configYes(v){return v===true||['yes','true'].includes(String(v).toLowerCase());}
function configDisplayValue(key,v){if(key.startsWith('brand_color_'))return configColorName(v);if(v==null)return '';return CONFIG_BOOLEAN_KEYS.has(key)||typeof v==='boolean'?(configYes(v)?'Yes':'No'):Array.isArray(v)?v.join(', '):v;}
function configTitle(s){const acronyms={id:'ID',pn:'PN',pns:'PNs',fha:'FHA',cca:'CCA',zsa:'ZSA',pra:'PRA',dal:'DAL',fdal:'FDAL',idal:'IDAL',tql:'TQL',tso:'TSO',etso:'ETSO',hdl:'HDL',codr:'CoDR',pdr:'PDR',cdr:'CDR',trr:'TRR',eis:'EIS',tc:'TC',pm:'PM',poc:'POC',loc:'LOC',kg:'kg',do160:'DO-160',do254:'DO-254'};return String(s).replace(/_/g,' ').replace(/soi([1-4])/gi,'SOI $1').replace(/\b[a-z][a-z0-9-]*\b/gi,w=>acronyms[w.toLowerCase()]||(/^SOI$/i.test(w)?'SOI':w[0].toUpperCase()+w.slice(1)));}
function configAt(path){return path.replace(/\[(\d+)\]/g,'.$1').split('.').reduce((v,k)=>v?.[k],configData);}
function configRequired(path){
 const type=configData?.program?.type;
 if(/^environmental_baseline\[\d+\]\.tested$/.test(path))return true;
 if(/^environmental_(baseline|flow_down)\[\d+\]\.(hw_id|section)$/.test(path))return true;
 if(['intake.approval_path','intake.software_scope','intake.hardware_scope','intake.supplier_scope'].includes(path))return true;
 if(["program.customer_name", "program.name", "program.type", "program.target_authority_primary", "program.customer_short_name", "program.short_name", "program.doc_revision", "program.cert_basis_type", "program.tso_category", "program.do160_in_scope", "program.do160_revision", "program.cert_regime", "program.export_control_marking", "program.distribution_statement", "program.document_retention_years", "program.target_codr_date", "program.target_soi1_date", "program.target_pdr_date", "program.target_soi2_date", "program.target_cdr_date", "program.target_trr_date", "program.target_soi3_date", "program.target_first_flight_date", "program.target_soi4_date", "program.target_tc_date", "program.target_eis_date"].includes(path))return true;
 if(['program.type','program.customer_name','program.name','program.target_authority_primary','personnel.independence_mechanism'].includes(path))return true;
 if(path==='program.cert_basis_part')return type==='AIRCRAFT';
 if(/^personnel\.(chief_engineer|cert_lead|lead_pm|systems_lead|safety_lead|software_lead|hardware_lead|process_assurance_lead|quality_lead|config_manager)\.(name|email)$/.test(path))return true;
 if(path==='authority.partnering_ref')return configYes(configData?.authority?.partnering_arrangement);
 if(/^(systems|software_items|hardware_items)\[\d+\]\.pn$/.test(path))return true;
 if(/^(software_items|hardware_items)\[\d+\]\.(id|name|dal)$/.test(path))return true;
 if(/^tools\[\d+\]\.tql$/.test(path))return configYes(configAt(path.replace(/tql$/,'qualification_required')));
 return false;
}
function configRequiredNote(path){if(path==='program.tso_category')return 'ISAF requires an entry. If no TSO/ETSO applies, enter Not applicable: followed by the reason. Example: Not applicable: LRU approval under aircraft TC; no TSO authorization sought. Use the TBD control until the applicable standard or non-applicability is confirmed.';if(path.startsWith('program.')&&CONFIG_DATE_ORDER.includes(path.slice(8)))return 'Required entry. Use YYYY-MM-DD for applicable dates, or Not applicable: followed by a reason when this milestone does not apply.';if(/^(systems|software_items|hardware_items)(?:\[\d+\])?\.pn$/.test(path))return 'Required for every configured item. Enter the company-controlled product part number.';if(/^(software_items|hardware_items)\.(id|name|dal)$/.test(path))return 'Required for every configured item.';if(path==='program.cert_basis_part')return 'Required by ISAF for Aircraft programs. For System and LRU programs, complete when applicable to the approval or installation scope. If applicable but not yet agreed, use TBD; if not applicable, leave blank.';if(path==='personnel.safety_lead.name')return 'Required for Aircraft and System programs.';if(path==='authority.partnering_ref')return 'Required when Partnering Arrangement is Yes.';if(/^tools(?:\[\d+\])?\.tql$/.test(path))return 'Required for each tool whose Qualification Required setting is Yes.';return configRequired(path)?'Required. Enter a value before generating documents.':'Optional in ISAF: you can generate documents without this value. Complete it when it applies to your program.';}
function configLabel(key,path){
 const section=path.split(/[.[]/)[0];let label=getFieldMeta(key,section).label||key;
 if(path.startsWith('personnel.')&&path.split('.').length===3)label=path.split('.')[1]+' '+label;
 if(path.startsWith('authority.poc_primary.'))label='Primary Authority Contact '+key;
 if(path.startsWith('authority.items['))label='Authority Issue '+(Number(/\[(\d+)\]/.exec(path)[1])+1)+' '+key;
 return configTitle(label);
}
function configFieldLabel(key,path,required=configRequired(path)){return (required?'<span class="required-marker" aria-label="Required">*</span> ':'')+'<span class="field-label">'+escapeHtml(configLabel(key,path))+'</span>';}
function configHelp(key,path){
 const canonical=path.replace(/\[\d+\]/g,'');
 let description=CONFIG_FIELD_HELP[key]||getFieldMeta(key).desc||'Program-specific configuration value supplied to the corresponding planning context.';
 if(path.startsWith('authority.items')&&key==='type')description='Authority issue category (special condition, equivalent level of safety (FAA ELOS / EASA ESF), exemption, TSO / ETSO deviation, means / method of compliance issue paper or CRI, or other issue paper / CRI), used in certification issue tracking.';
 if(path.startsWith('personnel.')&&key==='name')description='Name of the '+configTitle(path.split('.')[1])+', used in document responsibility and approval fields where supported.';
 if(path.startsWith('systems')&&key==='name')description='Name of this system or LRU, used in the documents generated for it and in item context. An LRU program may list two or more LRUs here.';
 if(path.startsWith('systems')&&key==='id')description='Identifier for this system or LRU. Software and hardware items name it in Parent System; where a program lists more than one, every item must name its own.';
 if(path.startsWith('systems')&&key==='ata_chapter')description='ATA iSpec 2200 chapter for this system or LRU (for example 24 for Electrical Power, 34 for Navigation). Printed on the cover of documents written for this item; the program ATA chapter applies where this is left blank.';
 // An item's chapter follows its own function, not the box it runs in: an FMS stays ATA 34 and an
 // FCS stays ATA 27 on a shared Data Aggregator that is itself ATA 42. Nothing is inferred - blank
 // falls through to the parent unit, then the program, exactly as before the field existed.
 if((path.startsWith('software_items')||path.startsWith('hardware_items'))&&key==='ata_chapter')description='ATA iSpec 2200 chapter for this item, where it differs from the unit that hosts it (for example a flight management application at ATA 34 hosted on an IMA at ATA 42). Printed on the cover of documents written for this item. Leave blank to use the parent system’s chapter, and then the program’s.';
 const comment=configData?._fieldComments?.[path]||configData?._fieldComments?.[canonical];
 // Color help intentionally replaces workbook instructions about encoding.
 // The workbook cell comment and the field description were authored from the same source, so
 // for many fields the popover printed the same sentence twice under a "Workbook Note" heading.
 // Only show it where it adds something the description does not already say.
 const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const saysNothingNew=comment&&(norm(comment)===norm(description)||norm(description).includes(norm(comment)));
 const extra=comment&&!saysNothingNew&&!['brand_color_primary','brand_color_accent','tso_category','cert_basis_part'].includes(key)&&!CONFIG_DATE_ORDER.includes(key)?'\n\nWorkbook Note: '+comment.replace(/\btrue\b/gi,'Yes').replace(/\bfalse\b/gi,'No'):'';
 return clarifyConfigRequirementText(description+'\n\n'+configRequiredNote(path)+extra).replace(/\bcustomer\b/gi,word=>word[0]==='C'?'Company':'company');
}
function configObjectEntries(data,section){
 const out=[];
 function visit(obj,base){for(const [key,val]of Object.entries(obj)){
  const path=base+'.'+key;
  if(base.startsWith('personnel.')&&key==='organization')continue;
  if(base==='program'&&['company_name','aircraft_category'].includes(key))continue;
  if(base==='authority'&&['special_conditions','elos_findings','exemption_requests','tso_deviations'].includes(key))continue;
  if(base==='personnel.process_assurance_lead'&&key.startsWith('independence_'))continue;
  if(Array.isArray(val)&&val.some(x=>x&&typeof x==='object')){if(path==='authority.items')val.forEach((v,i)=>visit(v,path+'['+i+']'));continue;}
  if(val!==null&&typeof val==='object'&&!Array.isArray(val))visit(val,path);else out.push({key,val,path});
 }}visit(data,section);
 if(section==='program'){
  const first=out.findIndex(f=>CONFIG_DATE_ORDER.includes(f.key));
  const other=out.filter(f=>!CONFIG_DATE_ORDER.includes(f.key));
  other.splice(first<0?other.length:first,0,...CONFIG_DATE_ORDER.map(k=>out.find(f=>f.key===k)).filter(Boolean));return other;
 }return out;
}
// Required fields that are still empty are outlined in red (class field-missing) in Config Data and Program Intake.
// A field set to TBD keeps its own TBD styling. Runs after every render and on each edit.
function refreshMissingFields(target){
 if(typeof configRequired!=='function')return;
 const list=target?[target]:document.querySelectorAll('#configTabContent [data-path], #intakeHost [data-path]');
 for(const el of list){
  if(!el.dataset?.path||el.type==='checkbox'||el.type==='hidden'||el.type==='color')continue;
  const missing=String(el.value??'').trim()===''&&configRequired(el.dataset.path);
  if(el.classList.contains('field-missing')!==missing){el.classList.toggle('field-missing',missing);if(missing){el.setAttribute('aria-invalid','true');el.dataset.missingFlag='1';}else if(el.dataset.missingFlag){el.removeAttribute('aria-invalid');delete el.dataset.missingFlag;}}
 }
}
document.addEventListener('input',e=>{if(e.target?.dataset?.path)refreshMissingFields(e.target);});
document.addEventListener('change',e=>{if(e.target?.dataset?.path)setTimeout(()=>refreshMissingFields(),0);});
function refreshConfigRequired(){
 const tab=CONFIG_TABS.find(t=>t.id===activeConfigTab),data=configData?.[tab?.path];
 if(Array.isArray(data))for(const h of document.querySelectorAll('#configTabContent th[data-field-key]')){
  const key=h.dataset.fieldKey,needed=data.some((_,i)=>configRequired(`${tab.path}[${i}].${key}`)),label=h.querySelector('.key-cell > span');
  if(label)label.innerHTML=configFieldLabel(key,tab.path+'.'+key,needed);
 }
 for(const el of document.querySelectorAll('#configTabContent [data-path]')){const needed=configRequired(el.dataset.path);el.setAttribute('aria-required',String(needed));const row=el.closest('tr');const label=row?.querySelector('td.key .key-cell');if(label){const rowRequired=row.dataset.personnelRole?configRequired('personnel.'+row.dataset.personnelRole+'.name'):needed;const old=label.querySelector('.required-marker');if(rowRequired&&!old)label.insertAdjacentHTML('afterbegin','<span class="required-marker" aria-label="Required">*</span> ');if(!rowRequired&&old)old.remove();}}
}

// Certification basis follows every approval path with a defined basis.
const CONFIG_APPROVAL_BASIS=Object.freeze({TSOA:'TSO',TC:'TC',AMENDED_TC:'TC',STC:'STC',AMENDED_STC:'STC',SUPPLIER_TC:'TC',SUPPLIER_STC:'STC',TSOA_TC:'TSO',TSOA_STC:'TSO',ETSO:'ETSO',LODA:'TSO',PMA:'PMA'});
// Approval paths that fit each Program Type (owner decision): an LRU supplier does not hold or amend an aircraft TC
// or STC; a System supplier does not hold or amend an aircraft TC; an Aircraft program is the TC/STC holder.
const CONFIG_APPROVAL_PATHS_BY_TYPE=Object.freeze({
 LRU:['TSOA','ETSO','LODA','TSOA_TC','TSOA_STC','SUPPLIER_TC','SUPPLIER_STC','PMA','MILITARY','OTHER'],
 SYSTEM:['TSOA','ETSO','LODA','TSOA_TC','TSOA_STC','SUPPLIER_TC','SUPPLIER_STC','STC','AMENDED_STC','PMA','MILITARY','OTHER'],
 AIRCRAFT:['TC','AMENDED_TC','STC','AMENDED_STC','MILITARY','OTHER']});
function approvalPathFits(type,path){const list=CONFIG_APPROVAL_PATHS_BY_TYPE[String(type||'').toUpperCase()];return !list||!path||list.includes(path);}
// Customer app: with a licensed Cert Basis Type, only approval paths with that basis (or no fixed basis) can be chosen.
function approvalPathLicensed(path){const lic=typeof licensedValues!=='undefined'&&licensedValues?.['program.cert_basis_type'];const basis=CONFIG_APPROVAL_BASIS[path];return !lic||!path||!basis||basis===lic;}
function approvalBasisValue(){return CONFIG_APPROVAL_BASIS[configData?.intake?.approval_path]||'';}
// Customer app: a Cert Basis Type set by the licence is never overwritten from the approval path (the server
// re-applies the licensed value on every save, so overwriting it here left a permanent unsaved change).
function licensedCertBasis(){return typeof licensedValues!=='undefined'&&licensedValues?.['program.cert_basis_type']||'';}
function syncApprovalBasis(){
 const basis=approvalBasisValue();if(!basis||!configData?.program)return;
 if(licensedCertBasis())return;
 if(configData.program.cert_basis_type!==basis){configData.program.cert_basis_type=basis;configDraftMods['program.cert_basis_type']=basis;}
 const decisions=openDecisionList();if(decisions.some(d=>d.path==='program.cert_basis_type'))commitOpenDecisions(decisions.filter(d=>d.path!=='program.cert_basis_type'));
}

// Older imported workbook comments use the same plain-language requirement wording.
function clarifyConfigRequirementText(text){return String(text).replace(/not an unconditional build requirement(?:; complete when applicable to your program)?\.?/gi,'Optional in ISAF: you can generate documents without this value. Complete it when it applies to your program.').replace(/Required by (?:the )?(?:ISAF )?build validator/gi,'Required to generate documents');}
