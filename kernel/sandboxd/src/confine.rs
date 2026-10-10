use std::collections::BTreeMap;

use landlock::{ABI, Access, AccessFs, AccessNet, Ruleset, RulesetAttr, RulesetStatus};
use seccompiler::{
    BpfProgram, SeccompAction, SeccompCmpArgLen, SeccompCmpOp, SeccompCondition, SeccompFilter,
    SeccompRule, TargetArch,
};

pub const DENIED_SYSCALLS: [i64; 18] = [
    libc::SYS_socket,
    libc::SYS_execve,
    libc::SYS_execveat,
    libc::SYS_ptrace,
    libc::SYS_process_vm_readv,
    libc::SYS_process_vm_writev,
    libc::SYS_userfaultfd,
    libc::SYS_io_uring_setup,
    libc::SYS_io_uring_enter,
    libc::SYS_io_uring_register,
    libc::SYS_bpf,
    libc::SYS_perf_event_open,
    libc::SYS_mount,
    libc::SYS_umount2,
    libc::SYS_unshare,
    libc::SYS_setns,
    libc::SYS_pivot_root,
    libc::SYS_kexec_load,
];

fn prctl(option: libc::c_int, value: libc::c_ulong) -> Result<(), String> {
    // SAFETY: the options used here take integer arguments only.
    if unsafe { libc::prctl(option, value, 0, 0, 0) } == 0 {
        Ok(())
    } else {
        Err(format!(
            "prctl({option}) failed: {}",
            std::io::Error::last_os_error()
        ))
    }
}

/// Applies process hardening that does not depend on loaded state; must run before any thread starts.
pub fn harden_process() -> Result<(), String> {
    prctl(libc::PR_SET_NO_NEW_PRIVS, 1)?;
    prctl(libc::PR_SET_DUMPABLE, 0)?;
    let limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    // SAFETY: limit is a valid rlimit value.
    if unsafe { libc::setrlimit(libc::RLIMIT_CORE, &limit) } != 0 {
        return Err(format!(
            "disabling core dumps failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    // SAFETY: closing descriptors above the inherited socket has no memory-safety preconditions.
    if unsafe { libc::syscall(libc::SYS_close_range, 4_u32, u32::MAX, 0_u32) } != 0 {
        return Err(format!(
            "closing inherited descriptors failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

/// Denies all filesystem and network access, then installs the syscall filter. Runs on the
/// still single-threaded process so every later thread inherits both.
pub fn lock_down() -> Result<(), String> {
    let status = Ruleset::default()
        .handle_access(AccessFs::from_all(ABI::V5))
        .and_then(|ruleset| ruleset.handle_access(AccessNet::from_all(ABI::V5)))
        .and_then(|ruleset| ruleset.create())
        .and_then(|ruleset| ruleset.restrict_self())
        .map_err(|error| format!("Landlock failed: {error}"))?;
    if status.ruleset == RulesetStatus::NotEnforced {
        return Err("Landlock is not supported by this kernel".to_owned());
    }

    let arch = if cfg!(target_arch = "x86_64") {
        TargetArch::x86_64
    } else {
        TargetArch::aarch64
    };
    let mut rules = DENIED_SYSCALLS
        .iter()
        .map(|syscall| (*syscall, Vec::new()))
        .collect::<BTreeMap<_, _>>();
    let namespace_flags = libc::CLONE_NEWCGROUP
        | libc::CLONE_NEWIPC
        | libc::CLONE_NEWNET
        | libc::CLONE_NEWNS
        | libc::CLONE_NEWPID
        | libc::CLONE_NEWTIME
        | libc::CLONE_NEWUSER
        | libc::CLONE_NEWUTS;
    let clone_rules = (0..32)
        .map(|bit| 1_u64 << bit)
        .filter(|flag| flag & namespace_flags as u64 != 0)
        .map(|flag| {
            SeccompCondition::new(
                0,
                SeccompCmpArgLen::Dword,
                SeccompCmpOp::MaskedEq(flag),
                flag,
            )
            .and_then(|condition| SeccompRule::new(vec![condition]))
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("building clone rules failed: {error}"))?;
    rules.insert(libc::SYS_clone, clone_rules);
    let filter: BpfProgram = SeccompFilter::new(
        rules,
        SeccompAction::Allow,
        SeccompAction::Errno(libc::EPERM as u32),
        arch,
    )
    .and_then(TryInto::try_into)
    .map_err(|error| format!("building the seccomp filter failed: {error}"))?;
    #[cfg(target_arch = "x86_64")]
    let filter = {
        let mut filter = filter;
        let mut x32 = vec![
            seccompiler::sock_filter {
                code: (libc::BPF_LD | libc::BPF_W | libc::BPF_ABS) as u16,
                jt: 0,
                jf: 0,
                k: 0,
            },
            seccompiler::sock_filter {
                code: (libc::BPF_JMP | libc::BPF_JSET | libc::BPF_K) as u16,
                jt: 0,
                jf: 1,
                k: 0x40000000,
            },
            seccompiler::sock_filter {
                code: (libc::BPF_RET | libc::BPF_K) as u16,
                jt: 0,
                jf: 0,
                k: libc::SECCOMP_RET_ERRNO | libc::EPERM as u32,
            },
        ];
        x32.append(&mut filter);
        x32
    };
    seccompiler::apply_filter(&filter).map_err(|error| format!("seccomp failed: {error}"))?;
    // glibc retries pthread creation with clone only when clone3 returns ENOSYS.
    let clone3: BpfProgram = SeccompFilter::new(
        BTreeMap::from([(libc::SYS_clone3, Vec::new())]),
        SeccompAction::Allow,
        SeccompAction::Errno(libc::ENOSYS as u32),
        arch,
    )
    .and_then(TryInto::try_into)
    .map_err(|error| format!("building the clone3 filter failed: {error}"))?;
    seccompiler::apply_filter(&clone3).map_err(|error| format!("seccomp failed: {error}"))?;
    let error = std::fs::File::open("/").err();
    if error.as_ref().and_then(std::io::Error::raw_os_error) != Some(libc::EACCES) {
        return Err(format!("Landlock did not deny a file open: {error:?}"));
    }
    Ok(())
}
