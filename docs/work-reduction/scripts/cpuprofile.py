"""Attribute a V8/Bun .cpuprofile by self time and by inclusive time per bucket.

    python3 -I cpuprofile.py PROFILE [N]

Gaps between samples are capped at 3 ms. Self time per function and per package; inclusive time for frames whose name or URL matches a set of
interest markers (logging, schema, cluster, sql, sandbox, redis), counted once per sample.
"""
import collections
import json
import re
import sys

profile = json.load(open(sys.argv[1]))
top = int(sys.argv[2]) if len(sys.argv) > 2 else 30
nodes = {n["id"]: n for n in profile["nodes"]}
parent = {}
for n in profile["nodes"]:
    for c in n.get("children", []):
        parent[c] = n["id"]
samples, deltas = profile["samples"], profile["timeDeltas"]
weights = collections.Counter()
# Bun samples only while the JS thread runs; a long gap is idle time, not the next frame's cost.
CAP_US = 3000
for i, s in enumerate(samples):
    weights[s] += min(deltas[i + 1], CAP_US) if i + 1 < len(deltas) else 0


def frame(n):
    cf = n["callFrame"]
    return cf.get("functionName") or "(anonymous)", cf.get("url", "")


def package(url):
    m = re.search(r"node_modules/\.bun/([^/]+)/", url)
    if m:
        return m.group(1).rsplit("@", 1)[0] if not m.group(1).startswith("@") else "@" + m.group(1)[1:].split("@")[0]
    m = re.search(r"/opt/ryot/src/(kernel/[^/]+|packages/[^/]+|plugins/[^/]+|apps/[^/]+)/(?:src/)?([^/]+)?", url)
    if m:
        return m.group(1) + ("/" + m.group(2) if m.group(1) == "kernel/backend" and m.group(2) else "")
    return url.split(":")[0] if url else "(native)"


MARKERS = {
    "logging": re.compile(r"Logger\.js|logger|pino|writeBuffered|formatValue|log", re.I),
    "schema": re.compile(r"Schema|schema/|SchemaAST|SchemaParser|compilerRegistry"),
    "cluster": re.compile(r"/cluster/"),
    "workflow": re.compile(r"/workflow/"),
    "sql": re.compile(r"/sql/|drizzle|internal:sql|pg-core|SqlClient"),
    "redis": re.compile(r"ioredis|redis"),
    "sandbox": re.compile(r"kernel/sandbox|modules/scripts"),
    "tracing": re.compile(r"Tracer|tracing|otel|opentelemetry|Span"),
    "http": re.compile(r"/http/|HttpServer|HttpApi"),
}
total = sum(weights.values())
idle = sum(w for nid, w in weights.items() if frame(nodes[nid])[0] in ("(idle)", "(program)", "(garbage collector)"))
self_fn, self_pkg, incl = collections.Counter(), collections.Counter(), collections.Counter()
for nid, w in weights.items():
    name, url = frame(nodes[nid])
    self_fn[f"{name} {package(url)}"] += w
    self_pkg[package(url)] += w
    hit, cur = set(), nid
    while cur is not None:
        n2, u2 = frame(nodes[cur])
        for key, rx in MARKERS.items():
            if rx.search(n2) or rx.search(u2):
                hit.add(key)
        cur = parent.get(cur)
    for key in hit:
        incl[key] += w
busy = total - idle
print(f"profile={total / 1e6:.1f}s sampled, idle/program/gc={idle / 1e6:.1f}s, busy={busy / 1e6:.1f}s")
for title, counter in (("self by package", self_pkg), ("self by function", self_fn)):
    print(f"\n{title}")
    for key, w in counter.most_common(top):
        print(f"  {w / 1e6:7.2f}s {w / max(busy, 1):6.1%}  {key[:140]}")
print("\ninclusive by marker (share of busy)")
for key, w in incl.most_common():
    print(f"  {w / 1e6:7.2f}s {w / max(busy, 1):6.1%}  {key}")
