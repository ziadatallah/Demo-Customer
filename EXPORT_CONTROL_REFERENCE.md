# Export Control Marking and ECCN reference

The Export Control Marking field supplies a company-approved marking to generated documents. It is shared between Program Intake and Config Data and retains the existing `program.export_control_marking` configuration interface.

1. In Program Intake → Program → Branding And Document Control, or Config Data → Program, select **Choose ECCN**.
2. Search by code or description. Filter by category and product group when useful. Group A concerns equipment/components, B test/inspection/production equipment, C materials, D software and E technology.
3. Select a result to read its full heading. Open **Read full entry at BIS** to review the technical criteria, notes, related controls and current classification guidance. A heading alone is not enough to classify an item.
4. After the company's export-control reviewer has determined the classification appropriate to the document contents, choose **Use selected classification**. This sets the field to, for example, `ECCN 7E994`. EAR99 is stored as `EAR99`.
5. Enter a complete company-approved marking directly if needed. Selection replaces the field text; Cancel preserves it. Use the existing **TBD** control while the determination is unresolved. Save the workbook using the normal Intake or Config Data controls.

An ECCN is five characters, for example **7A994**; “7994” is incomplete. The 7A994 heading concerns certain navigation/avionics equipment, 7D994 concerns software, and 7E994 concerns technology. These examples do not establish the classification of a particular LRU, software item or document. Consider the document's contents; do not automatically use a hardware ECCN for all lifecycle data.

EAR99 is a designation for items subject to the EAR that are not described by a CCL ECCN. It is not an ECCN and does not mean unrestricted. Destination, end-user, end-use and other applicable controls can still require authorization. Company Proprietary and CUI are not ECCNs. ITAR is a separate regulatory regime and its USML classification must be determined through the applicable review; ITAR-only cross-reference headings are not offered as selectable EAR codes.

The app does not determine EAR/ITAR jurisdiction, perform a legal classification, establish export authorization, generate a complete mandatory export notice, or enforce document distribution. It keeps the existing single program marking; individual documents may require different approved markings and review before release. Existing demo and company markings are preserved; no classification has been assigned to Astronics or any other demo.

## Official sources and reference snapshot

- [BIS classification guidance](https://www.bis.gov/licensing/classify-your-item)
- [Commerce Control List — Supplement No. 1 to 15 CFR Part 774](https://www.bis.gov/regulations/ear/774#supplement-1-774)
- [Interactive Commerce Control List](https://www.bis.gov/regulations/ear/interactive-commerce-control-list)

The bundled reference contains 607 ECCN headings extracted from the official BIS Part 774 page retrieved on 2026-09-15. The page stated an eCFR currency of September 15, 2026, 1:45 AM EDT. Thirty-one explicitly ITAR-only cross-reference headings were excluded. EAR99 is a separate additional choice. The catalog stores its source URLs, date and source-file SHA-256; it contains reference headings, not the full technical criteria.

The list works from the local app without a network request to BIS. Its dated snapshot is not automatically updated. The BIS links open the current public reference in the user's browser; the app does not send workbook values to BIS. New or changed entries can always be entered manually after company review.

## Maintenance

Before refreshing the catalog, retrieve the current official Part 774, restrict extraction to Supplement No. 1, verify entry-heading coverage and uniqueness, distinguish expressly ITAR-only/reserved cross-references, and retain the source date/hash. Do not assign classifications to existing program data during catalog maintenance. Keep the shared admin/customer UI and reference files together. The picker applies to all loaded and future configurations; native Excel cells remain the existing free-text marking field.
