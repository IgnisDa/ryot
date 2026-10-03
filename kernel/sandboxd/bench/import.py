import argparse
import json
import os
from pathlib import Path
import subprocess
import time


SETUP_LIMIT_SECONDS = 15 * 60
STALL_LIMIT_SECONDS = 5 * 60
TRIAL_LIMIT_SECONDS = 40 * 60
SAMPLE_INTERVAL_MS = 200


def process_memory(root_pid):
    processes = {}
    for directory in Path("/proc").iterdir():
        if not directory.name.isdigit():
            continue
        try:
            fields = dict(
                line.split(":", 1)
                for line in (directory / "status").read_text().splitlines()
                if ":" in line
            )
            processes[int(directory.name)] = (
                int(fields["PPid"].strip()),
                int(fields.get("VmRSS", "0 kB").split()[0]) * 1024,
            )
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    descendants = {root_pid}
    while True:
        expanded = descendants | {
            pid for pid, (parent, _) in processes.items() if parent in descendants
        }
        if expanded == descendants:
            break
        descendants = expanded
    return sum(processes.get(pid, (0, 0))[1] for pid in descendants)


def container_memory_paths():
    identifiers = subprocess.check_output(["docker", "ps", "-q"], text=True).split()
    if not identifiers:
        return {}
    containers = json.loads(
        subprocess.check_output(["docker", "inspect", *identifiers], text=True)
    )
    paths = {}
    for container in containers:
        pid = container["State"]["Pid"]
        if pid == 0:
            continue
        try:
            cgroup = Path(f"/proc/{pid}/cgroup").read_text().splitlines()
        except FileNotFoundError:
            continue
        relative = next(line[3:] for line in cgroup if line.startswith("0::"))
        paths[container["Config"]["Image"]] = (
            Path("/sys/fs/cgroup") / relative.lstrip("/") / "memory.current"
        )
    return paths


def benchmark_payload(line, marker):
    if marker not in line:
        return None
    payload = line.split(marker, 1)[1].strip()
    if payload.endswith('"') and '\\"' in payload:
        payload = json.loads('"' + payload)
    return json.loads(payload)


def run_trial(repository, output, runtime, trial):
    log_path = output / f"{runtime}-{trial}.log"
    metrics_path = output / f"{runtime}-{trial}.json"
    environment = {**os.environ, "SANDBOX_IMPORT_BENCHMARK": "1"}
    with log_path.open("w") as log:
        process = subprocess.Popen(
            [
                "bun", "--bun", "run", "vitest", "run",
                "--config", "vitest.benchmark.config.ts",
            ],
            cwd=repository / "e2e",
            env=environment,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        root_pid = None
        started = False
        ended = False
        result = None
        peak_rss = 0
        container_peaks = {}
        container_paths = {}
        pending = ""
        trial_started_at = time.monotonic()
        progressed_at = trial_started_at
        last_executed = None
        with log_path.open() as reader:
            while process.poll() is None:
                now = time.monotonic()
                stalled = None
                if not started and now - trial_started_at > SETUP_LIMIT_SECONDS:
                    stalled = "setup did not start the import"
                elif started and not ended and now - progressed_at > STALL_LIMIT_SECONDS:
                    stalled = "import made no progress"
                elif now - trial_started_at > TRIAL_LIMIT_SECONDS:
                    stalled = "trial exceeded its time limit"
                if stalled is not None:
                    process.terminate()
                    try:
                        process.wait(timeout=30)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                    raise SystemExit(f"Benchmark trial {trial} failed: {stalled}; inspect {log_path}")
                pending += reader.read()
                lines = pending.split("\n")
                pending = lines.pop()
                for line in lines:
                    start = benchmark_payload(line, "sandbox-import-benchmark-start ")
                    if start is not None and not started:
                        started = True
                        root_pid = start["backendPid"]
                        container_paths = container_memory_paths()
                    if benchmark_payload(line, "sandbox-import-benchmark-end ") is not None:
                        ended = True
                        root_pid = None
                    completed = benchmark_payload(line, "sandbox-import-benchmark-result ")
                    if completed is not None:
                        result = completed
                        root_pid = None
                    progress = benchmark_payload(line, "sandbox-import-benchmark-progress ")
                    if progress is not None:
                        print(line, flush=True)
                        executed = progress["pressure"]["sandbox"]["totalExecutions"]
                        if executed != last_executed:
                            last_executed = executed
                            progressed_at = time.monotonic()
                if root_pid is not None and not ended:
                    peak_rss = max(peak_rss, process_memory(root_pid))
                    for image, path in container_paths.items():
                        try:
                            current = int(path.read_text())
                        except FileNotFoundError:
                            continue
                        container_peaks[image] = max(container_peaks.get(image, 0), current)
                time.sleep(SAMPLE_INTERVAL_MS / 1000)
            for line in (pending + reader.read()).splitlines():
                completed = benchmark_payload(line, "sandbox-import-benchmark-result ")
                if completed is not None:
                    result = completed
    metrics = {
        "trial": trial,
        "runtime": runtime,
        "exitCode": process.returncode,
        "result": result,
        "peakBackendAndChildrenRssBytes": peak_rss,
        "peakContainerMemoryBytes": container_peaks,
        "sampleIntervalMs": SAMPLE_INTERVAL_MS,
    }
    metrics_path.write_text(json.dumps(metrics, sort_keys=True) + "\n")
    print(json.dumps({**metrics, "result": None}), flush=True)
    if process.returncode != 0 or result is None or peak_rss == 0 or not container_peaks:
        raise SystemExit(f"Benchmark trial failed; inspect {log_path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", required=True, choices=["sidecar"])
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    arguments.output.mkdir(parents=True, exist_ok=True)
    repository = Path(__file__).resolve().parents[3]
    for trial in range(1, 4):
        run_trial(repository, arguments.output, arguments.runtime, trial)


if __name__ == "__main__":
    main()
