# -*- coding: utf-8 -*-
import math, os
from PIL import Image, ImageDraw, ImageFont

OUT = "design/images"
os.makedirs(OUT, exist_ok=True)
FONT = "C:/Windows/Fonts/msyh.ttc"
FONT_B = "C:/Windows/Fonts/msyhbd.ttc"
NAVY = "#0f2d5c"; BLUE = "#2563eb"; GRAY = "#475569"

def font(size, bold=False):
    return ImageFont.truetype(FONT_B if bold else FONT, size)

def wrap(d, text, f, maxw):
    lines, cur = [], ""
    for ch in text:
        trial = cur + ch
        if d.textlength(trial, font=f) <= maxw:
            cur = trial
        else:
            lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    return lines

def box(d, x0, y0, w, h, text, f, fill, outline="#94a3b8"):
    d.rounded_rectangle((x0, y0, x0 + w, y0 + h), radius=12, fill=fill, outline=outline, width=2)
    lh = int(f.size * 1.35)
    lines = wrap(d, text, f, w - 22)
    total = len(lines) * lh
    ty = y0 + (h - total) / 2
    for ln in lines:
        tw = d.textlength(ln, font=f)
        d.text((x0 + (w - tw) / 2, ty), ln, font=f, fill="#1f2937")
        ty += lh

def arrow(d, pts, color=BLUE, width=4):
    d.line(pts, fill=color, width=width, joint="curve")
    (x1, y1), (x2, y2) = pts[-2], pts[-1]
    ang = math.atan2(y2 - y1, x2 - x1)
    for da in (0.42, -0.42):
        d.line((x2, y2, x2 - 17 * math.cos(ang - da), y2 - 17 * math.sin(ang - da)), fill=color, width=width)

def diamond(d, cx, y, w, h, text, f, fill="#fff7e6", outline="#d97706"):
    pts = [(cx, y), (cx + w / 2, y + h / 2), (cx, y + h), (cx - w / 2, y + h / 2)]
    d.polygon(pts, fill=fill, outline=outline, width=2)
    lines = wrap(d, text, f, w - 90)
    lh = int(f.size * 1.3)
    ty = y + (h - len(lines) * lh) / 2
    for ln in lines:
        tw = d.textlength(ln, font=f)
        d.text((cx - tw / 2, ty), ln, font=f, fill="#92400e")
        ty += lh
    return (cx, y + h / 2)

# ================= 1. 功能架构图 =================
W, H = 1820, 1240
img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)
d.text((58, 34), "维修百事通 · 功能架构图", font=font(46, True), fill=NAVY)
d.text((58, 92), "实训车间 / 中小企业设备维护 · 提示词工程驱动的知识助手", font=font(22), fill=GRAY)
layers = [
    ("用户层", ["学生（受训操作者）", "实训教师（安全责任人）", "实训室管理员", "维修工 / 安全员"], "#e8f0fe"),
    ("展示层", ["故障问答", "排查引导", "点检填报", "异常看板", "工单与知识回流"], "#e6f4ea"),
    ("智能层", ["意图路由", "RAG 检索", "诊断合成", "决策树引导", "填报校验", "看板分析"], "#fff4e5"),
    ("提示词层", ["系统提示词", "意图路由", "场景提示词", "检索改写 / 重排", "安全 / 修复 / 评测", "知识抽取 / 访谈", "点检校验 / 看板"], "#f3e8ff"),
    ("数据层", ["设备台账 16 台", "知识库 63 条", "点检模板 119 项", "决策树 5 棵", "评测集 78 条", "教师访谈 3 篇"], "#e0f2fe"),
    ("基础设施", ["Python 标准库 离线引擎", "可选 LLM（OpenAI 兼容）", "localStorage / JSONL 运行数据"], "#f1f5f9"),
]
y = 140
step = 158
for idx, (name, items, color) in enumerate(layers):
    h = step - 24
    d.rounded_rectangle((48, y, W - 48, y + h), radius=16, fill=color, outline="#1f3a68", width=2)
    d.text((66, y + (h - 34) / 2), name, font=font(27, True), fill="#1e3a8a")
    avail_x0, avail_x1 = 360, W - 64
    n = len(items)
    gap = 14
    bw = (avail_x1 - avail_x0 - gap * (n - 1)) / n
    for i, it in enumerate(items):
        x0 = avail_x0 + i * (bw + gap)
        box(d, x0, y + 20, bw, h - 40, it, font(20), "white")
    if idx < len(layers) - 1:
        arrow(d, [(W / 2, y + h + 2), (W / 2, y + step - 4)])
    y += step
img.save(os.path.join(OUT, "architecture.png"), "PNG")

# ================= 2. 问答与引导流程 =================
W, H = 1560, 1460
img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)
d.text((58, 34), "故障问答与排查引导流程", font=font(46, True), fill=NAVY)
cx = 760
fz = font(24, True)
fs = font(21)

