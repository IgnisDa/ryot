#![cfg(target_os = "linux")]

mod support;

use std::collections::BTreeMap;
use std::os::unix::process::CommandExt;
use std::process::Command;

use ryot_sandboxd::protocol::Tier;
use serde_json::{Value, json};

const PROBE: &str = "RYOT_CONFINEMENT_PROBE";

fn errno<T>(result: T, failed: bool) -> Value {
    let _ = result;
    if failed {
        json!(std::io::Error::last_os_error().raw_os_error())
    } else {
        json!("allowed")
    }
}

/// Runs in a child copy of this test binary: applies the sidecar's confinement, then reports
/// which operations the kernel still allows.
#[test]
fn confinement_probe_child() {
    if std::env::var_os(PROBE).is_none() {
        return;
    }
    ryot_sandboxd::confine::harden_process().expect("harden");
    ryot_sandboxd::confine::lock_down().expect("lock down");
    let mut report = BTreeMap::new();
    // SAFETY: every call below only passes valid pointers or null to the kernel.
    unsafe {
        let path = c"/etc/hostname";
        let fd = libc::open(path.as_ptr(), libc::O_RDONLY);
        report.insert("open", errno(fd, fd < 0));
        let fd = libc::socket(libc::AF_INET, libc::SOCK_STREAM, 0);
        report.insert("socket", errno(fd, fd < 0));
        let program = c"/bin/true";
        let argv = [program.as_ptr(), std::ptr::null()];
        let envp = [std::ptr::null()];
        let result = libc::execve(program.as_ptr(), argv.as_ptr(), envp.as_ptr());
        report.insert("execve", errno(result, result < 0));
        let result = libc::ptrace(libc::PTRACE_TRACEME, 0, 0, 0);
        report.insert("ptrace", errno(result, result < 0));
        let mut buffer = [0_u8; 8];
        let local = libc::iovec {
            iov_base: buffer.as_mut_ptr().cast(),
            iov_len: buffer.len(),
        };
        let remote = libc::iovec {
            iov_base: buffer.as_mut_ptr().cast(),
            iov_len: buffer.len(),
        };
        let result = libc::process_vm_readv(libc::getpid(), &local, 1, &remote, 1, 0);
        report.insert("process_vm_readv", errno(result, result < 0));
        for (name, syscall) in [
            ("userfaultfd", libc::SYS_userfaultfd),
            ("io_uring_setup", libc::SYS_io_uring_setup),
            ("bpf", libc::SYS_bpf),
            ("perf_event_open", libc::SYS_perf_event_open),
        ] {
            let result = libc::syscall(syscall, 0, 0, 0, 0, 0);
            report.insert(name, errno(result, result < 0));
        }
        let result = libc::mount(
            c"none".as_ptr(),
            c"/tmp".as_ptr(),
            c"tmpfs".as_ptr(),
            0,
            std::ptr::null(),
        );
        report.insert("mount", errno(result, result < 0));
        let result = libc::unshare(libc::CLONE_NEWUSER);
        report.insert("unshare", errno(result, result < 0));
        for (name, flags) in [
            ("clone_newcgroup", libc::CLONE_NEWCGROUP),
            ("clone_newipc", libc::CLONE_NEWIPC),
            ("clone_newnet", libc::CLONE_NEWNET),
            ("clone_newns", libc::CLONE_NEWNS),
            ("clone_newpid", libc::CLONE_NEWPID),
            ("clone_newtime", libc::CLONE_NEWTIME),
            ("clone_newuser", libc::CLONE_NEWUSER),
            ("clone_newuts", libc::CLONE_NEWUTS),
        ] {
            let result = libc::syscall(libc::SYS_clone, flags, 0, 0, 0, 0);
            if result == 0 {
                libc::_exit(99);
            }
            report.insert(name, errno(result, result < 0));
        }
        let result = libc::syscall(libc::SYS_clone3, std::ptr::null::<u8>(), 0);
        report.insert("clone3", errno(result, result < 0));
        #[cfg(target_arch = "x86_64")]
        for (name, syscall) in [
            ("x32_getpid", libc::SYS_getpid),
            ("x32_ptrace", 521),
            ("x32_unknown", 0x12345),
        ] {
            let result = libc::syscall(syscall | 0x40000000, 0, 0, 0, 0, 0);
            report.insert(name, errno(result, result < 0));
        }
        report.insert(
            "no_new_privs",
            json!(libc::prctl(libc::PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0)),
        );
        report.insert(
            "dumpable",
            json!(libc::prctl(libc::PR_GET_DUMPABLE, 0, 0, 0, 0)),
        );
        let mut core = libc::rlimit {
            rlim_cur: 1,
            rlim_max: 1,
        };
        libc::getrlimit(libc::RLIMIT_CORE, &mut core);
        report.insert("core_limit", json!(core.rlim_max));
    }
    println!("REPORT {}", serde_json::to_string(&report).expect("report"));
}

