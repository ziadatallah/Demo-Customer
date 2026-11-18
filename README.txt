ISAF — Certification Document Generation Engine
================================================
Version 5.3.41

ISAF generates a structured set of certification document templates from a
populated configuration workbook. Each document is placed in the milestone
folder where work should begin (CoDR, SRR, PDR, SOI-1, CDR, etc.).

CURRENT FIELD CONTROLS
----------------------
Approval Path sets Certification Basis for mapped paths in both editing tabs.
Save a corrected imported workbook before building. Choose ECCN provides a dated
reference for a user-selected marking; no classification is assigned automatically.
See the User Guide (Help in the app) and EXPORT_CONTROL_REFERENCE.md.

DOCUMENT LAYOUT
----------------------
New documents have cover approvals, revision history on page 2 and linked
contents on page 3. References use Document # / Date and Description columns.
See the User Guide (Help in the app). Existing checked-in documents remain protected.

PREREQUISITES
-------------
Node.js v18 or newer must be installed on your machine.
Download from: https://nodejs.org  (choose the LTS installer)

GETTING STARTED — MAC
---------------------
1. Unzip this package and move the ISAF_Customer_Edition folder anywhere
2. Double-click START.command to launch the web interface
3. Your browser will open automatically at http://localhost:3000
4. In Program Intake, start a new Aircraft, System or LRU intake, or load a config
5. Complete the steps and click Save Configuration Workbook to create and load a versioned XLSX
6. Review Config Data and resolve required values and TBD decisions
7. Enter Program Focal, select Build, choose phases/output, and click Build
8. Open Program Documents for the register and Certification preparation checklist
   Step-by-step instructions: select Help (top right) in the app to open the User Guide.

GETTING STARTED — WINDOWS
--------------------------
1. Unzip this package and move the ISAF_Customer_Edition folder anywhere
2. Double-click START.bat to launch the web interface
3. Your browser will open automatically at http://localhost:3000
4. In Program Intake, start a new Aircraft, System or LRU intake, or load a config
5. Complete the steps and click Save Configuration Workbook to create and load a versioned XLSX
6. Review Config Data and resolve required values and TBD decisions
7. Enter Program Focal, select Build, choose phases/output, and click Build
8. Open Program Documents for the register and Certification preparation checklist
   Step-by-step instructions: select Help (top right) in the app to open the User Guide.

CONFIGURATION WORKBOOK
----------------------
02_Configuration_Workbook/ contains a blank workbook to define your program.
Program Intake provides a guided way to enter these values and save a new XLSX.
In both Program Intake and Config Data, Save Configuration Workbook creates a
versioned copy beside the selected workbook and immediately loads it for Build.
It shares answers with Config Data and stores planning inputs on worksheet 16.
All included demos contain the intake fields and supplier-geography columns.
Supplier percentages are estimates with a stated basis, not FAA involvement scores.
The survey does not establish a complete or approved authority-submission package.

DEMO
----
The Admin Create Demo tab packages one sample matched to Aircraft, System, or
LRU. The standalone Demo builder defaults to the VoltCore 450 LRU sample.
Other examples are available in the Admin app's 04_Demos folder.

TEMPLATES
---------
06_Templates/ contains the .docx templates used to generate each document.
Edit these in Word to customize the content and formatting for your program.
With document control off, builds use the selected masters. Under document control,
standard builds preserve checked-in content; use New template drafts to compare changes.
Follow Document_Configuration_Control.docx for editing, release and baselines.

SUPPORT
-------
For support, licensing, or technical questions, contact your ISAF representative.
