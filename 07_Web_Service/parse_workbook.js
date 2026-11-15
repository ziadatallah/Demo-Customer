#!/usr/bin/env node
/**
 * Parse an ISAF workbook and output JSON to stdout.
 * Called by the web service's /api/parse endpoint.
 *
 * Usage: node parse_workbook.js <workbook.xlsx>
 */
import { readWorkbook } from "../03_Build_Engine/src/read_workbook.js";

import { readWorkbookComments } from "./workbook_comments.js";

const wbPath = process.argv[2];
if (!wbPath) {
  process.stderr.write("Usage: node parse_workbook.js <workbook.xlsx>\n");
  process.exit(1);
}

try {
  const data = readWorkbook(wbPath);
  data._fieldComments = readWorkbookComments(wbPath);
  process.stdout.write(JSON.stringify(data));
} catch (err) {
  process.stderr.write(`Parse error: ${err.message}\n`);
  process.exit(1);
}