#[test]
fn confinement_denies_files_sockets_and_dangerous_syscalls() {
    let output = Command::new(std::env::current_exe().expect("test binary"))
        .args([
            "--exact",
            "confinement_probe_child",
            "--nocapture",
            "--test-threads",
            "1",
        ])
        .env(PROBE, "1")
        .output()
        .expect("probe");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let report: Value = stdout
        .lines()
        .find_map(|line| line.split_once("REPORT ").map(|(_, json)| json))
        .map(|json| serde_json::from_str(json).expect("report"))
        .unwrap_or_else(|| {
            panic!(
                "probe produced no report: {stdout} {}",
                String::from_utf8_lossy(&output.stderr)
            )
        });
    assert_eq!(
        report["open"],
        json!(libc::EACCES),
        "Landlock must deny file opens: {report}"
    );
    for denied in [
        "socket",
        "execve",
        "ptrace",
        "process_vm_readv",
        "userfaultfd",
        "io_uring_setup",
        "bpf",
        "perf_event_open",
        "mount",
        "unshare",
        "clone_newcgroup",
        "clone_newipc",
        "clone_newnet",
        "clone_newns",
        "clone_newpid",
        "clone_newtime",
        "clone_newuser",
        "clone_newuts",
    ] {
        assert_eq!(report[denied], json!(libc::EPERM), "{denied}: {report}");
    }
    assert_eq!(report["clone3"], json!(libc::ENOSYS));
    #[cfg(target_arch = "x86_64")]
    for denied in ["x32_getpid", "x32_ptrace", "x32_unknown"] {
        assert_eq!(report[denied], json!(libc::EPERM), "{denied}: {report}");
    }
    assert_eq!(report["no_new_privs"], json!(1));
    assert_eq!(report["dumpable"], json!(0));
    assert_eq!(report["core_limit"], json!(0));
}

#[test]
fn the_sidecar_serves_while_confined_with_an_empty_environment() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    let status =
        std::fs::read_to_string(format!("/proc/{}/status", sidecar.pid())).expect("status");
    assert!(
        status.lines().any(|line| line == "NoNewPrivs:\t1"),
        "{status}"
    );
    assert!(status.lines().any(|line| line == "Seccomp:\t2"), "{status}");
    match std::fs::read(format!("/proc/{}/environ", sidecar.pid())) {
        Ok(environ) => assert!(environ.is_empty()),
        Err(error) => assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied),
    }
    assert_eq!(
        sidecar
            .execute(Tier::Core, "export default () => 'confined'", Value::Null)
            .value(),
        json!("confined")
    );

    let output = support::command(Tier::Core, &[])
        .env("LEAKED", "secret")
        .output()
        .expect("sidecar");
    assert_eq!(output.status.code(), Some(71));
    assert!(String::from_utf8_lossy(&output.stderr).contains("environment must be empty"));
}

#[test]
fn startup_fails_when_confinement_cannot_be_applied() {
    let rules = BTreeMap::from([(libc::SYS_landlock_create_ruleset, Vec::new())]);
    let filter: seccompiler::BpfProgram = seccompiler::SeccompFilter::new(
        rules,
        seccompiler::SeccompAction::Allow,
        seccompiler::SeccompAction::Errno(libc::ENOSYS as u32),
        if cfg!(target_arch = "x86_64") {
            seccompiler::TargetArch::x86_64
        } else {
            seccompiler::TargetArch::aarch64
        },
    )
    .and_then(TryInto::try_into)
    .expect("filter");
    let mut command = support::command(Tier::Core, &[]);
    // SAFETY: prctl and seccomp only install a filter in the forked child before exec.
    unsafe {
        command.pre_exec(move || {
            if libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            seccompiler::apply_filter(&filter).map_err(std::io::Error::other)
        });
    }
    let (_ours, theirs) = std::os::unix::net::UnixStream::pair().expect("socketpair");
    let fd = std::os::fd::AsRawFd::as_raw_fd(&theirs);
    // SAFETY: dup2 only rewires the child's descriptor table.
    unsafe {
        command.pre_exec(move || {
            if libc::dup2(fd, 3) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let output = command.output().expect("sidecar");
    assert_eq!(
        output.status.code(),
        Some(71),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stderr).contains("Landlock"));
}

#[test]
fn landlock_is_verified_inside_the_running_sidecar() {
    let mut sidecar = support::spawn(Tier::Core, &[]);
    assert_eq!(
        sidecar
            .execute(Tier::Core, "export default () => 'landlocked'", Value::Null)
            .value(),
        json!("landlocked")
    );
    let filter: seccompiler::BpfProgram = seccompiler::SeccompFilter::new(
        BTreeMap::from([(libc::SYS_landlock_restrict_self, Vec::new())]),
        seccompiler::SeccompAction::Allow,
        seccompiler::SeccompAction::Errno(0),
        if cfg!(target_arch = "x86_64") {
            seccompiler::TargetArch::x86_64
        } else {
            seccompiler::TargetArch::aarch64
        },
    )
    .and_then(TryInto::try_into)
    .expect("filter");
    let mut command = support::command(Tier::Core, &[]);
    let (_ours, theirs) = std::os::unix::net::UnixStream::pair().expect("socketpair");
    let fd = std::os::fd::AsRawFd::as_raw_fd(&theirs);
    // SAFETY: only descriptor rewiring and seccomp installation run in the child before exec.
    unsafe {
        command.pre_exec(move || {
            if libc::dup2(fd, 3) < 0 || libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            seccompiler::apply_filter(&filter).map_err(std::io::Error::other)
        });
    }
    let output = command.output().expect("sidecar");
    assert_eq!(output.status.code(), Some(71));
    assert!(String::from_utf8_lossy(&output.stderr).contains("Landlock did not deny a file open"));
}
