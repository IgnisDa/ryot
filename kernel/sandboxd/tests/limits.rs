mod support;

use std::collections::HashMap;
use std::time::Duration;

use ryot_sandboxd::protocol::{LimitKind, Limits, Outbound, Outcome, Phase, Tier};
use serde_json::{Value, json};

const MIB: u64 = 1024 * 1024;
const NEIGHBOUR: &str = "export default async (input) => { await new Promise((resolve) => setTimeout(resolve, 20)); return input; }";

fn tight() -> Limits {
    Limits {
        cpu_ms: 500,
        heap_bytes: 32 * MIB,
        deadline_ms: 5_000,
        external_bytes: 16 * MIB,
    }
}

fn contain(tier: Tier, abuses: &[(&str, &str, Limits)]) -> HashMap<String, Outcome> {
    let mut sidecar = support::spawn(tier, &[]);
    for (handle, source, limits) in abuses {
        sidecar.send(&support::run_frame(
            handle,
            tier,
            source,
            Value::Null,
            limits.clone(),
        ));
    }
    for index in 0..4 {
        sidecar.send(&support::run_frame(
            &format!("neighbour-{index}"),
            tier,
            NEIGHBOUR,
            json!(index),
            support::limits(),
        ));
    }
    let mut outcomes = HashMap::new();
    while outcomes.len() < abuses.len() + 4 {
        match sidecar.recv() {
            Outbound::Done {
                handle, outcome, ..
            } => {
                outcomes.insert(handle, outcome);
            }
            other => panic!("unexpected frame {other:?}"),
        }
    }
    for index in 0..4 {
        match &outcomes[&format!("neighbour-{index}")] {
            Outcome::Completed(value) => assert_eq!(value.get(), index.to_string()),
            other => panic!("neighbour {index} was affected: {other:?}"),
        }
    }
    outcomes
}

fn limit_of(outcome: &Outcome) -> Option<LimitKind> {
    match outcome {
        Outcome::Limit(limit, _) => Some(*limit),
        _ => None,
    }
}

#[test]
fn loops_and_fill_loops_are_stopped_at_the_cpu_limit() {
    let outcomes = contain(
        Tier::Core,
        &[
            ("loop", "export default () => { for (;;) {} }", tight()),
            (
                "fill",
                "export default () => { const values = new Array(10000); for (;;) values.fill(1); }",
                tight(),
            ),
            (
                "regex",
                "export default () => /^(a+)+$/.test('a'.repeat(40) + 'b')",
                tight(),
            ),
        ],
    );
    for handle in ["loop", "fill", "regex"] {
        assert_eq!(
            limit_of(&outcomes[handle]),
            Some(LimitKind::Cpu),
            "{handle}: {:?}",
            outcomes[handle]
        );
    }
}

#[test]
fn heap_growth_is_stopped_at_the_heap_limit() {
    let outcomes = contain(
        Tier::Core,
        &[
            (
                "objects",
                "export default () => { const kept = []; for (;;) kept.push({ value: kept.length, text: 'x' + kept.length }); }",
                Limits {
                    cpu_ms: 30_000,
                    ..tight()
                },
            ),
            (
                "map",
                "export default () => { const map = new Map(); for (let i = 0; ; i++) map.set(i, { i }); }",
                Limits {
                    cpu_ms: 30_000,
                    ..tight()
                },
            ),
        ],
    );
    for handle in ["objects", "map"] {
        assert_eq!(
            limit_of(&outcomes[handle]),
            Some(LimitKind::Heap),
            "{handle}: {:?}",
            outcomes[handle]
        );
    }
}

#[test]
fn array_buffers_and_external_memory_are_contained() {
    let external_limits = Limits {
        heap_bytes: 128 * MIB,
        ..tight()
    };
    let outcomes = contain(
        Tier::Core,
        &[
            (
                "buffers",
                "export default () => { const kept = []; for (;;) kept.push(new ArrayBuffer(4 * 1024 * 1024)); }",
                external_limits.clone(),
            ),
            (
                "huge",
                "export default () => new Uint8Array(750 * 1024 * 1024).length",
                external_limits.clone(),
            ),
            (
                "encoded",
                "export default () => { const kept = []; const text = 'x'.repeat(1024 * 1024); for (;;) kept.push(new TextEncoder().encode(text)); }",
                external_limits.clone(),
            ),
            (
                "cloned",
                "export default () => { const kept = []; const source = new ArrayBuffer(4 * 1024 * 1024); for (;;) kept.push(structuredClone(source)); }",
                external_limits,
            ),
        ],
    );
    for handle in ["buffers", "huge", "encoded", "cloned"] {
        assert_eq!(
            limit_of(&outcomes[handle]),
            Some(LimitKind::External),
            "{handle}: {:?}",
            outcomes[handle]
        );
    }
}

