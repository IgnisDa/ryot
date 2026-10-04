#![cfg(target_os = "linux")]

mod support;

use std::collections::BTreeMap;
use std::os::unix::process::{CommandExt, ExitStatusExt};
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

#[test]
fn confinement_probe_child() {
    if std::env::var_os(PROBE).is_none() {
        return;
    }
    ryot_sandboxd::confine::harden_process().expect("harden");
    let mut report = BTreeMap::new();
    // SAFETY: these read-only queries inspect hardening before the syscall policy blocks them.
    unsafe {
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
        assert_eq!(libc::getrlimit(libc::RLIMIT_CORE, &mut core), 0);
        report.insert("core_limit", json!(core.rlim_max));
    }
    ryot_sandboxd::confine::lock_down().expect("lock down");
    if std::env::var(PROBE).as_deref() == Ok("abort") {
        std::process::abort();
    }
    let thread = std::thread::Builder::new()
        .name("seccomp-probe".to_owned())
        .spawn(|| {
            // SAFETY: these calls have no pointer arguments.
            unsafe {
                let result = libc::syscall(0x12345, 0, 0, 0, 0, 0, 0);
                (libc::gettid(), errno(result, result < 0))
            }
        })
        .expect("confined thread")
        .join()
        .expect("thread result");
    // SAFETY: gettid has no memory-safety preconditions.
    report.insert(
        "thread_created",
        json!(thread.0 != unsafe { libc::gettid() }),
    );
    report.insert("thread_unknown", thread.1);
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
        let result = libc::process_vm_writev(libc::getpid(), &local, 1, &remote, 1, 0);
        report.insert("process_vm_writev", errno(result, result < 0));
        let result = libc::syscall(0x12345, 0, 0, 0, 0, 0, 0);
        report.insert("unknown", errno(result, result < 0));
        let result = libc::prctl(libc::PR_SET_DUMPABLE, 1, 0, 0, 0);
        report.insert("enable_dumping", errno(result, result < 0));
        let result = libc::syscall(libc::SYS_tgkill, libc::getpid() + 1, 0, 0);
        report.insert("foreign_signal", errno(result, result < 0));
        for (name, which, nice) in [
            ("setpriority_stale_nice", libc::PRIO_PROCESS, 10),
            ("setpriority_out_of_range_nice", libc::PRIO_PROCESS, 20),
            ("setpriority_user", libc::PRIO_USER, 19),
            ("setpriority_background_nice", libc::PRIO_PROCESS, 19),
        ] {
            let result = libc::syscall(libc::SYS_setpriority, which, 0, nice);
            report.insert(name, errno(result, result < 0));
        }
        let result = libc::open(path.as_ptr(), libc::O_WRONLY | libc::O_CREAT, 0o600);
        report.insert("open_write", errno(result, result < 0));
        let result = libc::open(path.as_ptr(), libc::O_PATH);
        report.insert("open_path", errno(result, result < 0));
        let thread_flags = libc::CLONE_VM
            | libc::CLONE_FS
            | libc::CLONE_FILES
            | libc::CLONE_SIGHAND
            | libc::CLONE_THREAD
            | libc::CLONE_SYSVSEM
            | libc::CLONE_SETTLS
            | libc::CLONE_PARENT_SETTID
            | libc::CLONE_CHILD_CLEARTID;
        for (name, flags) in [
            ("clone_process", libc::SIGCHLD as u64),
            ("clone_no_vm", (thread_flags & !libc::CLONE_VM) as u64),
            (
                "clone_no_sighand",
                (thread_flags & !libc::CLONE_SIGHAND) as u64,
            ),
            (
                "clone_no_thread",
                (thread_flags & !libc::CLONE_THREAD) as u64,
            ),
            ("clone_parent", (thread_flags | libc::CLONE_PARENT) as u64),
            ("clone_vfork", (thread_flags | libc::CLONE_VFORK) as u64),
            ("clone_signal", (thread_flags | libc::SIGCHLD) as u64),
            ("clone_high_flag", thread_flags as u64 | (1_u64 << 32)),
        ] {
            let result = libc::syscall(libc::SYS_clone, flags, 0, 0, 0, 0);
            if result == 0 {
                libc::_exit(99);
            }
            report.insert(name, errno(result, result < 0));
        }
        for (name, syscall) in [
            ("getppid", libc::SYS_getppid),
            ("execveat", libc::SYS_execveat),
            ("userfaultfd", libc::SYS_userfaultfd),
            ("io_uring_setup", libc::SYS_io_uring_setup),
            ("io_uring_enter", libc::SYS_io_uring_enter),
            ("io_uring_register", libc::SYS_io_uring_register),
            ("bpf", libc::SYS_bpf),
            ("perf_event_open", libc::SYS_perf_event_open),
            ("umount2", libc::SYS_umount2),
            ("setns", libc::SYS_setns),
            ("pivot_root", libc::SYS_pivot_root),
            ("kexec_load", libc::SYS_kexec_load),
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
            let result = libc::syscall(libc::SYS_clone, thread_flags | flags, 0, 0, 0, 0);
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
    assert!(
        output.status.success(),
        "{stdout} {}",
        String::from_utf8_lossy(&output.stderr)
    );
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
        "process_vm_writev",
        "unknown",
        "thread_unknown",
        "enable_dumping",
        "foreign_signal",
        "open_write",
        "open_path",
        "setpriority_stale_nice",
        "setpriority_out_of_range_nice",
        "setpriority_user",
        "clone_process",
        "clone_no_vm",
        "clone_no_sighand",
        "clone_no_thread",
        "clone_parent",
        "clone_vfork",
        "clone_signal",
        "clone_high_flag",
        "userfaultfd",
        "getppid",
        "execveat",
        "io_uring_setup",
        "io_uring_enter",
        "io_uring_register",
        "bpf",
        "perf_event_open",
        "mount",
        "umount2",
        "setns",
        "pivot_root",
        "kexec_load",
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
    assert_eq!(report["setpriority_background_nice"], json!("allowed"));
    assert_eq!(report["thread_created"], json!(true));
    #[cfg(target_arch = "x86_64")]
    for denied in ["x32_getpid", "x32_ptrace", "x32_unknown"] {
        assert_eq!(report[denied], json!(libc::EPERM), "{denied}: {report}");
    }
    assert_eq!(report["no_new_privs"], json!(1));
    assert_eq!(report["dumpable"], json!(0));
    assert_eq!(report["core_limit"], json!(0));
}

#[test]
fn confined_abort_delivers_its_signal_without_a_core_dump() {
    let output = Command::new(std::env::current_exe().expect("test binary"))
        .args(["--exact", "confinement_probe_child", "--test-threads", "1"])
        .env(PROBE, "abort")
        .output()
        .expect("abort probe");
    assert_eq!(output.status.signal(), Some(libc::SIGABRT));
    assert!(!output.status.core_dumped());
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
    for (syscall, diagnostic) in [
        (libc::SYS_landlock_create_ruleset, "Landlock"),
        (libc::SYS_seccomp, "seccomp"),
    ] {
        let rules = BTreeMap::from([(syscall, Vec::new())]);
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
        assert!(String::from_utf8_lossy(&output.stderr).contains(diagnostic));
    }
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
