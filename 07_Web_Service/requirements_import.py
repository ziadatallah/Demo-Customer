#!/usr/bin/env python3
"""Requirements import for the Import tab (v5.3.28).

  inspect FILE           Read a ReqIF (.reqif, .reqifz), Excel (.xlsx, .xlsm) or CSV file and print JSON:
                         format, attributes (names, sample values, how often filled), objects (attribute -> text),
                         relations (ReqIF links) and specifications. The browser maps attributes to ID, text,
                         parent links and so on; requirements_review.js then reviews them.
  report REVIEW OUT      Write the review result (JSON file REVIEW) as an Excel workbook OUT: Summary, Findings,
                         Requirements, Trace and Checklist evidence sheets.

ReqIF is the OMG Requirements Interchange Format exported by IBM DOORS / DOORS Next, Siemens Polarion, Jama Connect
and others. Only the standard library is used for ReqIF and CSV; Excel needs openpyxl (already required by ISAF).
"""
import csv
import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

MAX_OBJECTS = 50000


def local(tag):
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def children(el, name):
    return [c for c in list(el) if local(c.tag) == name]


def child(el, name):
    for c in list(el):
        if local(c.tag) == name:
            return c
    return None


def find_all(el, name):
    return [e for e in el.iter() if local(e.tag) == name]


def xhtml_text(el):
    """Visible text of an XHTML value: paragraphs and line breaks become new lines."""
    parts = []

    def walk(node):
        tag = local(node.tag)
        if tag in ("br",):
            parts.append("\n")
        if node.text:
            parts.append(node.text)
        for c in list(node):
            walk(c)
            # Table cells need a separator of their own. Without one, a DOORS requirement
            # holding a table arrives as "Input voltage18 V32 V", and every later check -
            # units, ambiguous terms, duplicate text - then runs on mangled input.
            if local(c.tag) in ("td", "th"):
                parts.append(" ")
            elif local(c.tag) in ("p", "div", "li", "tr", "h1", "h2", "h3", "h4"):
                parts.append("\n")
            if c.tail:
                parts.append(c.tail)

    walk(el)
    text = "".join(parts)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


def read_reqif(data):
    root = ET.fromstring(data)
    content = next(iter(find_all(root, "REQ-IF-CONTENT")), None)
    if content is None:
        raise ValueError("This is not a ReqIF file (no REQ-IF-CONTENT).")
    names = {}  # identifier -> LONG-NAME (attribute definitions, types, enum values, specifications)
    for el in content.iter():
        ident, long_name = el.get("IDENTIFIER"), el.get("LONG-NAME")
        if ident and long_name:
            names[ident] = long_name
    # A production DOORS module can define many attributes under one LONG-NAME (seen: about
    # twenty sharing a single name). Keyed by display name alone their values overwrite one
    # another, so later duplicates take a numbered suffix and every value survives.
    attr_names, seen_attr = {}, {}
    for el in content.iter():
        if not local(el.tag).startswith("ATTRIBUTE-DEFINITION"):
            continue
        ident, long_name = el.get("IDENTIFIER"), el.get("LONG-NAME")
        if not ident or not long_name:
            continue
        n = seen_attr.get(long_name, 0) + 1
        seen_attr[long_name] = n
        attr_names[ident] = long_name if n == 1 else f"{long_name} ({n})"
    objects, order = {}, []
    for so in find_all(content, "SPEC-OBJECT"):
        ident = so.get("IDENTIFIER")
        if not ident or ident in objects:
            continue
        values = {"(ReqIF identifier)": ident}
        type_ref = child(so, "TYPE")
        if type_ref is not None and len(type_ref):
            values["(ReqIF object type)"] = names.get((type_ref[0].text or "").strip(), (type_ref[0].text or "").strip())
        vals = child(so, "VALUES")
        for v in list(vals) if vals is not None else []:
            kind = local(v.tag)
            definition = child(v, "DEFINITION")
            ref = (definition[0].text or "").strip() if definition is not None and len(definition) else ""
            name = attr_names.get(ref) or names.get(ref, ref) or kind
            if kind == "ATTRIBUTE-VALUE-XHTML":
                the = child(v, "THE-VALUE")
                text = xhtml_text(the) if the is not None else ""
            elif kind == "ATTRIBUTE-VALUE-ENUMERATION":
                vv = child(v, "VALUES")
                refs = [(r.text or "").strip() for r in (list(vv) if vv is not None else [])]
                text = ", ".join(names.get(r, r) for r in refs if r)
            else:
                text = v.get("THE-VALUE", "")
            values[name] = text
        objects[ident] = values
        order.append(ident)
        if len(order) >= MAX_OBJECTS:
            break
    # DOORS does not remove a deleted object from an export; it marks it ReqIF.ForeignDeleted.
    # Importing one as a live requirement would put a deleted requirement into the review and
    # into the documents, so they are dropped and counted, never silently swallowed.
    deleted = [i for i, o in objects.items()
               if any(k.strip().lower() == "reqif.foreigndeleted" and str(v).strip().lower() == "true"
                      for k, v in o.items())]
    for i in deleted:
        del objects[i]
    order = [i for i in order if i in objects]
    meta = {"deleted": len(deleted)}
    relations = []
    for rel in find_all(content, "SPEC-RELATION"):
        src, tgt, typ = child(rel, "SOURCE"), child(rel, "TARGET"), child(rel, "TYPE")
        s = (src[0].text or "").strip() if src is not None and len(src) else ""
        t = (tgt[0].text or "").strip() if tgt is not None and len(tgt) else ""
        ty = (typ[0].text or "").strip() if typ is not None and len(typ) else ""
        if s and t:
            relations.append({"source": s, "target": t, "type": names.get(ty, ty)})
    # Specifications (documents) and the order of objects within them.
    specs, membership, ordered = [], {}, []
    for spec in find_all(content, "SPECIFICATION"):
        spec_name = spec.get("LONG-NAME") or spec.get("IDENTIFIER") or "Specification"
        count = 0

        def walk(h, depth):
            nonlocal count
            for sh in children(h, "SPEC-HIERARCHY"):
                obj = child(sh, "OBJECT")
                ref = (obj[0].text or "").strip() if obj is not None and len(obj) else ""
                if ref in objects and ref not in membership:
                    membership[ref] = spec_name
                    objects[ref]["(Specification)"] = spec_name
                    objects[ref]["(Outline level)"] = str(depth)
                    ordered.append(ref)
                    count += 1
                kids = child(sh, "CHILDREN")
                if kids is not None:
                    walk(kids, depth + 1)

        kids = child(spec, "CHILDREN")
        if kids is not None:
            walk(kids, 1)
        specs.append({"name": spec_name, "objects": count})
    ordered += [i for i in order if i not in membership]
    return "reqif", [objects[i] for i in ordered], relations, specs, meta


