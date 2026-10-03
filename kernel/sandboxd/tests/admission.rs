mod support;

use std::time::Duration;

use ryot_sandboxd::protocol::{DrainReason, Limits, Outbound, Phase, Tier};
use serde_json::{Value, json};

const MIB: u64 = 1024 * 1024;
const BUSY: &str = "export default () => { const start = Date.now(); while (Date.now() - start < 800) {} return 'busy'; }";
const STARTS: &str = "export default async (_input, host) => host.call('started', null)";
const HOLDS: &str = "export default async (_input, host) => host.call('hold', null)";

fn thread_count(pid: u32) -> usize {
    if cfg!(target_os = "linux") {
        std::fs::read_dir(format!("/proc/{pid}/task"))
            .expect("tasks")
            .count()
    } else {
        let output = std::process::Command::new("ps")
            .args(["-M", "-p", &pid.to_string()])
            .output()
            .expect("ps");
        String::from_utf8_lossy(&output.stdout).lines().count() - 1
    }
}

#[test]
fn v8_platform_pool_is_capped() {
    let mut sidecar = support::spawn(Tier::Core, &["--threads", "1"]);
    sidecar.execute(
        Tier::Core,
        "export default () => new Array(1e6).fill(1).length",
        Value::Null,
    );
    // main (reader), writer, watchdog, one interactive and one background worker
    let own_threads = 5;
    let platform_threads = thread_count(sidecar.pid()) - own_threads;
    assert!(
        platform_threads <= 4,
        "{platform_threads} V8 platform threads"
    );
}

#[test]
fn the_cpu_active_cap_queues_excess_runs_but_not_parked_ones() {
    let mut capped = support::spawn(Tier::Core, &["--max-active", "1"]);
    capped.send(&support::run_frame(
        "busy",
        Tier::Core,
        BUSY,
        Value::Null,
        support::limits(),
    ));
    std::thread::sleep(Duration::from_millis(100));
    capped.send(&support::run_frame(
        "starts",
        Tier::Core,
        STARTS,
        Value::Null,
        support::limits(),
    ));
    match capped.recv() {
        Outbound::Done { handle, .. } => assert_eq!(
            handle, "busy",
            "the second run started before a CPU slot was free"
        ),
        other => panic!("expected the busy run to finish first, got {other:?}"),
    }
    assert_eq!(
        capped.finish("starts", |_, _| json!("ok")).value(),
        json!("ok")
    );

    capped.send(&support::run_frame(
        "parked",
        Tier::Core,
        HOLDS,
        Value::Null,
        support::limits(),
    ));
    let Outbound::HostCall { seq, .. } = capped.recv() else {
        panic!("expected the parked run's host call");
    };
    let quick = capped.execute(Tier::Core, "export default () => 'quick'", Value::Null);
    assert_eq!(
        quick.value(),
        json!("quick"),
        "a parked isolate held the only CPU slot"
    );
    capped.reply("parked", seq, json!("released"));
    assert_eq!(
        capped.finish("parked", |_, _| unreachable!()).value(),
        json!("released")
    );

    let mut uncapped = support::spawn(Tier::Core, &["--max-active", "2"]);
    uncapped.send(&support::run_frame(
        "busy",
        Tier::Core,
        BUSY,
        Value::Null,
        support::limits(),
    ));
    std::thread::sleep(Duration::from_millis(100));
    uncapped.send(&support::run_frame(
        "starts",
        Tier::Core,
        STARTS,
        Value::Null,
        support::limits(),
    ));
    match uncapped.recv() {
        Outbound::HostCall { handle, .. } => assert_eq!(handle, "starts"),
        other => panic!("expected the second run to start alongside the first, got {other:?}"),
    }
}

