mod support;

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use ryot_sandboxd::protocol::{
    ChunkedType, FRAME_BYTES, HostOutcome, Inbound, Outbound, Phase, Tier, decode_inbound,
    decode_outbound, encode_inbound, encode_outbound, frame, read_frame, split,
};
use ryot_sandboxd::server::EXIT_DESYNC;
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
struct Fixture {
    name: String,
    direction: String,
    expect: String,
}

#[test]
fn protocol_fixtures_conform() {
    let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("protocol-fixtures");
    let index: Vec<Fixture> =
        serde_json::from_slice(&std::fs::read(directory.join("index.json")).expect("index"))
            .expect("index");
    assert!(index.len() >= 30);
    for fixture in index {
        let bytes =
            std::fs::read(directory.join(format!("{}.frame", fixture.name))).expect("fixture");
        let mut reader = bytes.as_slice();
        let payload = match read_frame(&mut reader) {
            Ok(Some(payload)) if reader.is_empty() => payload,
            framed => {
                assert_eq!(fixture.expect, "framing", "{}: {framed:?}", fixture.name);
                continue;
            }
        };
        assert_ne!(fixture.expect, "framing", "{} framed cleanly", fixture.name);
        let reencoded = match fixture.direction.as_str() {
            "inbound" => decode_inbound(payload.clone())
                .map(|decoded| encode_inbound(&decoded))
                .map_err(|rejection| rejection.error),
            _ => decode_outbound(&payload).map(|decoded| encode_outbound(&decoded)),
        };
        match (fixture.expect.as_str(), reencoded) {
            ("valid", Ok(reencoded)) => assert_eq!(
                serde_json::from_slice::<Value>(&reencoded).expect("json"),
                serde_json::from_slice::<Value>(&payload).expect("json"),
                "{}",
                fixture.name
            ),
            ("payload", Err(_)) => {}
            (expect, result) => panic!("{}: expected {expect}, got {result:?}", fixture.name),
        }
    }
}

fn host_result(handle: &str, seq: u64, value: Value) -> Inbound {
    Inbound::HostResult {
        generation: support::GENERATION,
        handle: handle.to_owned(),
        seq,
        outcome: HostOutcome::Success(support::raw(value).into()),
    }
}

#[test]
fn cancel_discards_partial_run_assemblies() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    let source = format!(
        "// {}\nexport default () => 'restarted'",
        "x".repeat(2 * ryot_sandboxd::protocol::PART_BYTES)
    );
    let run = support::run_frame(
        "restarted",
        Tier::Core,
        &source,
        Value::Null,
        support::limits(),
    );
    let payload = encode_inbound(&run);
    let first = split(
        support::GENERATION,
        "restarted",
        0,
        ChunkedType::Run,
        &payload,
    )
    .into_iter()
    .next()
    .expect("first part");
    sidecar.write_raw(&frame(&encode_inbound(&Inbound::Part(first))));
    sidecar.send(&Inbound::Cancel {
        generation: support::GENERATION,
        handle: "restarted".to_owned(),
    });
    sidecar.send(&run);
    assert_eq!(
        sidecar.finish_plain("restarted").value(),
        json!("restarted")
    );
}

#[test]
fn host_result_delivery_keeps_one_native_copy() {
    let value = json!({ "text": "é".repeat(64 * 1024), "items": [1, 2, 3] });
    let payload = encode_inbound(&host_result("copy", 7, value.clone()));
    let buffer = payload.as_ptr();
    let Ok(Inbound::HostResult {
        outcome: HostOutcome::Success(text),
        ..
    }) = decode_inbound(payload)
    else {
        panic!("expected a successful host result");
    };
    let delivered = text.into_string();
    assert_eq!(delivered.as_ptr(), buffer);
    assert_eq!(
        serde_json::from_str::<Value>(&delivered).expect("json"),
        value
    );
}

const ECHO_HOST: &str = "export default async (input, host) => host.call('echo', input)";

