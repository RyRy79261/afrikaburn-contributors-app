#!/usr/bin/env python3
"""Dump every text node (id, name, content) inside one or more frames.

Usage: python3 dumptext.py <frameId> [...]

Complements audit.py --sections (which shows structure but truncates content).
Needed because .pen files are encrypted, so grep is impossible: this is the only
way to read the SHIPPED strings a frame actually carries.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from penctl import Pen


def crawl(pen, roots):
    props, pending, seen = {}, list(roots), set(roots)
    order = []
    while pending:
        batch, pending = pending[:15], pending[15:]
        try:
            res = json.loads(pen.tool("batch_get", {"nodeIds": batch, "depth": 3}, timeout=180))
        except Exception as e:
            print(f"! batch_get failed {batch[:3]}: {e}", file=sys.stderr)
            continue
        stack = res if isinstance(res, list) else [res]
        while stack:
            n = stack.pop()
            if not isinstance(n, dict) or "id" not in n:
                continue
            nid = n["id"]
            if nid not in props:
                order.append(nid)
            props.setdefault(nid, {}).update(n)
            kids = n.get("children")
            if isinstance(kids, list):
                stack.extend(kids)
            elif kids == "..." and nid not in seen:
                seen.add(nid)
                pending.append(nid)
    return props, order


def main():
    ids = sys.argv[1:]
    pen = Pen()
    props, order = crawl(pen, ids)
    for nid in order:
        n = props[nid]
        c = n.get("content")
        if c is None:
            continue
        dis = "  [disabled]" if n.get("enabled") is False else ""
        print(f"{nid}\t{n.get('name','')}\t{dis}\t{c!r}")
    print("--- refs with descendant content overrides ---")
    for nid in order:
        n = props[nid]
        d = n.get("descendants")
        if not isinstance(d, dict):
            continue
        for sid, ov in d.items():
            if isinstance(ov, dict) and ("content" in ov or "enabled" in ov):
                print(f"{nid}/{sid}\t{n.get('name','')}\t{ov.get('enabled','')}\t{ov.get('content','')!r}")


if __name__ == "__main__":
    main()