#[test]
fn the_memory_budget_queues_excess_runs() {
    let limits = Limits {
        heap_bytes: 64 * MIB,
        external_bytes: 32 * MIB,
        ..support::limits()
    };
    let mut sidecar = support::spawn(Tier::Core, &["--memory-budget", &(150 * MIB).to_string()]);
    sidecar.send(&support::run_frame(
        "first",
        Tier::Core,
        HOLDS,
        Value::Null,
        limits.clone(),
    ));
    let Outbound::HostCall { seq, .. } = sidecar.recv() else {
        panic!("expected the first run's host call");
    };
    sidecar.send(&support::run_frame(
        "second",
        Tier::Core,
        STARTS,
        Value::Null,
        limits.clone(),
    ));
    assert!(
        sidecar.recv_within(Duration::from_millis(500)).is_none(),
        "the second run started without memory budget"
    );
    sidecar.reply("first", seq, json!("done"));
    assert_eq!(
        sidecar.finish("first", |_, _| unreachable!()).value(),
        json!("done")
    );
    assert_eq!(
        sidecar.finish("second", |_, _| json!("ok")).value(),
        json!("ok")
    );

    let oversized = sidecar.execute_with(
        Tier::Core,
        "export default () => 1",
        Value::Null,
        Limits {
            heap_bytes: 1024 * MIB,
            ..limits
        },
    );
    assert_eq!(oversized.failure().0, Phase::Admission);
}

#[cfg(target_os = "linux")]
fn worker_priorities(pid: u32) -> Vec<(String, i32)> {
    let mut workers: Vec<(String, i32)> = std::fs::read_dir(format!("/proc/{pid}/task"))
        .expect("tasks")
        .filter_map(|task| {
            let path = task.ok()?.path();
            let name = std::fs::read_to_string(path.join("comm"))
                .ok()?
                .trim()
                .to_owned();
            let stat = std::fs::read_to_string(path.join("stat")).ok()?;
            let nice = stat
                .rsplit_once(')')?
                .1
                .split_whitespace()
                .nth(16)?
                .parse()
                .ok()?;
            (name.starts_with("background") || name.starts_with("interactive"))
                .then_some((name, nice))
        })
        .collect();
    workers.sort();
    workers
}

#[cfg(target_os = "linux")]
#[test]
fn background_lane_threads_run_at_lower_priority() {
    let sidecar = support::spawn(Tier::Core, &["--threads", "2"]);
    let expected = vec![
        ("background-0".to_owned(), 10),
        ("background-1".to_owned(), 10),
        ("interactive-0".to_owned(), 0),
        ("interactive-1".to_owned(), 0),
    ];
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    let mut workers = worker_priorities(sidecar.pid());
    while workers != expected && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
        workers = worker_priorities(sidecar.pid());
    }
    assert_eq!(workers, expected);
}

#[test]
fn the_sidecar_drains_and_restarts_at_its_execution_count() {
    let mut sidecar = support::spawn(Tier::Core, &["--max-executions", "2"]);
    for _ in 0..2 {
        sidecar.execute(Tier::Core, "export default () => 1", Value::Null);
    }
    assert_eq!(sidecar.drain_reason(), DrainReason::Executions);
    let status = sidecar
        .wait(Duration::from_secs(10))
        .expect("drained sidecar exits");
    assert_eq!(status.code(), Some(0));

    let mut restarted = support::spawn(Tier::Core, &["--max-executions", "2"]);
    assert_eq!(
        restarted
            .execute(Tier::Core, "export default () => 2", Value::Null)
            .value(),
        json!(2)
    );
}

#[test]
fn the_sidecar_drains_and_restarts_at_its_rss_threshold() {
    let mut sidecar = support::spawn(Tier::Core, &["--max-rss", "1"]);
    sidecar.send(&support::run_frame(
        "held",
        Tier::Core,
        HOLDS,
        Value::Null,
        support::limits(),
    ));
    let Outbound::HostCall { seq, .. } = sidecar.recv() else {
        panic!("expected the held run's host call");
    };
    sidecar.execute(Tier::Core, "export default () => 1", Value::Null);
    assert_eq!(sidecar.drain_reason(), DrainReason::Memory);
    let rejected = sidecar.execute(Tier::Core, "export default () => 1", Value::Null);
    assert_eq!(
        rejected.failure().0,
        Phase::Admission,
        "a draining sidecar admitted a new run"
    );
    sidecar.reply("held", seq, json!("finished"));
    assert_eq!(
        sidecar.finish("held", |_, _| unreachable!()).value(),
        json!("finished")
    );
    let status = sidecar
        .wait(Duration::from_secs(10))
        .expect("drained sidecar exits");
    assert_eq!(status.code(), Some(0));

    let mut restarted = support::spawn(Tier::Core, &[]);
    assert_eq!(
        restarted
            .execute(Tier::Core, "export default () => 2", Value::Null)
            .value(),
        json!(2)
    );
}
