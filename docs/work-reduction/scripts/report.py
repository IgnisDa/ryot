"""Summarize one vm-e2e.sh result directory.

    python3 -I report.py RUN_DIR [N]

Prints status, failures, slowest files and tests, statement totals, and the top statement families
by calls and by execution time (pg_stat_statements of the shared database).
"""
import collections
import csv
import json
import os
import re
import sys

csv.field_size_limit(10**9)
run = sys.argv[1]
top = int(sys.argv[2]) if len(sys.argv) > 2 else 25


def read(name):
    path = os.path.join(run, name)
    return open(path).read().strip() if os.path.exists(path) else "?"


print(f"{os.path.basename(run)}: {read('status.txt')} revision {read('revision.txt')}")

vitest = os.path.join(run, "vitest.json")
if os.path.exists(vitest):
    data = json.load(open(vitest))
    files, tests, failures = [], [], []
    for result in data.get("testResults", []):
        name = os.path.relpath(result["name"], start=os.path.commonpath([result["name"], "/opt/ryot/src/e2e"]))
        duration = (result.get("endTime", 0) - result.get("startTime", 0)) / 1000
        files.append((duration, name, len(result.get("assertionResults", []))))
        for test in result.get("assertionResults", []):
            seconds = (test.get("duration") or 0) / 1000
            tests.append((seconds, name, test["title"], test["status"]))
            if test["status"] == "failed":
                message = (test.get("failureMessages") or [""])[0].splitlines()
                failures.append((name, test["title"], message[0][:200] if message else ""))
        if result.get("status") == "failed" and not result.get("assertionResults"):
            failures.append((name, "<file>", (result.get("message") or "")[:200]))
    print(
        f"files={len(files)} tests={data.get('numTotalTests')} passed={data.get('numPassedTests')} "
        f"failed={data.get('numFailedTests')} skipped={data.get('numPendingTests')} "
        f"sum_file_s={sum(f[0] for f in files):,.0f} sum_test_s={sum(t[0] for t in tests):,.0f}"
    )
    print(f"\nFailures ({len(failures)})")
    for name, title, message in failures:
        print(f"  {name} :: {title}\n      {message}")
    print(f"\nSlowest files")
    for duration, name, count in sorted(files, reverse=True)[:top]:
        print(f"  {duration:8.1f}s {count:3d} tests  {name}")
    print(f"\nSlowest tests")
    for seconds, name, title, status in sorted(tests, reverse=True)[:top]:
        print(f"  {seconds:8.1f}s {status:7s} {name} :: {title[:90]}")
    buckets = collections.Counter()
    for seconds, *_ in tests:
        buckets[next(b for b in (1, 2, 5, 10, 20, 30, 60, 120, 300, 10**9) if seconds <= b)] += 1
    print("\nTest duration histogram (upper bound s: count)")
    print("  " + "  ".join(f"≤{b if b < 10**9 else '∞'}:{c}" for b, c in sorted(buckets.items())))


def family(query):
    query = re.sub(r"\s+", " ", query)
    query = re.sub(r"\$\d+", "$", query)
    return query[:140]


pgss = os.path.join(run, "pgss.csv")
if os.path.exists(pgss):
    agg = collections.defaultdict(lambda: [0, 0.0, 0])
    for row in csv.DictReader(open(pgss)):
        if row["datname"] != "test_db":
            continue
        entry = agg[family(row["query"])]
        entry[0] += int(row["calls"])
        entry[1] += float(row["total_exec_time"])
        entry[2] += int(row["rows"])
    calls = sum(v[0] for v in agg.values())
    exec_ms = sum(v[1] for v in agg.values())
    cluster = sum(v[0] for k, v in agg.items() if "cluster_" in k)
    print(f"\nstatements={calls:,} exec_s={exec_ms / 1000:,.0f} shapes={len(agg)} cluster_*={cluster:,} ({cluster / max(calls, 1):.0%})")
    for title, key in (("by calls", 0), ("by exec time", 1)):
        print(f"\nTop statement families {title}")
        for query, (c, t, r) in sorted(agg.items(), key=lambda item: -item[1][key])[:top]:
            print(f"  {c:9,d} {t / 1000:8.1f}s {r:10,d}r  {query}")