#[test]
fn forged_retired_and_foreign_generation_frames_are_dropped() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    sidecar.send(&host_result("forged", 1, json!("forged")));
    sidecar.send(&Inbound::Cancel {
        generation: support::GENERATION,
        handle: "forged".to_owned(),
    });

    sidecar.send(&support::run_frame(
        "live",
        Tier::Core,
        ECHO_HOST,
        json!("input"),
        support::limits(),
    ));
    let Outbound::HostCall { seq, .. } = sidecar.recv() else {
        panic!("expected a host call");
    };
    sidecar.send(&Inbound::HostResult {
        generation: support::GENERATION + 1,
        handle: "live".to_owned(),
        seq,
        outcome: HostOutcome::Success(support::raw(json!("other generation")).into()),
    });
    sidecar.send(&host_result("live", seq + 7, json!("unknown call")));
    sidecar.send(&host_result("live", seq, json!("answered")));
    assert_eq!(sidecar.finish_plain("live").value(), json!("answered"));

    sidecar.send(&host_result("live", seq, json!("retired")));
    sidecar.start("live", "export default () => 'reused'");
    assert!(
        sidecar.recv_within(Duration::from_millis(300)).is_none(),
        "a retired handle produced frames"
    );
    assert_eq!(
        sidecar
            .execute(
                Tier::Core,
                "export default () => 'still serving'",
                Value::Null
            )
            .value(),
        json!("still serving")
    );
}

#[test]
fn late_frames_after_cancel_are_discarded() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    sidecar.send(&support::run_frame(
        "cancelled",
        Tier::Core,
        ECHO_HOST,
        json!(1),
        support::limits(),
    ));
    let Outbound::HostCall { seq, .. } = sidecar.recv() else {
        panic!("expected a host call");
    };
    sidecar.send(&Inbound::Cancel {
        generation: support::GENERATION,
        handle: "cancelled".to_owned(),
    });
    let done = sidecar.finish_plain("cancelled");
    assert!(
        matches!(done.outcome, ryot_sandboxd::protocol::Outcome::Cancelled),
        "{:?}",
        done.outcome
    );
    sidecar.send(&host_result("cancelled", seq, json!("late")));
    sidecar.send(&Inbound::Cancel {
        generation: support::GENERATION,
        handle: "cancelled".to_owned(),
    });
    assert!(sidecar.recv_within(Duration::from_millis(300)).is_none());
}

#[test]
fn duplicate_results_are_dropped() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    sidecar.start("twice", "export default async (_input, host) => [await host.call('first', null), await host.call('second', null)]");
    let Outbound::HostCall { seq: first, .. } = sidecar.recv() else {
        panic!("expected the first call");
    };
    sidecar.send(&host_result("twice", first, json!("one")));
    sidecar.send(&host_result("twice", first, json!("duplicate")));
    let Outbound::HostCall { seq: second, .. } = sidecar.recv() else {
        panic!("expected the second call");
    };
    sidecar.send(&host_result("twice", second, json!("two")));
    sidecar.send(&host_result("twice", second, json!("duplicate")));
    assert_eq!(sidecar.finish_plain("twice").value(), json!(["one", "two"]));
}

#[test]
fn read_frame_rejects_oversize_lengths_before_reading_the_payload() {
    let header = ((FRAME_BYTES + 1) as u32).to_be_bytes();
    let mut reader = header.as_slice();
    assert_eq!(
        read_frame(&mut reader),
        Err(ryot_sandboxd::protocol::FramingError::Length(
            FRAME_BYTES + 1
        ))
    );
}

