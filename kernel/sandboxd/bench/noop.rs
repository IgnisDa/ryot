#[path = "../tests/support/mod.rs"]
mod support;

use std::time::{Duration, Instant};

use ryot_sandboxd::protocol::{Limits, Outbound, Tier};
use serde_json::{Value, json};

const RUNS: usize = 500;
const CONCURRENT: usize = 50;

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
    let memory_budget = (CONCURRENT as u64 * 128 * support::MIB).to_string();
    let mut sidecar = support::spawn(
        Tier::Core,
        &[
            "--threads",
            &threads,
            "--queue",
            &threads,
            "--memory-budget",
            &memory_budget,
        ],
    );
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
                heap_bytes: 16 * support::MIB,
                external_bytes: support::MIB,
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

    println!("core no-op p50: {:.2} ms", p50.as_secs_f64() * 1e3);
    println!("per-execution RSS: {per_execution:.2} MiB over {CONCURRENT} live isolates");
    println!("sidecar RSS: {idle:.1} MiB idle, {held:.1} MiB with {CONCURRENT} live isolates");
}
