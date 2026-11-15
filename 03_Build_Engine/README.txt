Current package: ISAF v5.3.0. The build engine, parser and validation bundles are shared by Admin, Customer and Demo packages. Generated Word documents reserve more space below running headers and move the cover title and following content lower on the page. Hosted build downloads are provided by the web service. In Demo editions, only the selected program type/phase and curated preview documents are available, and generated Word files carry the large, light blue-gray diagonal DEMO watermark. See the root User Guide and RELEASE_VERIFICATION.txt.

Current release: ISAF v4.0.12. See the main-folder README and Word guides for current behavior. Historical notes below retain their original versions.

Current release: ISAF v4.0.5. See the main-folder README and the in-app User Guide (Help, top right) for current field controls and ECCN help. Historical notes below retain their original versions.

Current release: ISAF v4.0.4. Use START.command / START.bat for the shared web app and Make_Customer_Edition for customer delivery. Main-folder Word guides describe intake and certification preparation. Historical version references below describe earlier packaging work.

ISAF v4.0.3 — COMPLETE DEVELOPMENT RELEASE — 2026-09-09
Includes the admin banner fix: the blue banner retains Admin and appends the selected customer name. The green customer edition keeps its customer title. The UI now reads the running server version, with its fallback updated to v4.0.3. Server, engine, edition manifest, launchers and packaging version references are synchronized.
This is the full application and documentation package, including all source, bundles, 194 canonical Word templates, configuration workbooks, demos, framework references, delivery matrix, document catalog, dependencies and packaging files. Current working folder/archive: ISAF_v4.0.3 / ISAF_v4.0.3.zip.
The admin banner fix is packaged in this release. Earlier entries below describe historical checkpoints, including their former folder names and ZIP status. Existing v3.27.16 archives remain unchanged. Standards-verification and program-evidence limitations remain documented in 00_Docs/Template_Reviews. Further fixes accumulate until another ZIP is requested.

SAFETY SECURITY AND SUPPORTING TEMPLATE UPDATE — 2026-09-09
Updated 41 canonical Word templates: 19 safety and safety-review files, 16 security files, two tool qualification files and four military files. Eighteen safety files retain the prior reviewed content with ARP4761A basis/evidence supplements; FMEA was fully rewritten to remove fixed demo hardware/customer data. Security and tool templates were rewritten with practical records, responsibilities and evidence-based decisions. Military content was extended and stale dates, branding and overstated compliance wording corrected.
ARP4761A is the selected safety basis; ARP4754A remains the development baseline. The full ARP4761A is unavailable, so detailed clause/activity verification remains OPEN. Security proposes DO-326A/DO-356A subject to the agreed program basis; no silent migration to another edition. Full security/tool standard verification and military authority review remain open. A–E and mixed tailoring require program rationale; DAL is not a security risk scale or tool qualification level.
Activated all 16 existing security Word files through adapters without changing task selection or configuration workbooks. System/item security documents retain the existing program-level generation scope; their individual assessed boundaries are manual. Tool fields now use the existing Tools worksheet. Rebuilt source bundles. FMEA uses existing hardware fields. Generic FHA remains retained/manual; active aircraft/system assessments use AFHA/SFHA. The package contains 194 real template DOCX files and 190 registered paths.
Validation passed: 440 workbook/template checks across 11 unchanged workbooks; 200 A–E substitution fixtures, escaping/empty-array checks, three populated military fixtures, XML integrity and preserved extension loops. All 269 current template pages were rendered and reviewed in contact sheets, with detailed page checks for corrections. Six complete Aircraft/System/LRU source/bundle builds matched (822/572/176 documents per engine); final military wording and FMEA edits received dedicated generation checks after those builds. These checks do not establish standards completeness. The 18 pre-existing bundle warnings remain.
Inventory and individual review notes: 00_Docs/Template_Reviews/SAFETY_SECURITY_README.md. Main review: 00_Docs/SAFETY_SECURITY_TEMPLATE_CLEANUP.md. Version remains 3.27.16. No ZIP or refreshed customer edition generated; older archives are older snapshots. Continue testing the working package and create a complete development ZIP only on explicit request.

