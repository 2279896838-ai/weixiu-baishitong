# -*- coding: utf-8 -*-
import zipfile, shutil, os, sys
src = r"design/设计说明书.docx"
tmp = r"design/设计说明书-footer.docx"
with zipfile.ZipFile(src) as z:
    names = z.namelist()
    footers = [n for n in names if n.startswith("word/footer")]
    print("footers:", footers)
    for n in footers:
        data = z.read(n).decode("utf-8", "ignore")
        print("---", n, "has spec footer:", "提示词工程规范" in data, "has 维修百事通:", "维修百事通" in data)
then = None
with zipfile.ZipFile(src) as z, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as out:
    for item in z.infolist():
        data = z.read(item.filename)
        if item.filename in footers:
            text = data.decode("utf-8")
            before = text
            text = text.replace("提示词工程规范", "设计说明书")
            # 也处理被拆分的 run 情况
            text = text.replace("提示词工程规", "设计说明书")
            print("footer replaced:", before != text, item.filename)
            data = text.encode("utf-8")
        out.writestr(item, data)
os.replace(tmp, src)
print("done")