#[test]
fn oversize_frames_are_rejected_before_allocation_and_desync_restarts_the_sidecar() {
    for header in [u32::MAX.to_be_bytes(), 0_u32.to_be_bytes()] {
        let mut sidecar = support::spawn(Tier::Core, &[]);
        sidecar.write_raw(&header);
        let status = sidecar
            .wait(Duration::from_secs(5))
            .expect("desynced sidecar exits");
        assert_eq!(status.code(), Some(EXIT_DESYNC));
        assert!(sidecar.stderr().contains("protocol desync"));

        let mut restarted = support::spawn(Tier::Core, &[]);
        assert_eq!(
            restarted
                .execute(Tier::Core, "export default () => 'fresh'", Value::Null)
                .value(),
            json!("fresh")
        );
    }
}

#[test]
fn a_well_framed_invalid_payload_fails_only_its_execution() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    sidecar.send(&support::run_frame(
        "healthy",
        Tier::Core,
        ECHO_HOST,
        json!("ok"),
        support::limits(),
    ));
    let Outbound::HostCall { seq, .. } = sidecar.recv() else {
        panic!("expected a host call");
    };
    let mut invalid: Value = serde_json::from_slice(&encode_inbound(&support::run_frame(
        "broken",
        Tier::Core,
        ECHO_HOST,
        Value::Null,
        support::limits(),
    )))
    .expect("json");
    invalid["module"]["sha256"] = json!("not-a-digest");
    sidecar.write_raw(&frame(invalid.to_string().as_bytes()));
    sidecar.write_raw(&frame(b"{\"type\":\"cancel\",\"handle\":"));
    let broken = sidecar.finish_plain("broken");
    assert_eq!(broken.failure().0, Phase::Protocol);
    sidecar.send(&host_result("healthy", seq, json!("ok")));
    assert_eq!(sidecar.finish_plain("healthy").value(), json!("ok"));
}

#[test]
fn bounded_queues_apply_backpressure() {
    let mut sidecar = support::spawn(Tier::Core, &["--threads", "1", "--queue", "1"]);
    sidecar.start(
        "blocker",
        "export default () => new Promise((resolve) => setTimeout(() => resolve('blocker'), 2000))",
    );
    let source = format!(
        "export default () => 'queued'; // {}",
        "x".repeat(60 * 1024)
    );
    let frames: Vec<u8> = (0..20)
        .flat_map(|index| {
            frame(&encode_inbound(&support::run_frame(
                &format!("queued-{index}"),
                Tier::Core,
                &source,
                Value::Null,
                support::limits(),
            )))
        })
        .collect();
    let mut socket = sidecar.raw_socket().try_clone().expect("socket");
    let (written, finished) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        std::io::Write::write_all(&mut socket, &frames).expect("write");
        written.send(()).expect("signal");
    });
    assert!(
        finished.recv_timeout(Duration::from_millis(1000)).is_err(),
        "the sidecar buffered every queued run instead of pushing back"
    );
    assert_eq!(sidecar.finish_plain("blocker").value(), json!("blocker"));
    let mut done = 0;
    while done < 20 {
        if let Outbound::Done { outcome, .. } = sidecar.recv() {
            assert!(
                matches!(outcome, ryot_sandboxd::protocol::Outcome::Completed(_)),
                "{outcome:?}"
            );
            done += 1;
        }
    }
    finished
        .recv_timeout(Duration::from_secs(5))
        .expect("writes completed once the queue drained");
}

#[test]
fn a_chunked_large_payload_does_not_delay_another_executions_frames() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    let input = json!({ "padding": "y".repeat(300 * 1024) });
    sidecar.send(&support::run_frame(
        "large",
        Tier::Core,
        "export default async (input) => { await new Promise((resolve) => setTimeout(resolve, 50)); return 'x'.repeat(3.5 * 1024 * 1024) + input.padding.length; }",
        input,
        support::limits(),
    ));
    sidecar.start(
        "small",
        "export default () => new Promise((resolve) => setTimeout(() => resolve('small'), 400))",
    );
    let raw = sidecar.raw_socket();
    let mut order = Vec::new();
    let mut reader = raw.try_clone().expect("socket");
    while !order
        .iter()
        .any(|entry: &(String, bool)| entry.0 == "large" && entry.1)
    {
        std::thread::sleep(Duration::from_millis(5));
        let payload = read_frame(&mut reader).expect("frame").expect("open");
        match decode_outbound(&payload).expect("frame") {
            Outbound::Part(part) => order.push((part.handle, part.index + 1 == part.count)),
            Outbound::Done { handle, .. } => order.push((handle, true)),
            other => panic!("unexpected frame {other:?}"),
        }
    }
    let small = order
        .iter()
        .position(|entry| entry.0 == "small")
        .expect("small finished");
    let parts = order.iter().filter(|entry| entry.0 == "large").count();
    assert!(
        parts > 50,
        "the large result was not chunked: {parts} parts"
    );
    assert!(
        small < order.len() - 1,
        "the small result waited for every large part: {order:?}"
    );
}