DO-254 HARDWARE TEMPLATE BASELINE — 2026-09-09
Updated 37 canonical Word templates: 19 hardware documents and 18 peer/milestone review checklists. The 216 review questions are in tables with response and evidence/findings fields. Blue config/derived tags and green customer fields follow the approved template conventions.
Reviewed content against selected sections of the supplied full DO-254 (2000), with justified A–E/mixed tailoring. Corrected PHAC control classification and broad method claims; clarified combined validation/verification planning and separate procedures/results/configuration records. Exhaustive objective-by-objective verification and program compliance remain open.
Activated the existing HDL coding standard through a Word-template adapter; source and bundle synchronized. No configuration workbook/schema changes. The package still has 194 template DOCX files, now 174 registered paths. FMEA and the three environmental hardware templates are unchanged.
Validation: 407 workbook/template checks, 185 A–E fixtures, escaping/empty arrays, 241 rendered pages inspected, XML/color checks and 11 unchanged workbooks. Six complete Aircraft/System/LRU source/bundle builds passed with matching document XML (822/572/176 per engine). The 18 pre-existing bundler warnings remain.
Inventory and individual review notes: 00_Docs/Template_Reviews/DO254_README.md. Preserve these canonical masters; older scripts and archives are historical snapshots. No new ZIP or version was generated. Continue user testing; package the complete development distribution only on explicit request.

TEMPLATE DUPLICATE CLEANUP AND REVIEW TABLES — 2026-09-09
Removed 108 duplicate/superseded filenames across software, hardware, Systems and tools. There are now 194 template DOCX files, including all 173 registered template paths. Preserve distinct manual templates; do not recreate alternate copies.
Converted 400 questions in 50 review templates into tables: Review question | Response | Evidence and findings. Hardware PR questions were already tabular. Question wording, configuration tags and blue/green field conventions are preserved.
Corrected five hardware milestone routes to review/hw_peer and rebuilt the engine bundle. Validation passed: 550 workbook/template checks, 250 A–E substitution fixtures, escaping/empty-array tests, 250 rendered pages visually reviewed, all 11 workbooks unchanged, and six complete Aircraft/System/LRU source/bundle builds (822/572/176 DOCX per engine).
Detailed inventory and retired-to-current filename mapping: 00_Docs/Template_Reviews/Template_Deduplication_and_PR_Tables.md.
At this earlier cleanup checkpoint, DO-254 content authoring was pending; the latest hardware baseline above supersedes that status. This cleanup does not establish additional standards completeness. No new ZIP or version was generated; existing archives predate this fix.

DO-178C SOFTWARE TEMPLATE BASELINE — 2026-09-09
Software baseline: 55 authored templates (54 active, one retained manual SW-CIR). The 64 alternate filenames were removed in the subsequent duplicate cleanup; use the canonical files only. See 00_Docs/Template_Reviews/DO178C_README.md for the complete inventory, individual reviews, applicability limits and compatibility mapping.
Validation: 605 workbook/template checks, 275 A–E fixtures, escaping/empty-array tests, 329 visually reviewed pages, XML/color audits, all 11 workbooks unchanged. Six complete Aircraft/System/LRU source and bundle builds passed; document XML matched across 822/572/176 outputs per engine.
Activated eight existing supplemental software templates and CodeReview; corrected seven software milestone template paths. Source and bundles synchronized. The 18 pre-existing bundler duplicate-key warnings remain.
Use blue CCE5FF configuration/derived tags and green C6EFCE customer entries. DO-178C remains the target. Full B plus the B/C differences guide supported this pass; direct full-C objective/applicability/independence verification remains OPEN. Do not claim verified standard completeness or program compliance. Preserve the approved ARP4754A Systems baseline.
No ZIP or new release was generated. Continue testing the working package; generate the complete development ZIP only when explicitly requested. Earlier archives are older snapshots.

ISAF Build Engine v3.0.0
======================

