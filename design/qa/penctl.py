#!/usr/bin/env python3
"""Raw JSONRPC stdio client for the pen.dev MCP bridge (Windows exe via WSL interop)."""
import json, os, subprocess, sys, threading, queue, time

# The Pencil MCP server binary. Set PENCIL_MCP_BRIDGE to override; the
# defaults below are best-effort guesses at a standard install and will not be
# right on every machine.
#
# The WSL default needs the WINDOWS username, which is not $USER inside WSL,
# so it is resolved through cmd.exe interop with $USER as a fallback.
def _windows_username() -> str:
    try:
        out = subprocess.run(
            ["cmd.exe", "/c", "echo %USERNAME%"],
            capture_output=True, text=True, timeout=5,
        )
        name = out.stdout.strip()
        if name and "%" not in name:
            return name
    except Exception:
        pass
    return os.environ.get("USER") or os.environ.get("USERNAME") or ""


def _is_wsl() -> bool:
    try:
        return "microsoft" in os.uname().release.lower()
    except AttributeError:
        return False


def _default_bridge() -> str:
    if sys.platform == "darwin":
        return ("/Applications/Pencil.app/Contents/Resources"
                "/app.asar.unpacked/out/mcp-server-macos-x64")
    if _is_wsl():
        return (f"/mnt/c/Users/{_windows_username()}/AppData/Local/Programs"
                "/Pencil/resources/app.asar.unpacked/out"
                "/mcp-server-windows-x64.exe")
    return "/opt/Pencil/resources/app.asar.unpacked/out/mcp-server-linux-x64"


BRIDGE = os.environ.get("PENCIL_MCP_BRIDGE") or _default_bridge()

class Pen:
    def __init__(self):
        self.p = subprocess.Popen([BRIDGE, "--app", "desktop"], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.q = queue.Queue()
        self.buf = b""
        t = threading.Thread(target=self._reader, daemon=True)
        t.start()
        self.id = 0
        self._call("initialize", {"protocolVersion": "2024-11-05",
                                  "capabilities": {},
                                  "clientInfo": {"name": "penctl", "version": "1.0"}})
        self._notify("notifications/initialized", {})

    def _reader(self):
        for line in self.p.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                self.q.put(json.loads(line))
            except Exception:
                pass

    def _send(self, obj):
        self.p.stdin.write((json.dumps(obj) + "\n").encode())
        self.p.stdin.flush()

    def _notify(self, method, params):
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def _call(self, method, params, timeout=120):
        self.id += 1
        rid = self.id
        self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                msg = self.q.get(timeout=deadline - time.time())
            except queue.Empty:
                break
            if msg.get("id") == rid:
                return msg
        raise TimeoutError(f"no response to {method}")

    def tool(self, name, args, timeout=120):
        r = self._call("tools/call", {"name": name, "arguments": args}, timeout)
        if "error" in r:
            raise RuntimeError(r["error"])
        content = r["result"].get("content", [])
        texts = [c["text"] for c in content if c.get("type") == "text"]
        return "\n".join(texts)

if __name__ == "__main__":
    tool_name = sys.argv[1]
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    out = sys.argv[3] if len(sys.argv) > 3 else None
    pen = Pen()
    res = pen.tool(tool_name, args, timeout=300)
    if out:
        with open(out, "w") as f:
            f.write(res)
        print(f"wrote {len(res)} bytes to {out}")
    else:
        print(res[:2000])