#[test]
fn interleaved_executions_are_attributed_correctly() {
    let mut sidecar = support::spawn(Tier::Core, &["--threads", "8"]);
    let source = "export default async (input, host) => { const values = []; for (let i = 0; i < 5; i++) values.push(await host.call('whoami', { principal: input.principal, i })); return values; }";
    for index in 0..8 {
        sidecar.send(&support::run_frame(
            &format!("principal-{index}"),
            Tier::Core,
            source,
            json!({ "principal": index }),
            support::limits(),
        ));
    }
    let mut results = HashMap::new();
    while results.len() < 8 {
        match sidecar.recv() {
            Outbound::HostCall {
                handle, seq, args, ..
            } => {
                let args: Value = serde_json::from_str(args.get()).expect("args");
                assert_eq!(
                    handle,
                    format!("principal-{}", args["principal"]),
                    "call attributed to the wrong handle"
                );
                sidecar.send(&host_result(
                    &handle,
                    seq,
                    json!(format!("{handle}:{}", args["i"])),
                ));
            }
            Outbound::Done {
                handle, outcome, ..
            } => {
                results.insert(handle, outcome);
            }
            other => panic!("unexpected frame {other:?}"),
        }
    }
    for index in 0..8 {
        let handle = format!("principal-{index}");
        let ryot_sandboxd::protocol::Outcome::Completed(value) = &results[&handle] else {
            panic!("{handle} failed: {:?}", results[&handle]);
        };
        let expected: Vec<String> = (0..5).map(|i| format!("{handle}:{i}")).collect();
        assert_eq!(
            serde_json::from_str::<Vec<String>>(value.get()).expect("values"),
            expected
        );
    }
}

#[test]
fn startup_rejects_a_snapshot_whose_digest_does_not_match() {
    let directory =
        std::env::temp_dir().join(format!("ryot-sandboxd-tampered-{}", std::process::id()));
    std::fs::create_dir_all(&directory).expect("temp dir");
    let mut snapshot =
        std::fs::read(Path::new(support::snapshots()).join("core.snap")).expect("snapshot");
    let middle = snapshot.len() / 2;
    snapshot[middle] ^= 0xff;
    std::fs::write(directory.join("core.snap"), snapshot).expect("tampered snapshot");

    let mut command = support::command(Tier::Core, &[]);
    command.args(["--snapshots", directory.to_str().expect("utf-8 path")]);
    let output = command.output().expect("run sidecar");
    std::fs::remove_dir_all(&directory).ok();
    assert_eq!(output.status.code(), Some(66));
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("does not match the manifest digest"),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn a_run_whose_module_hash_does_not_match_fails() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    let mut run = support::run(
        "tampered",
        Tier::Core,
        "export default () => 'expected'",
        Value::Null,
        support::limits(),
    );
    run.module.source = "export default () => 'substituted'".to_owned();
    sidecar.send(&Inbound::Run(run));
    let done = sidecar.finish_plain("tampered");
    assert_eq!(done.failure().0, Phase::Integrity);
    assert!(
        sidecar.wait(Duration::from_millis(50)).is_none(),
        "the sidecar keeps serving"
    );
}
