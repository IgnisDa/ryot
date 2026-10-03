use std::collections::BTreeMap;

use landlock::{ABI, Access, AccessFs, AccessNet, Ruleset, RulesetAttr, RulesetStatus};
use seccompiler::{
    BpfProgram, SeccompAction, SeccompCmpArgLen, SeccompCmpOp, SeccompCondition, SeccompFilter,
    SeccompRule, TargetArch,
};

const ALLOWED_SYSCALLS: &[i64] = &[
    libc::SYS_brk,
    libc::SYS_clock_gettime,
    libc::SYS_clock_nanosleep,
    libc::SYS_close,
    libc::SYS_epoll_ctl,
    #[cfg(target_arch = "aarch64")]
    libc::SYS_epoll_pwait,
    #[cfg(target_arch = "x86_64")]
    libc::SYS_epoll_wait,
    libc::SYS_exit,
    libc::SYS_exit_group,
    libc::SYS_futex,
    libc::SYS_getpid,
    libc::SYS_getrandom,
    libc::SYS_gettid,
    libc::SYS_madvise,
    libc::SYS_mmap,
    libc::SYS_mprotect,
    libc::SYS_mremap,
    libc::SYS_munmap,
    #[cfg(target_arch = "x86_64")]
    libc::SYS_pkey_alloc,
    #[cfg(target_arch = "x86_64")]
    libc::SYS_pkey_mprotect,
    libc::SYS_pread64,
    libc::SYS_read,
    libc::SYS_recvfrom,
    libc::SYS_rseq,
    libc::SYS_rt_sigaction,
    libc::SYS_rt_sigprocmask,
    libc::SYS_rt_sigreturn,
    libc::SYS_sched_getaffinity,
    libc::SYS_sched_getparam,
    libc::SYS_sched_getscheduler,
    libc::SYS_sendto,
    libc::SYS_set_robust_list,
    libc::SYS_sigaltstack,
    #[cfg(target_arch = "x86_64")]
    libc::SYS_uname,
    libc::SYS_write,
];

fn rule(conditions: &[(u8, SeccompCmpArgLen, SeccompCmpOp, u64)]) -> Result<SeccompRule, String> {
    conditions
        .iter()
        .map(|(argument, length, operation, value)| {
            SeccompCondition::new(*argument, length.clone(), operation.clone(), *value)
        })
        .collect::<Result<Vec<_>, _>>()
        .and_then(SeccompRule::new)
        .map_err(|error| format!("building syscall argument restrictions failed: {error}"))
}

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
    let mut rules = ALLOWED_SYSCALLS
        .iter()
        .map(|syscall| (*syscall, Vec::new()))
        .collect::<BTreeMap<_, _>>();
    let thread_flags = libc::CLONE_VM
        | libc::CLONE_FS
        | libc::CLONE_FILES
        | libc::CLONE_SIGHAND
        | libc::CLONE_THREAD
        | libc::CLONE_SYSVSEM
        | libc::CLONE_SETTLS
        | libc::CLONE_PARENT_SETTID
        | libc::CLONE_CHILD_CLEARTID;
    use SeccompCmpArgLen::{Dword, Qword};
    use SeccompCmpOp::{Eq, MaskedEq};
    rules.insert(
        libc::SYS_clone,
        vec![rule(&[(0, Qword, Eq, thread_flags as u64)])?],
    );
    rules.insert(
        libc::SYS_epoll_create1,
        vec![rule(&[(0, Dword, Eq, libc::EPOLL_CLOEXEC as u64)])?],
    );
    rules.insert(
        libc::SYS_eventfd2,
        vec![rule(&[
            (0, Dword, Eq, 0),
            (
                1,
                Dword,
                Eq,
                (libc::EFD_CLOEXEC | libc::EFD_NONBLOCK) as u64,
            ),
        ])?],
    );
    rules.insert(
        libc::SYS_fcntl,
        vec![rule(&[(1, Dword, Eq, libc::F_DUPFD_CLOEXEC as u64)])?],
    );
    rules.insert(
        libc::SYS_openat,
        vec![rule(&[(
            2,
            Dword,
            MaskedEq(u32::MAX as u64 & !(libc::O_CLOEXEC as u64)),
            libc::O_RDONLY as u64,
        )])?],
    );
    rules.insert(
        libc::SYS_prctl,
        vec![rule(&[(0, Dword, Eq, libc::PR_SET_NAME as u64)])?],
    );
    rules.insert(
        libc::SYS_setpriority,
        vec![rule(&[
            (0, Dword, Eq, libc::PRIO_PROCESS as u64),
            (2, Dword, Eq, 19),
        ])?],
    );
    rules.insert(
        libc::SYS_socketpair,
        vec![rule(&[
            (0, Dword, Eq, libc::AF_UNIX as u64),
            (
                1,
                Dword,
                Eq,
                (libc::SOCK_STREAM | libc::SOCK_CLOEXEC | libc::SOCK_NONBLOCK) as u64,
            ),
            (2, Dword, Eq, 0),
        ])?],
    );
    // SAFETY: getpid has no memory-safety preconditions; all later threads share this process id.
    let pid = unsafe { libc::getpid() };
    rules.insert(libc::SYS_tgkill, vec![rule(&[(0, Dword, Eq, pid as u64)])?]);
    // The filter installed first always rejects clone3 with ENOSYS, including under Docker.
    rules.insert(libc::SYS_clone3, Vec::new());
    let filter: BpfProgram = SeccompFilter::new(
        rules,
        SeccompAction::Errno(libc::EPERM as u32),
        SeccompAction::Allow,
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
    seccompiler::apply_filter(&filter).map_err(|error| format!("seccomp failed: {error}"))?;
    let error = std::fs::File::open("/").err();
    if error.as_ref().and_then(std::io::Error::raw_os_error) != Some(libc::EACCES) {
        return Err(format!("Landlock did not deny a file open: {error:?}"));
    }
    Ok(())
}
