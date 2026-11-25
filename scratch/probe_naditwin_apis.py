"""Probe NadiTwin production for real /api/* endpoints. Discovery only."""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://naditwin-production.up.railway.app"
OUT = Path(__file__).resolve().parent / "naditwin_api_discovery.json"


def fetch(url: str, timeout: float = 25):
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json,text/html,*/*",
            "User-Agent": "RiverEye-NadiTwin-Audit/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
        return r.status, dict(r.headers), body


def main():
    report = {"base": BASE, "html_apis": [], "scripts": [], "probes": [], "js_apis": []}

    status, headers, body = fetch(f"{BASE}/?river=Mula-Mutha")
    html = body.decode("utf-8", "ignore")
    report["html_status"] = status
    report["html_len"] = len(html)
    report["html_apis"] = sorted(set(re.findall(r"/api/[A-Za-z0-9_./?=&%-]+", html)))
    report["scripts"] = re.findall(r"""src=["']([^"']+)["']""", html)

    # Inline script /api references
    report["inline_api_refs"] = sorted(set(re.findall(r"""['"`](/api/[^'"`]+)['"`]""", html)))

    # Download JS bundles and mine endpoints
    js_text = []
    for src in report["scripts"]:
        if src.startswith("http"):
            url = src
        elif src.startswith("/"):
            url = BASE + src
        else:
            url = BASE + "/" + src
        try:
            st, hd, b = fetch(url)
            text = b.decode("utf-8", "ignore")
            js_text.append(text)
            found = sorted(set(re.findall(r"""["'`](/api/[A-Za-z0-9_./?=&%-]+)["'`]""", text)))
            report["js_apis"].append({"src": src, "status": st, "len": len(b), "apis": found})
        except Exception as e:
            report["js_apis"].append({"src": src, "error": str(e)})

    # Also mine HTML for fetch( patterns
    report["fetch_calls"] = sorted(
        set(re.findall(r"""fetch\(\s*["'`]([^"'`]+)["'`]""", html + "\n".join(js_text)))
    )

    all_paths = set(report["html_apis"]) | set(report["inline_api_refs"])
    for block in report["js_apis"]:
        all_paths.update(block.get("apis") or [])
    for fc in report["fetch_calls"]:
        if fc.startswith("/api/"):
            all_paths.add(fc.split("?")[0] + (("?" + fc.split("?", 1)[1]) if "?" in fc else ""))

    # Expand common query variants for discovered roots
    roots = sorted({p.split("?")[0] for p in all_paths if p.startswith("/api/")})
    candidates = set(roots)
    extras = [
        "/api/state",
        "/api/hydrograph",
        "/api/margins",
        "/api/alerts",
        "/api/rivers",
        "/api/discharge",
        "/api/chainage",
        "/api/forecast",
        "/api/rainfall",
        "/api/weather",
        "/api/locations",
        "/api/health",
        "/api/status",
        "/api/live",
        "/api/q",
        "/api/wse",
        "/api/stage",
        "/api/ensemble",
        "/api/export",
        "/api/profile",
        "/api/cells",
        "/api/now",
        "/api/historic",
        "/api/history",
        "/api/meta",
        "/api/config",
        "/api/openapi.json",
        "/openapi.json",
        "/docs",
        "/api/docs",
        "/api/river/Mula-Mutha",
        "/api/river?name=Mula-Mutha",
        "/api/state?river=Mula-Mutha",
        "/api/hydrograph?river=Mula-Mutha",
        "/api/hydrograph?cell=0",
        "/api/margins?river=Mula-Mutha",
        "/api/alerts?river=Mula-Mutha",
        "/api/chainage?river=Mula-Mutha",
        "/api/discharge?river=Mula-Mutha",
        "/api/forecast?river=Mula-Mutha",
        "/api/rainfall?river=Mula-Mutha",
        "/api/locations?river=Mula-Mutha",
        "/api/export?river=Mula-Mutha",
        "/api/profile?river=Mula-Mutha",
        "/api/now?river=Mula-Mutha",
    ]
    candidates.update(extras)

    for path in sorted(candidates):
        url = BASE + path
        entry = {"path": path, "url": url}
        try:
            st, hd, b = fetch(url, timeout=20)
            ct = hd.get("Content-Type") or hd.get("content-type") or ""
            entry["status"] = st
            entry["content_type"] = ct
            entry["bytes"] = len(b)
            if "json" in ct.lower() or b[:1] in (b"{", b"["):
                try:
                    data = json.loads(b.decode("utf-8"))
                    entry["json_type"] = type(data).__name__
                    if isinstance(data, dict):
                        entry["keys"] = sorted(data.keys())[:80]
                        # shallow sample of scalar values
                        sample = {}
                        for k, v in list(data.items())[:25]:
                            if isinstance(v, (str, int, float, bool)) or v is None:
                                sample[k] = v
                            elif isinstance(v, list):
                                sample[k] = f"list[{len(v)}]"
                            elif isinstance(v, dict):
                                sample[k] = f"dict[{len(v)} keys]"
                        entry["sample"] = sample
                    elif isinstance(data, list):
                        entry["list_len"] = len(data)
                        if data and isinstance(data[0], dict):
                            entry["item0_keys"] = sorted(data[0].keys())[:60]
                except Exception as e:
                    entry["json_error"] = str(e)
                    entry["head"] = b[:180].decode("utf-8", "ignore")
            else:
                entry["head"] = b[:180].decode("utf-8", "ignore")
        except urllib.error.HTTPError as e:
            entry["status"] = e.code
            try:
                entry["error_body"] = e.read()[:200].decode("utf-8", "ignore")
            except Exception:
                pass
        except Exception as e:
            entry["error"] = str(e)
        report["probes"].append(entry)
        print(f"{entry.get('status', 'ERR')} {path} keys={entry.get('keys') or entry.get('item0_keys')}")

    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
