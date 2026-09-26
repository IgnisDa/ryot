mod support;

use std::path::Path;
use std::time::Duration;

use ryot_sandboxd::protocol::{Inbound, Lane, Module, Phase, Run, Tier};
use serde_json::Value;

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
    let module = Module {
        sha256: support::module("export default () => 'expected'").sha256,
        source: "export default () => 'substituted'".to_owned(),
    };
    sidecar.send(&Inbound::Run(Box::new(Run::new(
        support::GENERATION,
        "tampered".to_owned(),
        Tier::Core,
        Lane::Interactive,
        support::raw(Value::Null),
        module,
        support::limits(),
    ))));
    let done = sidecar.finish("tampered", |name, _| panic!("unexpected host call {name}"));
    assert_eq!(done.failure().0, Phase::Integrity);
    assert!(
        sidecar.wait(Duration::from_millis(50)).is_none(),
        "the sidecar keeps serving"
    );
}
