# -*- coding: utf-8 -*-
import sys
from docx import Document
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

src, dst = sys.argv[1], sys.argv[2]
doc = Document(src)
body = doc.element.body
sdt = None
for el in body.iterchildren():
    if el.tag == qn("w:sdt"):
        instr = "".join((i.text or "") for i in el.iter(qn("w:instrText")))
        if "TOC" in instr:
            sdt = el
            break
if sdt is None:
    print("NO TOC SDT FOUND")
    sys.exit(2)

def page_break():
    p = OxmlElement("w:p")
    r = OxmlElement("w:r")
    br = OxmlElement("w:br")
    br.set(qn("w:type"), "page")
    r.append(br)
    p.append(r)
    return p

target = None
for p in doc.paragraphs:
    if p.style is not None and p.style.name == "Heading 1" and p.text.strip().startswith("1 "):
        target = p._p
        break
if target is None:
    print("NO H1 TARGET")
    sys.exit(3)

pb1 = page_break()
target.addprevious(pb1)
target.addprevious(sdt)
target.addprevious(page_break())

# rename TOC heading
for t in sdt.iter(qn("w:t")):
    if (t.text or "").strip() in ("Table of Contents", "Contents"):
        t.text = "目录"
        for r in t.getparent().iterchildren():
            pass

doc.save(dst)
print("saved", dst)