y = 130
box(d, cx - 300, y, 600, 74, "用户提问（学生 / 教师 / 管理员）", font(24, True), "#e8f0fe")
arrow(d, [(cx, y + 74), (cx, y + 122)])
y += 122
diamond(d, cx, y, 640, 110, "是否命中安全红线？", fz)
arrow(d, [(cx - 320, y + 55), (420, y + 55)], "#b91c1c")
d.text((486, y + 22), "是", font=font(22, True), fill="#b91c1c")
box(d, 60, y + 2, 350, 108, "拦截：停机 / 断电 / 挂牌 / 泄压；给出安全动作与合规路径；转人工（教师 / 持证人员）", fs, "#fee2e2")
arrow(d, [(cx, y + 110), (cx, y + 158)])
d.text((cx + 12, y + 118), "否", font=font(22, True), fill="#15803d")
y += 158
box(d, cx - 330, y, 660, 76, "意图识别与槽位抽取（设备 / 现象 / 频次）", font(24, True), "#e8f0fe")
arrow(d, [(cx, y + 76), (cx, y + 122)])
y += 122
diamond(d, cx, y, 620, 108, "知识库有可用证据？", fz)
arrow(d, [(cx - 310, y + 54), (420, y + 54)], "#d97706")
d.text((492, y + 20), "否", font=font(22, True), fill="#d97706")
box(d, 60, y, 350, 108, "拒答 / 追问：说明未检索到依据，给出安全自查建议，转人工；不编造原因与阈值", fs, "#fef3c7")
arrow(d, [(cx, y + 108), (cx, y + 156)])
d.text((cx + 12, y + 116), "是", font=font(22, True), fill="#15803d")
y += 156
box(d, cx - 360, y, 720, 88, "检索 → 重排 → 生成诊断（原因按概率排序 / 验证方法 / 安全处置 / 引用）", font(23, True), "#e8f0fe")
arrow(d, [(cx, y + 88), (cx, y + 134)])
y += 134
diamond(d, cx, y, 560, 104, "需要现场逐项排查？", fz)
arrow(d, [(cx + 280, y + 52), (1220, y + 52)], "#64748b")
d.text((1050, y + 14), "否", font=font(22, True), fill="#64748b")
box(d, 1220, y + 2, 300, 100, "结束：输出结论、处置、风险与引用", fs, "#f1f5f9")
arrow(d, [(cx, y + 104), (cx, y + 152)])
d.text((cx + 12, y + 112), "是", font=font(22, True), fill="#15803d")
y += 152
box(d, cx - 400, y, 800, 84, "排查引导：S0 现象确认 → S1 安全确认 → S2 分支 → S3 结论", font(24, True), "#e6f4ea")
box(d, 60, y + 108, 1440, 108, "每轮只问一个可判定问题；S1 未确认安全不得进入测量节点；轮次上限 8；到叶节点给结论并回写会话状态。", fs, "#f8fafc")
img.save(os.path.join(OUT, "qa-flow.png"), "PNG")

# ================= 3. 点检闭环流程 =================
W, H = 1820, 900
img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)
d.text((58, 34), "点检填报 → 异常 → 看板 → 工单 → 知识回流", font=font(44, True), fill=NAVY)
row1 = ["生成点检清单", "现场填报 OK / 异常 / 不适用", "提交校验 缺项 / 矛盾", "异常记录 定级", "看板汇总", "创建工单"]
row2 = ["维修处置", "结案回填", "知识候选", "复核入库", "检索复用"]
bw, gap = 252, 36
x0 = 58
for i, s in enumerate(row1):
    x = x0 + i * (bw + gap)
    box(d, x, 180, bw, 96, s, font(21, True), "#e8f0fe")
    if i < len(row1) - 1:
        arrow(d, [(x + bw, 228), (x + bw + gap, 228)])
lastx = x0 + (len(row1) - 1) * (bw + gap) + bw // 2
firstx = x0 + bw // 2
arrow(d, [(lastx, 276), (lastx, 372), (firstx, 372), (firstx, 470)])
for i, s in enumerate(row2):
    x = x0 + i * (bw + gap)
    box(d, x, 470, bw, 96, s, font(21, True), "#e6f4ea")
    if i < len(row2) - 1:
        arrow(d, [(x + bw, 518), (x + bw + gap, 518)])
endx = x0 + (len(row2) - 1) * (bw + gap) + bw // 2
arrow(d, [(endx, 566), (endx, 690), (70, 690), (70, 228), (56, 228)], "#64748b")
d.text((100, 646), "知识复用：问答与引导引用，提升准确率与新人上手速度", font=font(21), fill=GRAY)
img.save(os.path.join(OUT, "inspection-flow.png"), "PNG")
print("diagrams v2 done")
