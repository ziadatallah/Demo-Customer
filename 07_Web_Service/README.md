Current release: ISAF v5.3.38. Hosted builds return an authenticated temporary `/api/download` URL and the Build tab provides a ZIP download action. The web service supports Admin, Customer and Demo editions. See the root User Guide and release verification for workflow and test details.

Current release: ISAF v4.0.17. See the main-folder README and Word guides for current behavior. Historical notes below retain their original versions.

Current release: ISAF v4.0.5. See the main-folder README and the in-app User Guide (Help, top right) for current field controls and ECCN help. Historical notes below retain their original versions.

# v4.0.4 runtime additions

Program Intake uses intake_routes.js, intake_workbook.py, intake-schema.json, engineering_workbook.py and engineering-schema.json. Keep these with save_config.py/workbook_layout.py/open_decisions.py and their schema files. Python 3 with openpyxl is required for creating/saving workbooks.

Company identity fields `intake.cage_code` and `intake.company_address` are stored in the Program Intake sheet and shown on generated covers. CAGE / NCAGE is company identity only and is never included in a document PN.

Certification preparation uses certification_package.js, certification-catalog.json, config_validation.bundle.js, repository_routes.js and the shared repository store. Both web editions retain these files plus public/certification-package.js/.css and public/engineering-fields.js. Run 08_Packaging/bundle_engine.js after changes to source parsing or validation, before exporting a customer edition. Customer runtime must not depend on the stripped 03_Build_Engine/src folder. The validation bundle uses a bundled copy of its parser dependencies so it can be imported from 07_Web_Service without relying on sibling node_modules paths.

The checklist uses the repository program’s saved config, not unsaved browser edits. No external authority API or file upload is called. Runtime review ZIPs are assembled from immutable blob hashes. Back up the complete repository to preserve them. Names remain local activity labels, not authenticated users. See the root User Guide chapters 18–21.

---

# ISAF (Integrated Standards Assurance Framework) Web Service — Deployment Guide

## What This Is

A lightweight web service that wraps the ISAF build engine in an HTTP
API. Partners upload their program workbook through a browser and
download a ZIP of generated certification documents. The engine,
templates, and data files never leave your server.

## Quick Start (Local)

```bash
cd 07_Web_Service
npm install
ISAF_API_KEY=yourSecretKey node server.js
```

Open http://localhost:3000. Program Intake is the first tab. Start a blank program or load a config, save the workbook, then review Config Data and Build. See the root ISAF_User_Guide_v4.docx for the full workflow.

## Quick Start (Docker)

```bash
# From the ISAF root directory:
docker build -t isaf-web .
docker run -p 3000:3000 -e ISAF_API_KEY=yourSecretKey isaf-web
```

## Deploy to a Cloud Server

### Option A: DigitalOcean ($6–12/month)

1. Create a Droplet (Ubuntu 24.04, 1 GB RAM minimum)
2. SSH in and install Docker:
   ```
   curl -fsSL https://get.docker.com | sh
   ```
3. Copy the ISAF package to the server:
   ```
   scp ISAF_v3.20.1.zip root@your-server:/opt/
   ```
4. Unzip, build, and run:
   ```
   cd /opt && unzip ISAF_v3.20.1.zip
   cd ISAF_v3.19.2
   docker build -t isaf-web .
   docker run -d --restart unless-stopped \
     -p 443:3000 \
     -e ISAF_API_KEY=yourSecretKey \
     --name isaf \
     isaf-web
   ```

### Option B: AWS EC2

Same steps on a t3.micro or t3.small instance. Add an Elastic IP
and configure the security group to allow inbound HTTPS (443).

### HTTPS (Required for Production)

Use a reverse proxy (nginx or Caddy) with a Let's Encrypt certificate:

```bash
# Install Caddy (auto-HTTPS)
apt install caddy

# /etc/caddy/Caddyfile:
yourdomain.com {
    reverse_proxy localhost:3000
}

systemctl restart caddy
```

Caddy automatically provisions and renews TLS certificates.

## API Key Management

Each partner gets their own API key. Set multiple keys by
comma-separating them in the ISAF_API_KEY environment variable
(requires a small server.js modification for multi-key support),
or run separate containers per partner.

## API Reference

### POST /api/build

Upload a workbook and receive a ZIP of generated documents.

```bash
curl -X POST \
  -H "X-API-Key: yourSecretKey" \
  -F "workbook=@ISAF_DEMO_Aircraft_eVTOL_do160.xlsx" \
  http://localhost:3000/api/build \
  -o output.zip
```

**Request:** multipart/form-data with a `workbook` field (.xlsx or .xlsm)
**Response:** application/zip containing all generated documents
**Auth:** X-API-Key header or ?key= query parameter

### GET /api/health

```json
{ "status": "ok", "version": "3.20.1" }
```

## Security Notes

- The API key is transmitted in the HTTP header. Always use HTTPS
  in production.
- Uploaded workbooks and generated output are deleted automatically
  after each build (5-second delay for streaming).
- The engine runs in an isolated container. Partners never see the
  source code, templates, or data files.
- Consider IP-whitelisting your partner's office IP in the firewall
  for additional security.

## Estimated Costs

| Provider     | Instance     | Monthly Cost |
|-------------|-------------|-------------|
| DigitalOcean | Basic 1 GB   | $6          |
| DigitalOcean | Basic 2 GB   | $12         |
| AWS EC2      | t3.micro     | ~$8         |
| AWS EC2      | t3.small     | ~$15        |

Add ~$0/month for HTTPS (Let's Encrypt is free) and ~$1/month for
a domain name if you don't already have one.

## Program Intake implementation

The shared admin/customer UI uses `public/program-intake.js` and its CSS. Authenticated `/api/intake/new`, `/workbook` and `/demo-file` routes create a blank workbook, save edited inputs, or read a packaged demo. `intake_workbook.py` and `intake-schema.json` must be shipped beside `save_config.py`, `workbook_layout.py`, palette/layout JSON and `open_decisions.py`. Python 3 with openpyxl is required for XLSX creation/saving. Temporary request files are removed after completion.

The saved workbook contains `16. Program Intake` with field labels, keys, answers, help and requirements, and Suppliers columns J–N. The reader accepts both legacy two-column intake data and the current keyed layout. Config Data saves preserve intake inputs and newly added item rows. Intake schemas and UI help/options must be updated together. Keep master, demo and desktop sample workbooks aligned.

The approval path is planning/configuration input. It does not by itself validate a complete TSOA or aircraft TC/STC submission. Do not present the completion counter or a successful build as authority approval.