Reads an ISAF Configuration Workbook (.xlsx) and renders the full
v2 cert document set as Word documents.


Quick start
-----------
1. Install Node.js 18+ and Python 3.10+
2. Install the Python xlsx reader: pip install openpyxl
3. Install the Node docx library:  npm install
4. Run:
       node src/build.js --workbook your_workbook.xlsx --output ./cert-library


Output organization
-------------------
Output is grouped by lifecycle phase. Per program (count varies by
program type, component count, and DAL distribution):

  Plans/
    [PROG]-PSAC-Sys-001.docx           system-level cert plans
    [PROG]-DP-001.docx                 (12 ARP4754A artifacts)
    ...
    Plans/Software/<sw-item>/
      [PROG]-<sw>-PSAC-001.docx        per-software-item plans
      ...                              (5 per item)
    Plans/Hardware/<hw-item>/
      [PROG]-<hw>-PHAC-001.docx        per-hardware-item plans
      ...                              (5 per item)

  Standards/
    Standards/Software/<sw-item>/      (3 per software item)
    Standards/Hardware/<hw-item>/      (4 per hardware item)

  LifecycleData/
    [PROG]-REQ-Sys-001.docx, etc.      (4 system-level)
    LifecycleData/Software/<sw-item>/  (8 per software item)
    LifecycleData/Hardware/<hw-item>/  (7 per hardware item)

  CertSummary/
    [PROG]-CSR-Sys-001.docx            system-level CSR
    CertSummary/Software/<sw-item>/    SAS per software item
    CertSummary/Hardware/<hw-item>/    HAS per hardware item

  Safety/                              (program-scope; aircraft/system only)
    [PROG]-FHA-001.docx, PSSA, SSA, CCA

  Reviews/                             (entry + exit per review)
    [PROG]-SRR-Entry-001.docx, etc.    SRR, PDR, CDR, TRR, CR
    [PROG]-SOI1-Entry-001.docx, etc.   SOI #1-#4 (when has_software)

  ToolQual/<tool>/                     one TQP per qualified tool
    [PROG]-<tool>-TQP-001.docx

  build_report.txt                     summary with warnings/info


Typical document counts per program
-----------------------------------

  Aircraft program (large):     ~500 documents
  System program (medium):      ~350 documents
  LRU program (small):          ~80  documents


Folder handling
---------------
If the output folder exists when the engine runs, it is renamed with
a timestamp suffix and a fresh folder is created. The console
message tells you the backup location. Nothing is silently
overwritten.


Validation behavior
-------------------
- Blocker findings halt the build with exit code 1.
- Warning findings are recorded in build_report.txt; build proceeds.
- Info findings are recorded but do not affect the build.
- --validate-only runs validation without producing output.


Source layout
-------------
src/build.js                Main entry point
src/read_workbook.py        Workbook reader (Python, openpyxl)
src/validator.js            Validation rules per ISAF-SCH-002
src/deriver.js              Computed field derivation
src/applicability/          DAL applicability engine
                            (DO-178C Annex A, DO-254 Appendix A,
                             review/SOI checklists)
src/data/                   Encoded standards data
                            (do178c_annex_a.js, do254_appendix_a.js,
                             reviews.js)
src/render/                 47 renderer modules + chrome utilities
package.json                Node dependencies (only docx)


Renderer architecture
---------------------
Each renderer module exports {id, filename, render}. The render
function takes the data document plus an output path and writes a
.docx. Module signature varies by scope:

  program-scope:   render(data, outPath)
  software-scope:  render(data, sw_item, outPath)
  hardware-scope:  render(data, hw_item, outPath)
  tool-scope:      render(data, tool, outPath)

The registry (src/render/_registry.js) declares which scope each
renderer belongs to and the applies() filter that determines whether
it fires for a given program. expandRenderTasks(data) iterates over
the registry and produces the work list. build.js then executes the
work list.

Adding a new renderer is a four-step process: create the module,
import it in _registry.js, add a registry entry with the right
scope and applies() filter, and the build engine picks it up
automatically.
