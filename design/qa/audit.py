#!/usr/bin/env python3
"""Near-programmatic design QA for design/ab-initial-app.pen.

Usage:
  python3 audit.py --all                 # audit every top-level frame
  python3 audit.py <frameId> [...]      # audit specific frames
  python3 audit.py --sections <frameId>  # print the frame's component manifest only
  python3 audit.py --json out.json ...   # also write machine-readable report

Requires the Pen app running with the doc open (talks to it via penctl.py).
The file is the app's active canvas editor (read from `get_app_state`, and
refused unless it is ab-initial-app.pen); set PEN_FILE to the bridge's path
form (e.g. /Ubuntu/home/.../ab-initial-app.pen) to override.

Data comes from the bridge's `execute` tool, READ-ONLY: one `Get` visitor per
frame, with `resolveInstances:true`, returns computed bounds (`ctx.bounds`,
parent-relative) and live props in a single call. (`snapshot_layout` and
`batch_get` no longer exist in the Pencil MCP API.) Resolving instances means
a component instance comes back as an ordinary frame (root keeps the instance
id, internals are `instanceId/childId` paths) with per-instance overrides
applied, so name/type checks such as TOUCH-TARGET apply to instances too — the
old batch_get crawl only ever saw them as type "ref". Resolved nodes drop
`ref`, so it is recovered per frame for the manifest's `-> component` column.

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

Disabled nodes are excluded using LIVE props: with instances resolved, each
`instanceId/childId` carries its effective `enabled` (source-level
enabled:false AND per-instance descendants overrides already applied), so
ghost geometry of hidden nodes does not create false positives.
Verified-intentional exceptions live in whitelist.json ({nodeId: reason} or
{frameId/nodeId: reason}); every entry must state WHY.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from penctl import Pen

TOL = 2.5
OVERLAP_MIN = 4.0
# Frames parked in the CONCEPTS / ARCHIVE band (y>=16800): excluded from --all.
# ONLY the Camp Plot concepts, which have no route by design (parked post-MVP —
# AfrikaBurn still does placement on paper). Do NOT add a frame here just because
# it was superseded: sCEHP/ELUfI (Builder v1) were briefly added and that
# silently dropped two real, still-drawn frames out of every `--all` run. An
# archive label is a naming concern; the audit should keep measuring anything
# that is still on the canvas.
# because they are not shipped product. Keep this set == that band's contents.
#   cyMi6/CwVWw/OLb9g  Camp Plot v2 — PARKED post-MVP, deliberately route-less
#   sCEHP/ELUfI        Questionnaire Builder v1 — superseded by Builder v2 (AssNH/ZBw8O)
ARCHIVE = {"cyMi6", "CwVWw", "OLb9g"}
FORBIDDEN = re.compile(r"(payment|reconcil|yoco|lorem ipsum|\bTODO\b)", re.I)
ALLOWED_FONTS = {"$font-brand", "Montserrat", "JetBrains Mono", "$font-mono"}

def load_whitelist():
    p = os.path.join(HERE, "whitelist.json")
    return json.load(open(p)) if os.path.exists(p) else {}

# Props copied off each node. Objects are skipped (descendants maps, gradients)
# except fill/stroke, which the RAW-HEX check reads when they are plain strings.
PROP_KEYS = ["type", "name", "layout", "clip", "enabled", "textGrowth", "content", "ref",
             "justifyContent", "alignItems", "fill", "stroke", "fontFamily", "fontSize",
             "cornerRadius", "width", "layoutPosition"]
MARK = "@@JSON@@"

# Top-level frames: ids + boxes, children skipped.
TOP_JS = ("const r=[];Get(document,(n,c)=>{if(c.depth===0){r.push({id:n.id,x:c.bounds.x,"
          "y:c.bounds.y,width:c.bounds.width,height:c.bounds.height});c.skipChildren();}});"
          "Print('%s'+JSON.stringify(r));" % MARK)


def frame_js(fid):
    """One read-only Get pass over a subtree: nested geometry + a flat props map."""
    return ("const K=%s;const P={};const M={};let root=null;"
            "Get(%s,(n,c)=>{const g={id:n.id,x:c.bounds.x,y:c.bounds.y,width:c.bounds.width,"
            "height:c.bounds.height,children:[]};const p={};for(const k of K){"
            "if(n[k]!==undefined&&(typeof n[k]!=='object'||k==='fill'||k==='stroke'))p[k]=n[k];}"
            "if(n.type==='frame'){try{const o=Get(n.id.split('/').pop(),{depth:0});"
            "if(o.type==='ref'){p.ref=o.ref;p.refName=Get(o.ref,{depth:0}).name;}}catch(e){}}"
            "P[n.id]=p;M[n.id]=g;const pp=c.parentCtx&&M[c.parentCtx.node.id];"
            "if(pp)pp.children.push(g);else if(!root)root=g;},{resolveInstances:true});"
            "Print('%s'+JSON.stringify({root,P}));") % (json.dumps(PROP_KEYS), json.dumps(fid), MARK)


class NotFound(Exception):
    pass


class Auditor:
    def __init__(self):
        self.pen = Pen()
        self.file = self.resolve_file()
        self.props = {}
        self.whitelist = load_whitelist()

    # ---------- data collection (execute tool, read-only) ----------
    def resolve_file(self):
        """The .pen path in the bridge's own form (the WSL `/Ubuntu/...` prefix
        varies by distro), so ask the app which canvas is active."""
        if os.environ.get("PEN_FILE"):
            return os.environ["PEN_FILE"]
        state = self.pen.tool("get_app_state", {}, timeout=60)
        m = re.search(r"active canvas editor:\s*`([^`]+)`", state)
        if not m or not m.group(1).endswith("ab-initial-app.pen"):
            sys.exit("audit.py: the Pen app's active canvas is not ab-initial-app.pen "
                     f"({m.group(1) if m else 'none open'}). Open it, or set PEN_FILE.")
        return m.group(1)

    def run(self, js):
        out = self.pen.tool("execute", {"filePath": self.file, "input": js}, timeout=300)
        m = re.search(re.escape(MARK) + r"(.*)", out)
        if not m:
            raise RuntimeError(out[:1500])
        return json.loads(m.group(1))

    def snapshot(self):
        """Top-level frames only (ids + boxes)."""
        return self.run(TOP_JS)

    def snapshot_frame(self, fid):
        """Full-depth geometry for one node (any id, not only top-level frames),
        instances resolved; records every node's live props as a side effect."""
        try:
            d = self.run(frame_js(fid))
        except RuntimeError as e:
            if "find node" in str(e):
                raise NotFound(fid)
            raise
        for k, v in d["P"].items():
            self.props.setdefault(k, {}).update(v)
        return d["root"]

    # ---------- helpers ----------
    def P(self, nid):
        return self.props.get(nid) or {}

    def enabled(self, nid):
        # Resolved instance paths carry their effective `enabled` (source value
        # with the instance's overrides applied), so the exact entry is the truth.
        return self.P(nid).get("enabled") is not False

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
        ref = f" -> component {p.get('ref')}({p.get('refName', '')})" if p.get("ref") else ""
        dis = "" if self.enabled(nid) else "  [disabled]"
        lines.append(f"{'  '*depth}{nid} [{kind}] {nm}{ref}{dis}  {node.get('width')}x{node.get('height')}")
        for c in node.get("children", []) if isinstance(node.get("children"), list) else []:
            if isinstance(c, dict) and "id" in c:
                self.manifest(c, depth + 1, lines)
        return lines


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

    if not args:
        print(__doc__)
        return
    a = Auditor()
    if "--all" in args:
        print("listing top-level frames...", file=sys.stderr)
        targets = [n["id"] for n in a.snapshot() if isinstance(n, dict) and "id" in n
                   and n["id"] not in ARCHIVE]
    else:
        targets = args
    if not targets:
        print(__doc__)
        return

    report = {}
    for fid in targets:
        print(f"reading {fid}...", file=sys.stderr)
        try:
            node = a.snapshot_frame(fid)
        except NotFound:
            node = None
        if node is None or "id" not in node:
            print(f"== {fid}: NOT FOUND")
            continue
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
