#!/usr/bin/env python3
"""Summarize a library-check result file: per-read medians by mode, whole-page loads, and failures."""
import collections
import json
import statistics
import sys

rows = [json.loads(line) for line in open(sys.argv[1])]
reads = [row for row in rows if "round" in row]
pages = [row for row in rows if "page" in row]
print(next((row for row in rows if "members" in row), {}))

table = collections.defaultdict(lambda: collections.defaultdict(list))
failures = collections.Counter()
for row in reads:
    if row["outcome"] == "ok":
        table[row["label"]][row["mode"]].append(row["ms"])
    else:
        failures[(row["label"], row["mode"], row["outcome"][:60])] += 1

modes = sorted({row["mode"] for row in reads})
median = lambda values: statistics.median(values) if values else None
ordered = sorted(table.items(), key=lambda item: -max(median(v) for v in item[1].values()))
print("read".ljust(44), *[mode.rjust(9) for mode in modes])
for label, by_mode in ordered[: int(sys.argv[2]) if len(sys.argv) > 2 else 40]:
    print(label[:44].ljust(44), *[str(round(median(by_mode[mode]) or 0)).rjust(9) for mode in modes])
print(f"reads {len(table)}, failures {sum(failures.values())}")
for key, count in failures.most_common(30):
    print("  FAIL", count, *key)
for page in pages:
    bad = [(item["label"], item["outcome"][:30]) for item in page["outcomes"] if item["outcome"] != "ok"]
    slow = sorted(page["outcomes"], key=lambda item: -item["ms"])[:3]
    print("page", page["page"], page["mode"], page["startedAt"][11:19], f'{page["ms"]} ms', "failed", bad,
          "slowest", [(item["label"], item["ms"]) for item in slow])
