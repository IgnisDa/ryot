#![cfg(target_os = "linux")]

mod support;

use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::os::unix::net::{UnixDatagram, UnixStream};
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::process::{Child, ChildStdout, Command, Output, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

use ryot_sandboxd::protocol::{self, Limits, Outbound, Tier};
use serde_json::Value;

const LAUNCHER: &str = "/usr/local/libexec/ryot-sandbox-launcher";
const EXECUTABLE: &str = "/home/ryot/sandboxd/ryot-sandboxd";
const RECORDS: &str = "/run/ryot-sandboxd";
const BACKEND_UID: u32 = 1001;
const SIDECAR_UID: u32 = 1002;
const PROBE: &str = "RYOT_LAUNCHER_PROBE";
const TARGET_PID: &str = "RYOT_LAUNCHER_TARGET_PID";

struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            self.0.kill().ok();
            self.0.wait().ok();
        }
    }
}

fn setup() {
    assert_eq!(
        unsafe { libc::geteuid() },
        0,
        "launcher setup failure: run tests as root in the prepared Linux container"
    );
    let launcher = fs::metadata(LAUNCHER)
        .unwrap_or_else(|error| panic!("launcher setup failure: {LAUNCHER} is missing: {error}"));
    assert_eq!(
        launcher.uid(),
        0,
        "launcher setup failure: installed launcher is not root-owned"
    );
    assert_eq!(
        launcher.permissions().mode() & 0o7777,
        0o4755,
        "launcher setup failure: installed launcher must be mode 04755"
    );
    let executable = fs::metadata(EXECUTABLE)
        .unwrap_or_else(|error| panic!("launcher setup failure: {EXECUTABLE} is missing: {error}"));
    assert_eq!(
        executable.uid(),
        0,
        "launcher setup failure: installed sidecar is not root-owned"
    );
    let records = fs::metadata(RECORDS)
        .unwrap_or_else(|error| panic!("launcher setup failure: {RECORDS} is missing: {error}"));
    assert_eq!(
        records.uid(),
        0,
        "launcher setup failure: attestation directory is not root-owned"
    );
    assert_eq!(
        records.permissions().mode() & 0o777,
        0o700,
        "launcher setup failure: attestation directory must be private"
    );

    let status = fs::read_to_string("/proc/self/status").expect("read test process status");
    let capabilities = status
        .lines()
        .find_map(|line| line.strip_prefix("CapEff:\t"))
        .and_then(|value| u64::from_str_radix(value, 16).ok())
        .expect("effective capability mask");
    assert_eq!(
        capabilities & (1 << 19),
        0,
        "launcher tests must use Docker's default capabilities, without CAP_SYS_PTRACE"
    );
    assert!(
        status.lines().any(|line| line == "NoNewPrivs:\t0"),
        "launcher tests must not enable no_new_privs on the container"
    );
}

fn launch_args() -> Vec<String> {
    launch_args_for("user", "core")
}

fn launch_args_for(trust: &str, tier: &str) -> Vec<String> {
    [
        "launch",
        "--generation",
        "1",
        "--tier",
        tier,
        "--trust",
        trust,
        "--threads",
        "1",
        "--queue",
        "1",
        "--max-active",
        "1",
        "--memory-budget",
        "67108864",
        "--max-rss",
        "1073741824",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect()
}

fn attach_descriptor(command: &mut Command, fd: i32, no_new_privs: bool) {
    // SAFETY: only descriptor setup and an optional prctl run between fork and exec.
    unsafe {
        command.pre_exec(move || {
            if fd >= 0 {
                if fd != 3 && libc::dup2(fd, 3) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                if fd == 3 {
                    let flags = libc::fcntl(3, libc::F_GETFD);
                    if flags < 0 || libc::fcntl(3, libc::F_SETFD, flags & !libc::FD_CLOEXEC) < 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                }
            }
            if no_new_privs && libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

fn invoke(args: &[String], uid: u32, descriptor: Option<i32>, no_new_privs: bool) -> Output {
    let mut command = Command::new(LAUNCHER);
    command
        .args(args)
        .env_clear()
        .env("LAUNCHER_INHERITED_SECRET", "not-for-sidecar")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .uid(uid)
        .gid(uid);
    attach_descriptor(&mut command, descriptor.unwrap_or(-1), no_new_privs);
    command.output().expect("run installed launcher")
}

fn assert_rejected(
    args: &[String],
    uid: u32,
    descriptor: Option<i32>,
    no_new_privs: bool,
    detail: &str,
) {
    let output = invoke(args, uid, descriptor, no_new_privs);
    assert!(!output.status.success(), "launcher accepted {detail}");
    assert!(
        String::from_utf8_lossy(&output.stderr).contains(detail),
        "launcher rejection did not identify {detail}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn read_output_line(receiver: &Receiver<String>) -> String {
    loop {
        let line = receiver
            .recv_timeout(Duration::from_secs(15))
            .expect("launcher probe did not report within 15 seconds");
        if line.starts_with("LAUNCHER_") || line.starts_with("FOREIGN_") {
            return line;
        }
    }
}

fn output_lines(stdout: ChildStdout) -> Receiver<String> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if sender.send(line).is_err() {
                        return;
                    }
                }
                Err(error) => {
                    sender.send(format!("LAUNCHER_OUTPUT_ERROR {error}")).ok();
                    return;
                }
            }
        }
    });
    receiver
}

