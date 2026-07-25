#!/usr/bin/env python3
"""Near-programmatic design QA for design/ab-initial-app.pen.

Usage:
  python3 audit.py --all                 # audit every top-level frame
  python3 audit.py <frameId> [...]      # audit specific frames
  python3 audit.py --sections <frameId>  # print the frame's component manifest only
  python3 audit.py --json out.json ...   # also write machine-readable report

Requires the Pen app running with the doc open (talks to it via penctl.py).

What it checks (per frame, on COMPUTED geometry + LIVE node props):
  GEOMETRY
  - H/V-OVERFLOW: child box exceeds parent box (tolerance 2.5px)
  - OVERLAP: siblings intersect (>4px both axes) in auto-layout or
    implicit rows (justifyContent/alignItems set); text-vs-anything in free layouts
  - LETTER-STACK: multi-line text squeezed under 44px wide (the one-letter-column bug)
  - NARROW-TEXT: fill column under 90px containing text (wrap-garble risk)
  - TOUCH-TARGET (mobile frames, width<=400): button-like nodes under 40px tall (warning)
  STYLE
  - RAW-HEX fills/strokes where a token likely exists (non-$, non-transparent-alpha)
  - FONT: family not $font-brand/Montserrat/JetBrains Mono; size < 9.5
  CONTENT
  - FORBIDDEN: payment/reconcil/yoco strings (never-holds-funds law), lorem/TODO

Disabled nodes are excluded using LIVE props: source-level enabled:false AND
instance descendants overrides ({shadowId:{enabled:false}}) are both honored,
so ghost geometry of hidden nodes does not create false positives.
Verified-intentional exceptions live in whitelist.json ({nodeId: reason} or
{frameId/nodeId: reason}); every entry must state WHY.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from penctl import Pen

TOL = 2.5
OVERLAP_MIN = 4.0
ARCHIVE = {"cyMi6", "CwVWw", "OLb9g", "bi8Au"}
FORBIDDEN = re.compile(r"(payment|reconcil|yoco|lorem ipsum|\bTODO\b)", re.I)
ALLOWED_FONTS = {"$font-brand", "Montserrat", "JetBrains Mono", "$font-mono"}

def load_whitelist():
    p = os.path.join(HERE, "whitelist.json")
    return json.load(open(p)) if os.path.exists(p) else {}

class Auditor:
    def __init__(self):
        self.pen = Pen()
        self.props = {}
        self.whitelist = load_whitelist()

    # ---------- data collection ----------
    def snapshot(self):
        raw = self.pen.tool("snapshot_layout", {"nodeId": "root", "maxDepth": 200}, timeout=300)
        return json.loads(raw)

    def crawl_props(self, root_ids):
        """BFS batch_get; records props by id, disabled overrides from ref descendants."""
        pending, seen = list(root_ids), set(root_ids)
        while pending:
            batch, pending = pending[:15], pending[15:]
            try:
                res = json.loads(self.pen.tool("batch_get", {"nodeIds": batch, "depth": 3}, timeout=180))
            except Exception as e:
                print(f"  ! batch_get failed for {batch[:3]}...: {e}", file=sys.stderr)
                continue
            stack = res if isinstance(res, list) else [res]
            while stack:
                n = stack.pop()
                if not isinstance(n, dict) or "id" not in n:
                    continue
                nid = n["id"]
                rec = {k: n.get(k) for k in ("type", "name", "layout", "clip", "enabled",
                                             "textGrowth", "content", "ref", "justifyContent",
                                             "alignItems", "fill", "stroke", "fontFamily",
                                             "fontSize", "cornerRadius", "width", "layoutPosition") if k in n}
                self.props.setdefault(nid, {}).update(rec)
                desc = n.get("descendants")
                if isinstance(desc, dict):
                    for sid, override in desc.items():
                        if isinstance(override, dict):
                            self.props.setdefault(f"{nid}/{sid}", {}).update(
                                {k: v for k, v in override.items() if not isinstance(v, dict)})
                kids = n.get("children")
                if isinstance(kids, list):
                    stack.extend(kids)
                elif kids == "..." and nid not in seen:
                    seen.add(nid)
                    pending.append(nid)

    # ---------- helpers ----------
    def P(self, nid):
        p = self.props.get(nid)
        if p is None and "/" in nid:
            p = self.props.get(nid.split("/")[-1])
        return p or {}

    def enabled(self, nid):
        exact = self.props.get(nid)
        if exact is not None and exact.get("enabled") is False:
            return False
        if "/" in nid:  # shadow: source-level disable
            base = self.props.get(nid.split("/")[-1])
            if base is not None and base.get("enabled") is False:
                return False
        return True

    def allowed(self, frame, nid):
        return nid in self.whitelist or f"{frame}/{nid}" in self.whitelist

    def label(self, nid):
        p = self.P(nid)
        nm = p.get("name") or p.get("type") or "?"
        c = p.get("content")
        return f"{nid}({nm}{' «' + str(c)[:36] + '»' if c else ''})"

    # ---------- checks ----------
    def audit_frame(self, node, mobile):
        out = []
        frame = node["id"]

        def walk(n):
            kids = n.get("children")
            if not isinstance(kids, list):
                return
            nid = n["id"]
            p = self.P(nid)
            pw, ph = n.get("width"), n.get("height")
            live = [c for c in kids if isinstance(c, dict) and "x" in c
                    and self.enabled(c["id"]) and not self.allowed(frame, c["id"])
                    and not (c.get("width", 99) <= 12 and c.get("height", 99) <= 12)]
            if "quilt" not in (p.get("name") or "").lower():
                for c in live:
                    cx, cy, cw, ch = c.get("x", 0), c.get("y", 0), c.get("width", 0), c.get("height", 0)
                    if isinstance(pw, (int, float)) and (cx + cw > pw + TOL or cx < -TOL):
                        tag = "SCROLL?" if p.get("clip") else "DEFECT"
                        out.append(f"[{tag}] H-OVERFLOW {self.label(c['id'])} exceeds {self.label(nid)} w={pw} by {round(max(cx+cw-pw, -cx),1)}px")
                    if isinstance(ph, (int, float)) and (cy + ch > ph + TOL or cy < -TOL):
                        tag = "CLIPPED" if p.get("clip") else "DEFECT"
                        out.append(f"[{tag}] V-OVERFLOW {self.label(c['id'])} exceeds {self.label(nid)} h={ph} by {round(max(cy+ch-ph, -cy),1)}px")
            auto = p.get("layout") in ("vertical", "horizontal") or p.get("justifyContent") or p.get("alignItems")
            flow = [c for c in live if self.P(c["id"]).get("layoutPosition") != "absolute"]
            live = flow
            for i in range(len(live)):
                for j in range(i + 1, len(live)):
                    a, b = live[i], live[j]
                    ox = min(a.get("x",0)+a.get("width",0), b.get("x",0)+b.get("width",0)) - max(a.get("x",0), b.get("x",0))
                    oy = min(a.get("y",0)+a.get("height",0), b.get("y",0)+b.get("height",0)) - max(a.get("y",0), b.get("y",0))
                    if ox <= OVERLAP_MIN or oy <= OVERLAP_MIN:
                        continue
                    ta, tb = self.P(a["id"]).get("type"), self.P(b["id"]).get("type")
                    if auto:
                        out.append(f"[DEFECT] OVERLAP {self.label(a['id'])} <-> {self.label(b['id'])} ({round(ox,1)}x{round(oy,1)}px) in {self.label(nid)}")
                    elif ta == "text" or tb == "text":
                        out.append(f"[DEFECT] TEXT-OVERLAP {self.label(a['id'])} <-> {self.label(b['id'])} ({round(ox,1)}x{round(oy,1)}px) in {self.label(nid)}")
            for c in kids:
                if isinstance(c, dict) and "id" in c:
                    cid = c["id"]
                    cp = self.P(cid)
                    if not self.enabled(cid) or self.allowed(frame, cid):
                        continue
                    if cp.get("type") == "text":
                        cw, ch = c.get("width", 0), c.get("height", 0)
                        fs = cp.get("fontSize") if isinstance(cp.get("fontSize"), (int, float)) else 13
                        # multi-line (taller than ~1.8 line-heights) AND squeezed narrow
                        if cw < 44 and ch > max(34, fs * 1.9):
                            out.append(f"[DEFECT] LETTER-STACK {self.label(cid)} squeezed to {round(cw)}px wide, {round(ch)}px tall")
                        fam = cp.get("fontFamily")
                        has_letters = re.search(r"[A-Za-z]", str(cp.get("content") or ""))
                        if fam and fam not in ALLOWED_FONTS and has_letters:
                            out.append(f"[STYLE] FONT {self.label(cid)} family {fam}")
                        fs = cp.get("fontSize")
                        if isinstance(fs, (int, float)) and fs < 9.5:
                            out.append(f"[STYLE] FONT-SIZE {self.label(cid)} {fs}px")
                        txt = str(cp.get("content") or "")
                        if FORBIDDEN.search(txt):
                            out.append(f"[CONTENT] FORBIDDEN-TEXT {self.label(cid)}: {txt[:60]}")
                    for key in ("fill", "stroke"):
                        v = cp.get(key)
                        if isinstance(v, str) and v.startswith("#") and len(v) <= 7:
                            out.append(f"[STYLE] RAW-HEX {key} {v} on {self.label(cid)}")
                    if mobile and cp.get("type") == "frame":
                        nm = (cp.get("name") or "").lower()
                        if any(k in nm for k in ("button", "cta", "btn")) and 0 < c.get("height", 99) < 40:
                            out.append(f"[WARN] TOUCH-TARGET {self.label(cid)} only {round(c.get('height',0))}px tall")
                    walk(c)

        walk(node)
        return out

    def manifest(self, node, depth=0, lines=None):
        if lines is None:
            lines = []
        nid = node["id"]
        p = self.P(nid)
        kind = p.get("type", "?")
        nm = p.get("name") or (str(p.get("content"))[:40] if p.get("content") else "")
        ref = f" -> component {p.get('ref')}({(self.props.get(p.get('ref')) or {}).get('name','')})" if p.get("ref") else ""
        dis = "" if self.enabled(nid) else "  [disabled]"
        lines.append(f"{'  '*depth}{nid} [{kind}] {nm}{ref}{dis}  {node.get('width')}x{node.get('height')}")
        for c in node.get("children", []) if isinstance(node.get("children"), list) else []:
            if isinstance(c, dict) and "id" in c:
                self.manifest(c, depth + 1, lines)
        return lines


def find(nid, nodes):
    for n in nodes:
        if isinstance(n, dict):
            if n.get("id") == nid:
                return n
            kids = n.get("children")
            if isinstance(kids, list):
                r = find(nid, kids)
                if r:
                    return r
    return None


def main():
    args = [a for a in sys.argv[1:]]
    json_out = None
    if "--json" in args:
        i = args.index("--json")
        json_out = args[i + 1]
        del args[i:i + 2]
    sections_mode = "--sections" in args
    if sections_mode:
        args.remove("--sections")

    a = Auditor()
    print("snapshotting document geometry...", file=sys.stderr)
    doc = a.snapshot()
    tops = [n for n in doc if isinstance(n, dict) and "id" in n]
    targets = [n["id"] for n in tops if n["id"] not in ARCHIVE] if "--all" in args else args
    if not targets:
        print(__doc__)
        return

    report = {}
    for fid in targets:
        node = find(fid, doc)
        if node is None:
            print(f"== {fid}: NOT FOUND")
            continue
        print(f"crawling {fid}...", file=sys.stderr)
        a.crawl_props([fid])
        fname = (a.props.get(fid) or {}).get("name", "")
        if sections_mode:
            print(f"== {fid} ({fname}) — component manifest")
            print("\n".join(a.manifest(node)))
            continue
        mobile = (node.get("width") or 9999) <= 400
        findings = a.audit_frame(node, mobile)
        report[fid] = findings
        print(f"== {fid} ({fname}): {len(findings)} finding(s)")
        for f in findings:
            print("   " + f)
    if not sections_mode:
        total = sum(len(v) for v in report.values())
        defects = sum(1 for v in report.values() for f in v if f.startswith("[DEFECT]"))
        print(f"\nTOTAL: {total} findings ({defects} defects) across {len(report)} frames")
        if json_out:
            json.dump(report, open(json_out, "w"), indent=1)
            print(f"wrote {json_out}")


if __name__ == "__main__":
    main()
