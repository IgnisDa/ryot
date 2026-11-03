#!/usr/bin/env python3
"""Replay the largest statement of each library-check read with EXPLAIN (ANALYZE, BUFFERS)."""
import re
import subprocess
import sys

state, run = sys.argv[1], sys.argv[2]
entry = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+) UTC \[(\d+)\] (\w+):\s+(.*)$")
entries = []
for line in open(f"{state}/{run}.log", errors="replace").read().split("\n"):
    match = entry.match(line)
    if match:
        entries.append({"pid": match[2], "level": match[3], "message": match[4]})
    elif entries:
        entries[-1]["message"] += "\n" + line

label = None
windows = {}
for index, item in enumerate(entries):
    mark = re.search(r"LIBRARYCHECK (\S+) (start|end)", item["message"])
    if mark:
        label = mark[1] if mark[2] == "start" else None
    elif label and item["level"] == "LOG" and re.match(r"execute [^:]*: ", item["message"]):
        best = windows.get(label)
        if best is None or len(item["message"]) > len(entries[best]["message"]):
            windows[label] = index

for name, index in windows.items():
    item = entries[index]
    statement = re.sub(r"^execute [^:]*:\s*", "", item["message"]).strip()
    detail = next(
        (e["message"] for e in entries[index + 1 : index + 3] if e["level"] == "DETAIL" and e["pid"] == item["pid"]),
        "",
    )
    values = {int(m[1]): m[2] for m in re.finditer(r"\$(\d+) = (NULL|'(?:[^']|'')*')", detail)}
    replayed = re.sub(r"\$(\d+)", lambda m: values.get(int(m[1]), m[0]), statement)
    with open(f"{state}/{run}-{name}.sql", "w") as out:
        out.write(replayed)
    query = (
        "set jit = off; set statement_timeout = '300s'; begin read only; "
        f"explain (analyze, buffers) {replayed}\n; rollback;"
    )
    result = subprocess.run(
        ["docker", "exec", "-i", "wr-legacy-pg", "psql", "-U", "postgres", "-d", "postgres", "-At"],
        input=query,
        text=True,
        capture_output=True,
    )
    with open(f"{state}/{run}-{name}.plan", "w") as out:
        out.write(result.stdout + "\n" + result.stderr)
    times = [line for line in result.stdout.split("\n") if "Execution Time" in line]
    print(name, "characters", len(statement), times[:1], result.stderr[:120].strip())