/// Measurement for S6: with the counting allocator cap raised to its maximum, V8's own heap and
/// external-memory accounting still stops retained ArrayBuffer growth.
#[test]
fn v8_accounting_stops_array_buffer_growth_without_the_allocator_cap() {
    let outcomes = contain(
        Tier::Core,
        &[(
            "accounting",
            "export default () => { const kept = []; for (;;) kept.push(new ArrayBuffer(4 * 1024 * 1024)); }",
            Limits {
                external_bytes: 1024 * MIB,
                heap_bytes: 64 * MIB,
                ..tight()
            },
        )],
    );
    let outcome = &outcomes["accounting"];
    assert!(
        matches!(
            limit_of(outcome),
            Some(LimitKind::Heap | LimitKind::External)
        ),
        "{outcome:?}"
    );
    eprintln!(
        "S6 measurement: retained ArrayBuffer growth without the allocator cap ended with {outcome:?}"
    );
}

#[test]
fn deadlines_expire_while_host_call_waits_do_not_count() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    let limits = Limits {
        deadline_ms: 400,
        ..support::limits()
    };
    let idle = sidecar.execute_with(
        Tier::Core,
        "export default () => new Promise((resolve) => setTimeout(resolve, 60_000))",
        Value::Null,
        limits.clone(),
    );
    assert_eq!(idle.limit(), LimitKind::Deadline);

    sidecar.send(&support::run_frame(
        "waits",
        Tier::Core,
        "export default async (_input, host) => host.call('slow', null)",
        Value::Null,
        limits,
    ));
    let done = sidecar.finish("waits", |_, _| {
        std::thread::sleep(Duration::from_millis(800));
        json!("answered")
    });
    assert_eq!(done.value(), json!("answered"));
}

#[test]
fn termination_escalates_with_the_culprit_reported_before_exit() {
    let mut sidecar = support::spawn(Tier::Full, &["--grace-ms", "1"]);
    sidecar.send(&support::run_frame(
        "native",
        Tier::Full,
        "export default async () => { const data = new Uint8Array(12 * 1024 * 1024); for (;;) await crypto.subtle.digest('SHA-512', data); }",
        Value::Null,
        Limits {
            cpu_ms: 20,
            ..support::limits()
        },
    ));
    match sidecar.recv() {
        Outbound::Fatal { handle, generation } => {
            assert_eq!(handle, "native");
            assert_eq!(generation, support::GENERATION);
        }
        other => panic!("expected the culprit to be reported, got {other:?}"),
    }
    let status = sidecar
        .wait(Duration::from_secs(10))
        .expect("sidecar exits");
    assert_eq!(status.code(), Some(ryot_sandboxd::server::EXIT_ESCALATED));
}

#[test]
fn uninterruptible_allocation_escalates_with_the_culprit_reported_before_exit() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    sidecar.send(&support::run_frame(
        "fill",
        Tier::Core,
        "export default () => new Array(2 ** 32 - 1).fill(0)",
        Value::Null,
        tight(),
    ));
    match sidecar.recv() {
        Outbound::Fatal { handle, .. } => assert_eq!(handle, "fill"),
        other => panic!("expected the culprit to be reported, got {other:?}"),
    }
    let status = sidecar
        .wait(Duration::from_secs(10))
        .expect("sidecar exits");
    assert_eq!(status.code(), Some(ryot_sandboxd::server::EXIT_ESCALATED));
}

#[test]
fn crash_probes_do_not_crash_the_process() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    let probes = [
        "const f = () => f(); f();",
        "JSON.parse('['.repeat(1_000_000) + ']'.repeat(1_000_000));",
        "let value = []; for (let i = 0; i < 100_000; i++) value = [value]; JSON.stringify(value);",
        "let value = {}; for (let i = 0; i < 100_000; i++) value = { value }; structuredClone(value);",
        "/(x+x+)+y/.test('x'.repeat(5000));",
        "new Array(2 ** 32 - 1);",
        "'x'.repeat(2 ** 30);",
        "new ArrayBuffer(2 ** 40);",
        "const set = new Set(); for (let i = 0; ; i++) set.add(i);",
        "let text = 'x'; for (;;) text += text;",
        "for (;;) Array.from({ length: 100_000 }, () => Math.random()).sort((a, b) => a - b);",
        "for (;;) new Array(1_000_000).join('x');",
        "for (;;) 'a'.repeat(200_000).replaceAll('a', 'bb');",
    ];
    for probe in probes {
        let done = sidecar.execute_with(
            Tier::Core,
            &format!("export default () => {{ {probe} return 'finished'; }}"),
            Value::Null,
            tight(),
        );
        match &done.outcome {
            Outcome::Completed(_) | Outcome::Limit(..) | Outcome::Failed(Phase::Execution, _) => {}
            other => panic!("{probe}: unexpected outcome {other:?}"),
        }
        assert_eq!(
            sidecar
                .execute(Tier::Core, "export default () => 'alive'", Value::Null)
                .value(),
            json!("alive"),
            "after {probe}"
        );
    }
}