fn probe_child(mode: &str) -> ChildGuard {
    let executable = std::env::current_exe().expect("launcher test executable");
    let mut command = Command::new(executable);
    command
        .args(["--exact", "launcher_identity_probe_child", "--nocapture"])
        .env_clear()
        .env(PROBE, mode)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .uid(BACKEND_UID)
        .gid(BACKEND_UID);
    ChildGuard(command.spawn().expect("spawn UID-1001 launcher probe"))
}

fn write_probe(child: &mut Child, message: &str) {
    child
        .stdin
        .as_mut()
        .expect("launcher probe stdin")
        .write_all(format!("{message}\n").as_bytes())
        .expect("send launcher probe command");
    child
        .stdin
        .as_mut()
        .unwrap()
        .flush()
        .expect("flush probe command");
}

fn alter_record(record: &str, key: &str) -> String {
    record
        .lines()
        .map(|line| {
            if let Some(value) = line.strip_prefix(&format!("{key}=")) {
                let number = value.parse::<u64>().expect("numeric attestation field");
                format!("{key}={}", number + 1)
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

#[test]
fn launcher_rejects_untrusted_callers_paths_and_descriptors() {
    setup();

    assert_rejected(&launch_args(), BACKEND_UID, None, false, "descriptor 3");
    let (peer, inherited) = UnixStream::pair().expect("socket pair");
    assert_rejected(
        &launch_args(),
        BACKEND_UID,
        Some(inherited.as_raw_fd()),
        false,
        "peer must be the UID-1001 backend parent",
    );
    drop((peer, inherited));

    let (datagram, other_datagram) = UnixDatagram::pair().expect("datagram pair");
    assert_rejected(
        &launch_args(),
        BACKEND_UID,
        Some(datagram.as_raw_fd()),
        false,
        "SOCK_STREAM",
    );
    drop((datagram, other_datagram));

    // SAFETY: socket creates an unconnected AF_UNIX stream descriptor for rejection testing.
    let unconnected =
        unsafe { libc::socket(libc::AF_UNIX, libc::SOCK_STREAM | libc::SOCK_CLOEXEC, 0) };
    assert!(unconnected >= 0, "create unconnected stream socket");
    // SAFETY: socket returned a new descriptor owned by this test.
    let unconnected = unsafe { OwnedFd::from_raw_fd(unconnected) };
    assert_rejected(
        &launch_args(),
        BACKEND_UID,
        Some(unconnected.as_raw_fd()),
        false,
        "connected AF_UNIX peer",
    );

    assert_rejected(&launch_args(), SIDECAR_UID, None, false, "real UID 1001");
    assert_rejected(
        &["terminate".to_owned(), "1".to_owned()],
        SIDECAR_UID,
        None,
        false,
        "real UID 1001",
    );
    assert_rejected(&launch_args(), BACKEND_UID, None, true, "no_new_privs");

    for (flag, value) in [
        ("--snapshots", "/tmp"),
        ("--executable", "/bin/true"),
        ("--uid", "0"),
        ("--max-executions", "1"),
        ("--grace-ms", "0"),
    ] {
        let mut args = launch_args();
        args[3] = flag.to_owned();
        args[4] = value.to_owned();
        assert_rejected(
            &args,
            BACKEND_UID,
            None,
            false,
            "unsupported launcher argument",
        );
    }
    let mut duplicate = launch_args();
    duplicate[3] = "--generation".to_owned();
    assert_rejected(
        &duplicate,
        BACKEND_UID,
        None,
        false,
        "--generation must appear exactly once",
    );
    let mut zero = launch_args();
    zero[8] = "0".to_owned();
    assert_rejected(
        &zero,
        BACKEND_UID,
        None,
        false,
        "--threads must be positive",
    );
    let mut overflow = launch_args();
    overflow[14] = u64::MAX.to_string() + "0";
    assert_rejected(
        &overflow,
        BACKEND_UID,
        None,
        false,
        "--memory-budget is out of range",
    );
    let mut bad_tier = launch_args();
    bad_tier[4] = "/tmp/snapshots".to_owned();
    assert_rejected(
        &bad_tier,
        BACKEND_UID,
        None,
        false,
        "--tier must be core, data, or full",
    );
}

#[test]
fn launcher_termination_is_bound_to_caller_child_identity_and_pidfd() {
    setup();
    let mut child = probe_child("identity");
    let output = output_lines(child.0.stdout.take().expect("probe stdout"));
    let ready = read_output_line(&output);
    let pid = ready
        .strip_prefix("LAUNCHER_READY ")
        .expect("launcher probe readiness")
        .parse::<u32>()
        .expect("sidecar PID");
    let record_path = format!("{RECORDS}/{pid}");
    let record = fs::read_to_string(&record_path).expect("root-owned sidecar attestation");
    let metadata = fs::metadata(&record_path).expect("attestation metadata");
    assert_eq!(metadata.uid(), 0);
    assert_eq!(metadata.permissions().mode() & 0o7777, 0o600);

    for key in ["executable_ino", "caller_start", "child_start"] {
        fs::write(&record_path, alter_record(&record, key))
            .expect("alter root-owned test attestation");
        write_probe(&mut child.0, &format!("try {key}"));
        assert_eq!(
            read_output_line(&output),
            format!("LAUNCHER_REJECTED {key}")
        );
        fs::write(&record_path, &record).expect("restore launch attestation");
    }

    write_probe(&mut child.0, "terminate");
    assert_eq!(read_output_line(&output), "LAUNCHER_KILLED");
    let status = child.0.wait().expect("launcher probe exit");
    assert!(status.success(), "launcher probe failed: {status}");
    assert!(
        !std::path::Path::new(&record_path).exists(),
        "successful termination retained its attestation"
    );
}

#[test]
fn sidecar_identity_environment_and_descriptors_are_confined() {
    setup();
    for trust in ["system", "user"] {
        for tier in ["core", "data", "full"] {
            let key = format!("{trust}/{tier}");
            let mut child = probe_child(&format!("key:{key}"));
            let output = output_lines(child.0.stdout.take().expect("probe stdout"));
            assert_eq!(
                read_output_line(&output),
                format!("LAUNCHER_CONFINED {key}")
            );
            let status = child.0.wait().expect("launcher probe exit");
            assert!(status.success(), "{key} identity probe failed: {status}");
        }
    }
}

#[test]
fn launcher_identity_probe_child() {
    let Ok(mode) = std::env::var(PROBE) else {
        return;
    };
    assert_eq!(unsafe { libc::geteuid() }, BACKEND_UID);
    let key = mode.strip_prefix("key:");
    let (trust, tier) = key
        .and_then(|key| key.split_once('/'))
        .unwrap_or(("user", "core"));
    let (mut socket, child_socket) = UnixStream::pair().expect("backend protocol socket");
    socket
        .set_read_timeout(Some(Duration::from_secs(10)))
        .expect("set protocol timeout");
    let mut command = Command::new(LAUNCHER);
    command
        .args(launch_args_for(trust, tier))
        .env_clear()
        .env("LAUNCHER_INHERITED_SECRET", "should-not-survive")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let socket_fd = child_socket.as_raw_fd();
    let extra = File::open("/dev/null").expect("extra inherited descriptor");
    let extra_fd = extra.as_raw_fd();
    // SAFETY: the child only remaps the protocol socket and a deliberate extra descriptor before exec.
    unsafe {
        command.pre_exec(move || {
            if socket_fd != 3 && libc::dup2(socket_fd, 3) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            if socket_fd == 3 {
                let flags = libc::fcntl(3, libc::F_GETFD);
                if flags < 0 || libc::fcntl(3, libc::F_SETFD, flags & !libc::FD_CLOEXEC) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
            }
            if libc::dup2(extra_fd, 10) < 0 || libc::fcntl(10, libc::F_SETFD, 0) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut child = ChildGuard(command.spawn().expect("spawn installed launcher"));
    let stderr = child.0.stderr.take().expect("launcher stderr");
    let (diagnostic_sender, diagnostic_receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut diagnostic = String::new();
        stderr.take(4096).read_to_string(&mut diagnostic).ok();
        diagnostic_sender.send(diagnostic).ok();
    });
    drop(child_socket);
    let ready = match protocol::read_frame(&mut socket) {
        Ok(Some(ready)) => ready,
        result => {
            let deadline = Instant::now() + Duration::from_secs(1);
            let status = loop {
                let status = child.0.try_wait().expect("sidecar startup exit status");
                if status.is_some() || Instant::now() >= deadline {
                    break status;
                }
                thread::sleep(Duration::from_millis(10));
            };
            let status = status.map(|status| status.to_string());
            let diagnostic = diagnostic_receiver
                .recv_timeout(Duration::from_secs(1))
                .unwrap_or_else(|_| "startup stderr did not close within one second".to_owned());
            panic!(
                "sidecar failed before ready: frame={result:?}, status={status:?}, stderr={diagnostic:?}"
            );
        }
    };
    assert!(matches!(
        protocol::decode_outbound(&ready).expect("decode sidecar frame"),
        Outbound::Ready { generation: 1 }
    ));

    let pid = child.0.id();
    let status = fs::read_to_string(format!("/proc/{pid}/status")).expect("sidecar process status");
    assert!(
        status
            .lines()
            .any(|line| line == "Uid:\t1002\t1002\t1002\t1002"),
        "{status}"
    );
    assert!(
        status
            .lines()
            .any(|line| line == "Gid:\t1002\t1002\t1002\t1002"),
        "{status}"
    );
    assert!(
        status.lines().any(|line| line.trim() == "Groups:"),
        "{status}"
    );
    assert!(
        status.lines().any(|line| line == "NoNewPrivs:\t1"),
        "{status}"
    );
    assert!(status.lines().any(|line| line == "Seccomp:\t2"), "{status}");
    match fs::read(format!("/proc/{pid}/environ")) {
        Ok(environment) => assert!(environment.is_empty()),
        Err(error) => assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied),
    }
    assert_eq!(
        fs::read_to_string(format!("/proc/{pid}/oom_score_adj"))
            .expect("sidecar OOM score")
            .trim(),
        "1000"
    );
    match fs::read_dir(format!("/proc/{pid}/fd")) {
        Ok(entries) => {
            let descriptors = entries
                .map(|entry| entry.expect("descriptor entry").file_name())
                .collect::<Vec<_>>();
            assert!(
                descriptors.iter().any(|name| name == "3"),
                "{descriptors:?}"
            );
            assert!(
                !descriptors.iter().any(|name| name == "10"),
                "launcher leaked an unrelated descriptor: {descriptors:?}"
            );
            assert!(
                !descriptors
                    .iter()
                    .any(|name| matches!(name.to_str(), Some("0" | "1" | "2"))),
                "launcher inherited standard descriptors: {descriptors:?}"
            );
        }
        Err(error) => assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied),
    }
    let limits = fs::read_to_string(format!("/proc/{pid}/limits")).expect("sidecar limits");
    assert!(
        limits.lines().any(|line| {
            line.strip_prefix("Max core file size")
                .is_some_and(|values| values.split_ascii_whitespace().take(2).eq(["0", "0"]))
        }),
        "{limits}"
    );

    if let Some(key) = key {
        drop(socket);
        let status = child.0.wait().expect("sidecar exit after protocol close");
        assert!(status.success(), "{key} sidecar exit: {status}");
        println!("LAUNCHER_CONFINED {key}");
        return;
    }

    if mode == "identity" {
        let run = support::run_frame(
            "launcher-loop",
            Tier::Core,
            "export default () => { while (true) {} }",
            Value::Null,
            Limits {
                cpu_ms: 60_000,
                ..support::limits()
            },
        );
        socket
            .write_all(&protocol::frame(&protocol::encode_inbound(&run)))
            .expect("send unending execution");
        thread::sleep(Duration::from_millis(50));

        let arbitrary = Command::new("/bin/sleep")
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn backend-owned non-sidecar child");
        let arbitrary_pid = arbitrary.id();
        let rejected = Command::new(LAUNCHER)
            .args(["terminate", &arbitrary_pid.to_string()])
            .env_clear()
            .output()
            .expect("reject non-sidecar child");
        assert!(!rejected.status.success());
        assert!(
            String::from_utf8_lossy(&rejected.stderr)
                .contains("target has no trusted launcher attestation"),
            "{}",
            String::from_utf8_lossy(&rejected.stderr)
        );
        let mut arbitrary = arbitrary;
        assert!(
            arbitrary
                .try_wait()
                .expect("check non-sidecar child")
                .is_none()
        );
        arbitrary.kill().ok();
        arbitrary.wait().ok();

        let foreign = Command::new(std::env::current_exe().expect("test binary"))
            .args([
                "--exact",
                "launcher_foreign_parent_probe_child",
                "--nocapture",
            ])
            .env_clear()
            .env(PROBE, "foreign")
            .env(TARGET_PID, pid.to_string())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .uid(BACKEND_UID)
            .gid(BACKEND_UID)
            .output()
            .expect("spawn foreign-parent probe");
        assert!(
            foreign.status.success(),
            "{}",
            String::from_utf8_lossy(&foreign.stderr)
        );
        assert!(String::from_utf8_lossy(&foreign.stdout).contains("FOREIGN_PARENT_REJECTED"));
        assert!(
            child
                .0
                .try_wait()
                .expect("check after foreign-parent request")
                .is_none(),
            "foreign caller terminated the sidecar"
        );
    }

    if mode == "identity" {
        println!("LAUNCHER_READY {pid}");
        std::io::stdout().flush().expect("flush launcher readiness");
        for line in std::io::stdin().lock().lines() {
            let line = line.expect("read launcher probe command");
            match line.strip_prefix("try ") {
                Some(key) => {
                    let output = Command::new(LAUNCHER)
                        .args(["terminate", &pid.to_string()])
                        .env_clear()
                        .output()
                        .expect("test attestation rejection");
                    assert!(
                        !output.status.success(),
                        "termination accepted a mismatched attestation"
                    );
                    let message = String::from_utf8_lossy(&output.stderr);
                    let expected = match key {
                        "executable_ino" => "target executable identity",
                        "caller_start" => "target parent identity",
                        "child_start" => "target process identity",
                        other => panic!("unsupported attestation probe {other}"),
                    };
                    assert!(message.contains(expected), "{message}");
                    println!("LAUNCHER_REJECTED {key}");
                    std::io::stdout().flush().expect("flush rejection result");
                }
                None if line == "terminate" => {
                    let output = Command::new(LAUNCHER)
                        .args(["terminate", &pid.to_string()])
                        .env_clear()
                        .output()
                        .expect("terminate own sidecar");
                    assert!(
                        output.status.success(),
                        "{}",
                        String::from_utf8_lossy(&output.stderr)
                    );
                    let status = child.0.wait().expect("wait for SIGKILL");
                    assert_eq!(status.signal(), Some(libc::SIGKILL));
                    println!("LAUNCHER_KILLED");
                    return;
                }
                _ => panic!("unknown launcher probe command {line}"),
            }
        }
        panic!("launcher test controller disconnected");
    }
}

#[test]
fn launcher_foreign_parent_probe_child() {
    if std::env::var(PROBE).ok().as_deref() != Some("foreign") {
        return;
    }
    let pid = std::env::var(TARGET_PID).expect("target PID");
    let output = Command::new(LAUNCHER)
        .args(["terminate", &pid])
        .env_clear()
        .output()
        .expect("run foreign-parent termination request");
    assert!(!output.status.success());
    println!("FOREIGN_PARENT_REJECTED");
}
