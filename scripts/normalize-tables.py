# -*- coding: utf-8 -*-
"""Equalize DOCX table column widths so pandoc pipe-table width heuristics
cannot produce degenerate grids (e.g. 1-char 编号 columns)."""
import sys, zipfile, shutil
from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}
T = "{%s}" % W

src, dst = sys.argv[1], sys.argv[2]
zin = zipfile.ZipFile(src)
# read section text width
doc = etree.fromstring(zin.read("word/document.xml"))
sect = doc.find(".//w:sectPr", NS)
pgW = int(sect.find("./w:pgSz", NS).get(T + "w"))
mar = sect.find("./w:pgMar", NS)
left = int(mar.get(T + "left")); right = int(mar.get(T + "right"))
textW = pgW - left - right

n_tables = 0
for tbl in doc.findall(".//w:tbl", NS):
    grid = tbl.find("./w:tblGrid", NS)
    if grid is None:
        continue
    cols = grid.findall("./w:gridCol", NS)
    n = len(cols)
    if n == 0:
        continue
    width = textW // n
    for c in cols:
        c.set(T + "w", str(width))
    # table width 100%
    tblPr = tbl.find("./w:tblPr", NS)
    if tblPr is not None:
        tw = tblPr.find("./w:tblW", NS)
        if tw is not None:
            tw.set(T + "w", "5000"); tw.set(T + "type", "pct")
        layout = tblPr.find("./w:tblLayout", NS)
        if layout is not None:
            layout.set(T + "type", "fixed")
    for tr in tbl.findall("./w:tr", NS):
        for tc in tr.findall("./w:tc", NS):
            tcPr = tc.find("./w:tcPr", NS)
            if tcPr is None:
                tcPr = etree.SubElement(tc, T + "tcPr"); tc.insert(0, tcPr)
            tcW = tcPr.find("./w:tcW", NS)
            if tcW is None:
                tcW = etree.SubElement(tcPr, T + "tcW")
            tcW.set(T + "w", str(width)); tcW.set(T + "type", "dxa")
    n_tables += 1

xml = etree.tostring(doc, xml_declaration=True, encoding="UTF-8", standalone=True)
zout = zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    if item.filename == "word/document.xml":
        zout.writestr(item, xml)
    else:
        zout.writestr(item, zin.read(item.filename))
zout.close()
print("tables normalized:", n_tables, "textW:", textW)