#[test]
fn ext_data_file_and_remote_imports_are_rejected_at_resolution() {
    let mut sidecar = support::spawn(Tier::Full, &[]);
    for specifier in [
        "ext:core/ops",
        "ext:core/mod.js",
        "data:text/javascript,export default 1",
        "file:///etc/passwd",
        "https://example.com/module.js",
        "node:fs",
        "./sibling.js",
    ] {
        let done = sidecar.execute(
            Tier::Full,
            &format!("import value from {specifier:?};\nexport default () => value;"),
            Value::Null,
        );
        assert_eq!(done.failure().0, Phase::Resolution, "{specifier}");
        let dynamic = sidecar.execute(
            Tier::Full,
            &format!("export default () => import({specifier:?}).then(() => 'loaded', (error) => String(error))"),
            Value::Null,
        );
        let message = dynamic.value();
        assert!(
            message
                .as_str()
                .is_some_and(|message| message.contains("import not allowed")),
            "{specifier}: {message}"
        );
    }
}

#[test]
fn a_stopped_run_waiting_for_a_cpu_slot_is_not_escalated() {
    let mut sidecar = support::spawn(Tier::Core, &["--max-active", "1", "--grace-ms", "200"]);
    sidecar.send(&support::run_frame(
        "parked",
        Tier::Core,
        "export default async (_input, host) => host.call('hold', null)",
        Value::Null,
        support::limits(),
    ));
    assert!(matches!(sidecar.recv(), Outbound::HostCall { .. }));
    sidecar.send(&support::run_frame(
        "busy",
        Tier::Core,
        "export default () => { for (;;) {} }",
        Value::Null,
        Limits {
            cpu_ms: 1_500,
            ..support::limits()
        },
    ));
    std::thread::sleep(Duration::from_millis(100));
    sidecar.send(&ryot_sandboxd::protocol::Inbound::Cancel {
        generation: support::GENERATION,
        handle: "parked".to_owned(),
    });
    let mut outcomes = HashMap::new();
    while outcomes.len() < 2 {
        match sidecar.recv() {
            Outbound::Done {
                handle, outcome, ..
            } => {
                outcomes.insert(handle, outcome);
            }
            other => panic!("the waiting run was escalated: {other:?}"),
        }
    }
    assert!(
        matches!(outcomes["parked"], Outcome::Cancelled),
        "{:?}",
        outcomes["parked"]
    );
    assert_eq!(limit_of(&outcomes["busy"]), Some(LimitKind::Cpu));
}

#[test]
fn oversized_results_and_host_arguments_fail_inside_the_heap() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    let result = sidecar.execute(
        Tier::Core,
        "export default () => '\\u0100'.repeat(5 * 1024 * 1024)",
        Value::Null,
    );
    let (phase, message) = result.failure();
    assert_eq!(phase, Phase::Result);
    assert!(message.contains("exceeds"), "{message}");

    let arguments = sidecar.execute(
        Tier::Core,
        "export default (_input, host) => host.call('echo', 'x'.repeat(2 * 1024 * 1024)).then(() => 'sent', (error) => error.message)",
        Value::Null,
    );
    assert_eq!(
        arguments.value(),
        json!("Host call name or arguments are too large")
    );
}

#[test]
fn script_errors_and_results_stay_bounded_before_reaching_rust() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    let limits = Limits {
        heap_bytes: 256 * MIB,
        ..support::limits()
    };
    for (source, phase) in [
        (
            "throw new Error('\\u0100'.repeat(20_000_000)); export default () => 1;",
            Phase::Evaluation,
        ),
        (
            "export default () => { Promise.reject(new Error('\\u0100'.repeat(20_000_000))); return new Promise((resolve) => setTimeout(resolve, 20)); }",
            Phase::Execution,
        ),
        (
            "export default () => { setTimeout(() => { throw new Error('\\u0100'.repeat(20_000_000)); }); return new Promise((resolve) => setTimeout(resolve, 20)); }",
            Phase::Execution,
        ),
        (
            "export default () => { queueMicrotask(() => { throw new Error('\\u0100'.repeat(20_000_000)); }); return new Promise((resolve) => setTimeout(resolve, 20)); }",
            Phase::Execution,
        ),
    ] {
        let done = sidecar.execute_with(Tier::Core, source, Value::Null, limits.clone());
        let (actual, message) = done.failure();
        assert_eq!(actual, phase, "{source}");
        assert!(
            message.len() <= 8192 * 3,
            "{source}: {} bytes",
            message.len()
        );
    }

    let hijacked = sidecar.execute_with(
        Tier::Core,
        "export default () => { Array.prototype.then = function (resolve) { resolve(['c', 'x'.repeat(100_000_000)]); }; String.prototype.slice = function () { return this; }; return 'honest'; }",
        Value::Null,
        limits,
    );
    assert_eq!(hijacked.value(), json!("honest"));
}
