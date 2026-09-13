#[path = "../tests/support/mod.rs"]
mod support;

use std::time::{Duration, Instant};

use ryot_sandboxd::protocol::{Limits, Outbound, Tier};
use serde_json::{Value, json};

const RUNS: usize = 500;
const CONCURRENT: usize = 50;
const P50_LIMIT: Duration = Duration::from_millis(30);
const PER_EXECUTION_LIMIT: f64 = 20.0;

fn resident_mib(pid: u32) -> f64 {
    let output = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output()
        .expect("ps");
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<f64>()
        .expect("rss")
        / 1024.0
}

fn main() {
    let threads = (CONCURRENT + 1).to_string();
    let mut sidecar = support::spawn(Tier::Core, &["--threads", &threads, "--queue", &threads]);
    for _ in 0..20 {
        sidecar.execute(Tier::Core, "export default () => null", Value::Null);
    }

    let mut latencies: Vec<Duration> = (0..RUNS)
        .map(|_| {
            let start = Instant::now();
            sidecar.execute(Tier::Core, "export default () => null", Value::Null);
            start.elapsed()
        })
        .collect();
    latencies.sort();
    let p50 = latencies[RUNS / 2];

    let idle = resident_mib(sidecar.pid());
    for index in 0..CONCURRENT {
        sidecar.send(&support::run_frame(
            &format!("held-{index}"),
            Tier::Core,
            "export default async (_input, host) => host.call('hold', null)",
            Value::Null,
            Limits {
                heap_bytes: 16 * 1024 * 1024,
                external_bytes: 1024 * 1024,
                ..support::limits()
            },
        ));
    }
    let mut calls = Vec::new();
    while calls.len() < CONCURRENT {
        if let Outbound::HostCall { handle, seq, .. } = sidecar.recv() {
            calls.push((handle, seq));
        }
    }
    let held = resident_mib(sidecar.pid());
    for (handle, seq) in &calls {
        sidecar.reply(handle, *seq, json!(null));
    }
    let mut finished = 0;
    while finished < CONCURRENT {
        if let Outbound::Done { .. } = sidecar.recv() {
            finished += 1;
        }
    }
    let per_execution = (held - idle) / CONCURRENT as f64;

    println!(
        "core no-op p50: {:.2} ms (limit {} ms)",
        p50.as_secs_f64() * 1e3,
        P50_LIMIT.as_millis()
    );
    println!(
        "per-execution RSS: {per_execution:.2} MiB over {CONCURRENT} live isolates (limit {PER_EXECUTION_LIMIT} MiB)"
    );
    println!("sidecar RSS: {idle:.1} MiB idle, {held:.1} MiB with {CONCURRENT} live isolates");
    if p50 >= P50_LIMIT || per_execution >= PER_EXECUTION_LIMIT {
        eprintln!("benchmark thresholds not met");
        std::process::exit(1);
    }
}