def read_table(rows, fmt):
    rows = [["" if c is None else str(c).strip() for c in r] for r in rows]
    header_index = next((i for i, r in enumerate(rows) if sum(1 for c in r if c) >= 2), None)
    if header_index is None:
        raise ValueError("No header row found (a row with at least two column names).")
    header, seen = [], {}
    for i, h in enumerate(rows[header_index]):
        h = h or f"Column {i + 1}"
        if h in seen:
            seen[h] += 1
            h = f"{h} ({seen[h]})"
        else:
            seen[h] = 1
        header.append(h)
    objects = []
    for r in rows[header_index + 1:]:
        if not any(r):
            continue
        objects.append({header[i]: (r[i] if i < len(r) else "") for i in range(len(header))})
        if len(objects) >= MAX_OBJECTS:
            break
    return fmt, objects, [], [{"name": "Rows", "objects": len(objects)}], {}


def read_file(path):
    p = Path(path)
    ext = p.suffix.lower()
    data = p.read_bytes()
    if ext == ".reqifz" or (data[:2] == b"PK" and ext not in (".xlsx", ".xlsm")):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            inner = next((n for n in z.namelist() if n.lower().endswith(".reqif")), None)
            if not inner:
                raise ValueError("The .reqifz archive contains no .reqif file.")
            return read_reqif(z.read(inner))
    if ext in (".reqif", ".xml"):
        return read_reqif(data)
    if ext in (".xlsx", ".xlsm"):
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        best = max(wb.worksheets, key=lambda ws: (ws.max_row or 0))
        return read_table(list(best.iter_rows(values_only=True)), "xlsx")
    if ext in (".csv", ".txt"):
        text = data.decode("utf-8-sig", errors="replace")
        try:
            dialect = csv.Sniffer().sniff(text[:5000], delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        return read_table(list(csv.reader(io.StringIO(text), dialect)), "csv")
    raise ValueError("Use a ReqIF (.reqif, .reqifz), Excel (.xlsx) or CSV file.")


def inspect(path):
    fmt, objects, relations, specs, meta = read_file(path)
    attrs = {}
    for o in objects:
        for k, v in o.items():
            a = attrs.setdefault(k, {"name": k, "filled": 0, "samples": []})
            if v:
                a["filled"] += 1
                if len(a["samples"]) < 3 and v not in a["samples"]:
                    a["samples"].append(v[:160])
    return {"format": fmt, "objects": objects, "relations": relations, "specifications": specs,
            "attributes": list(attrs.values()), "count": len(objects), **meta}


def report(review_path, out_path):
    import openpyxl
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    r = json.loads(Path(review_path).read_text(encoding="utf-8"))
    wb = openpyxl.Workbook()
    head_fill, head_font = PatternFill("solid", fgColor="1F3A5F"), Font(bold=True, color="FFFFFF")
    sev_fill = {"Error": PatternFill("solid", fgColor="F8D7DA"), "Warning": PatternFill("solid", fgColor="FFF3CD"), "Info": PatternFill("solid", fgColor="E7F1FF")}

    def sheet(ws, headers, rows, widths):
        ws.append(headers)
        for c in ws[1]:
            c.fill, c.font = head_fill, head_font
            c.alignment = Alignment(vertical="top", wrap_text=True)
        for row in rows:
            ws.append(["" if v is None else v for v in row])
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        for row in ws.iter_rows(min_row=2):
            for c in row:
                c.alignment = Alignment(vertical="top", wrap_text=True)
        ws.freeze_panes = "A2"
        if rows:
            ws.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{len(rows) + 1}"

    ws = wb.active
    ws.title = "Summary"
    meta = r.get("meta", {})
    ws.append(["ISAF Requirements Check Report"])
    ws["A1"].font = Font(bold=True, size=14)
    for k, v in [("Program", meta.get("program", "")), ("Generated", meta.get("generated", "")), ("ISAF version", meta.get("version", "")),
                 ("Note", "Automatic checks to ease the review. The requirements review itself is performed and signed by the reviewer.")]:
        ws.append([k, v])
    ws.append([])
    ws.append(["Level", "Requirements", "Errors", "Warnings", "Info", "Traced to parent", "With children", "With tests"])
    for c in ws[ws.max_row]:
        c.fill, c.font = head_fill, head_font
    for s in r.get("stats", []):
        ws.append([s.get("label"), s.get("requirements"), s.get("errors"), s.get("warnings"), s.get("info"), s.get("tracedText", ""), s.get("childrenText", ""), s.get("testsText", "")])
    ws.column_dimensions["A"].width, ws.column_dimensions["B"].width = 34, 60
    for col in "CDEFGH":
        ws.column_dimensions[col].width = 16

    findings = r.get("findings", [])
    ws2 = wb.create_sheet("Findings")
    sheet(ws2, ["Severity", "Check", "Level", "Requirement", "Finding", "Requirement text", "Reference", "Disposition", "Reviewer notes"],
          [[f.get("severity"), f.get("check"), f.get("levelLabel"), f.get("reqId"), f.get("message"), f.get("text", "")[:500], f.get("ref"), "", ""] for f in findings],
          [10, 26, 18, 18, 50, 60, 22, 16, 30])
    for row in ws2.iter_rows(min_row=2):
        fill = sev_fill.get(row[0].value)
        if fill:
            row[0].fill = fill

    ws3 = wb.create_sheet("Requirements")
    sheet(ws3, ["Level", "ID", "Text", "Traces to", "Traced by", "Tests", "Derived", "Rationale", "Verification", "Validation", "Validation conclusion", "Assumption", "Safety", "DAL", "Source", "Findings"],
          [[q.get("levelLabel"), q.get("id"), q.get("text", "")[:2000], ", ".join(q.get("parents", [])), ", ".join(q.get("children", [])), ", ".join(q.get("tests", [])),
            "Yes" if q.get("derived") else "", q.get("rationale", ""), q.get("verification", ""), q.get("validation", ""), q.get("validationStatus", ""),
            "Yes" if q.get("assumption") else "", q.get("safety", ""), q.get("dal", ""), q.get("origin", ""), q.get("findingCount", 0)] for q in r.get("requirements", [])],
          [18, 18, 70, 24, 24, 24, 9, 30, 16, 16, 16, 10, 14, 6, 18, 10])

    ws4 = wb.create_sheet("Trace")
    sheet(ws4, ["Parent level", "Parent", "Child level", "Child"],
          [[t.get("parentLevel"), t.get("parent"), t.get("childLevel"), t.get("child")] for t in r.get("trace", [])], [22, 22, 22, 22])

    ws5 = wb.create_sheet("Checklist evidence")
    sheet(ws5, ["Area", "Review question", "Reference", "Result", "Evidence", "Reviewer decision"],
          [[c.get("area", ""), c.get("question"), c.get("ref"), c.get("status"), c.get("evidence"), ""] for c in r.get("checklist", [])], [22, 50, 22, 16, 70, 20])
    wb.save(out_path)


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == "inspect":
        try:
            print(json.dumps(inspect(sys.argv[2]), ensure_ascii=False))
        except Exception as e:  # reported to the browser as a plain message
            print(json.dumps({"error": str(e) or e.__class__.__name__}))
            sys.exit(2)
    elif len(sys.argv) >= 4 and sys.argv[1] == "report":
        report(sys.argv[2], sys.argv[3])
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
