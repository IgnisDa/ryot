#[cfg(target_os = "linux")]
mod linux {
    use std::convert::Infallible;
    use std::ffi::{CStr, CString};
    use std::io;
    use std::os::fd::{AsRawFd, FromRawFd, IntoRawFd, OwnedFd, RawFd};

    const BACKEND_UID: libc::uid_t = 1001;
    const SIDECAR_UID: libc::uid_t = 1002;
    const SIDECAR_GID: libc::gid_t = 1002;
    const SOCKET_FD: RawFd = 3;
    const EXECUTABLE_FD: RawFd = 4;
    const ATTESTATION_FD: RawFd = 5;
    const MAX_ARGUMENTS: usize = 17;
    const MAX_ARGUMENT_BYTES: usize = 64;
    const MAX_RECORD_BYTES: usize = 256;
    const MAX_RECORDS: usize = 4096;
    const MAX_EXECUTIONS: &str = "10000";
    const GRACE_MS: &str = "2000";
    const EXECUTABLE_PATH: &CStr = c"/home/ryot/sandboxd/ryot-sandboxd";
    const SNAPSHOT_PATH: &CStr = c"/home/ryot/sandboxd/snapshots";
    const LAUNCHER_PATH: &CStr = c"/usr/local/libexec/ryot-sandbox-launcher";
    const ATTESTATION_PATH: &CStr = c"/run/ryot-sandboxd";
    const SNAPSHOT_FILES: [&CStr; 3] = [c"core.snap", c"data.snap", c"full.snap"];
    const LAUNCH_FLAGS: [&str; 8] = [
        "--generation",
        "--tier",
        "--trust",
        "--threads",
        "--queue",
        "--max-active",
        "--memory-budget",
        "--max-rss",
    ];

    struct LaunchConfig {
        generation: u32,
        tier: String,
        trust: String,
        threads: usize,
        queue: usize,
        max_active: usize,
        memory_budget: u64,
        max_rss: u64,
    }

    struct Attestation {
        caller_pid: libc::pid_t,
        caller_start: u64,
        child_pid: libc::pid_t,
        child_start: u64,
        executable_dev: libc::dev_t,
        executable_ino: libc::ino_t,
    }

    struct StoredAttestation {
        value: Attestation,
        device: libc::dev_t,
        inode: libc::ino_t,
    }

    struct ProcessStat {
        state: u8,
        parent: libc::pid_t,
        start: u64,
    }

    struct ProcessInfo {
        stat: ProcessStat,
        uids: [u32; 4],
        gids: [u32; 4],
    }

    /// Only a process whose proc entry no longer exists is gone; every other failure to read or
    /// parse its identity is an error.
    enum ProcessError {
        Gone(String),
        Failed(String),
    }

    impl ProcessError {
        fn message(self) -> String {
            match self {
                Self::Gone(message) | Self::Failed(message) => message,
            }
        }
    }

    impl From<String> for ProcessError {
        fn from(message: String) -> Self {
            Self::Failed(message)
        }
    }

    enum Permissions {
        Exact(&'static [libc::mode_t]),
        Without(libc::mode_t),
    }

    enum DecimalError {
        Invalid,
        Overflow,
    }

    struct DirectoryLock {
        _fd: OwnedFd,
    }

    struct DirGuard(*mut libc::DIR);

    impl Drop for DirGuard {
        fn drop(&mut self) {
            // SAFETY: the stream came from a successful fdopendir and is closed exactly once.
            unsafe { libc::closedir(self.0) };
        }
    }

    fn last_error(context: &str) -> String {
        format!("{context}: {}", io::Error::last_os_error())
    }

    fn owned_fd(fd: RawFd, context: &str) -> Result<OwnedFd, String> {
        if fd < 0 {
            return Err(last_error(context));
        }
        // SAFETY: the successful syscall returned a new file descriptor owned by this process.
        Ok(unsafe { OwnedFd::from_raw_fd(fd) })
    }

    fn duplicate_above_slots(fd: RawFd, context: &str) -> Result<OwnedFd, String> {
        // SAFETY: F_DUPFD_CLOEXEC returns a fresh descriptor above the fixed launcher slots.
        owned_fd(
            unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 6) },
            context,
        )
    }

    fn fstat(fd: RawFd, context: &str) -> Result<libc::stat, String> {
        // SAFETY: fstat writes to the valid output structure.
        let mut stat = unsafe { std::mem::zeroed::<libc::stat>() };
        // SAFETY: stat points to writable memory and fd is checked by the caller.
        if unsafe { libc::fstat(fd, &mut stat) } != 0 {
            return Err(last_error(context));
        }
        Ok(stat)
    }

    fn stat_matches(
        stat: &libc::stat,
        uid: libc::uid_t,
        gid: Option<libc::gid_t>,
        kind: libc::mode_t,
        permissions: Permissions,
        links: Option<libc::nlink_t>,
    ) -> bool {
        stat.st_uid == uid
            && gid.is_none_or(|gid| stat.st_gid == gid)
            && stat.st_mode & libc::S_IFMT == kind
            && match permissions {
                Permissions::Exact(modes) => modes.contains(&(stat.st_mode & 0o7777)),
                Permissions::Without(mask) => stat.st_mode & mask == 0,
            }
            && links.is_none_or(|links| stat.st_nlink == links)
    }

    fn validate_directory(fd: RawFd, context: &str) -> Result<(), String> {
        let stat = fstat(fd, context)?;
        if !stat_matches(
            &stat,
            0,
            Some(0),
            libc::S_IFDIR,
            Permissions::Without(0o022),
            None,
        ) {
            return Err(format!(
                "{context} must be a root-owned, non-writable directory"
            ));
        }
        Ok(())
    }

    fn validate_private_directory(fd: RawFd) -> Result<(), String> {
        let stat = fstat(fd, "attestation directory")?;
        if !stat_matches(
            &stat,
            0,
            Some(0),
            libc::S_IFDIR,
            Permissions::Exact(&[0o700, 0o750]),
            None,
        ) {
            return Err(
                "attestation directory must be root-owned and private (0700 or 0750)".to_owned(),
            );
        }
        Ok(())
    }

    fn validate_regular(fd: RawFd, context: &str) -> Result<libc::stat, String> {
        let stat = fstat(fd, context)?;
        if !stat_matches(
            &stat,
            0,
            None,
            libc::S_IFREG,
            Permissions::Without(0o022),
            Some(1),
        ) {
            return Err(format!(
                "{context} must be a root-owned, non-writable regular file"
            ));
        }
        Ok(stat)
    }

    fn open_absolute(path: &CStr, final_flags: libc::c_int) -> Result<OwnedFd, String> {
        let mut directory = owned_fd(
            // SAFETY: the path is a static absolute C string.
            unsafe {
                libc::open(
                    c"/".as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
                )
            },
            "open root directory",
        )?;
        validate_directory(directory.as_raw_fd(), "root directory")?;
        let components = path
            .to_bytes()
            .split(|byte| *byte == b'/')
            .filter(|component| !component.is_empty())
            .collect::<Vec<_>>();
        for (index, component) in components.iter().enumerate() {
            let name = CString::new(*component).map_err(|_| "invalid trusted path component")?;
            let final_component = index + 1 == components.len();
            let flags = if final_component {
                final_flags | libc::O_CLOEXEC | libc::O_NOFOLLOW
            } else {
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW
            };
            // SAFETY: directory is an open directory and name is a nul-terminated component.
            let next = owned_fd(
                unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags) },
                "open trusted path component",
            )?;
            if !final_component {
                validate_directory(next.as_raw_fd(), "trusted path ancestor")?;
            }
            directory = next;
        }
        Ok(directory)
    }

    fn verify_launcher() -> Result<(), String> {
        let launcher = open_absolute(LAUNCHER_PATH, libc::O_PATH)?;
        let stat = validate_regular(launcher.as_raw_fd(), "installed launcher")?;
        if stat.st_mode & 0o7777 != 0o4755 {
            return Err("installed launcher must have mode 04755".to_owned());
        }
        // SAFETY: stat writes to a valid structure and the proc path is a static C string.
        let mut running = unsafe { std::mem::zeroed::<libc::stat>() };
        if unsafe { libc::stat(c"/proc/self/exe".as_ptr(), &mut running) } != 0 {
            return Err(last_error("inspect running launcher"));
        }
        if running.st_dev != stat.st_dev || running.st_ino != stat.st_ino {
            return Err("running launcher is not the trusted installed launcher".to_owned());
        }
        Ok(())
    }

    fn validate_snapshots() -> Result<(), String> {
        let snapshots = open_absolute(SNAPSHOT_PATH, libc::O_RDONLY | libc::O_DIRECTORY)?;
        validate_directory(snapshots.as_raw_fd(), "snapshot directory")?;
        for name in SNAPSHOT_FILES {
            // SAFETY: snapshots is an open directory and name is a static component.
            let file = owned_fd(
                unsafe {
                    libc::openat(
                        snapshots.as_raw_fd(),
                        name.as_ptr(),
                        libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                    )
                },
                "open trusted snapshot",
            )?;
            validate_regular(file.as_raw_fd(), "installed snapshot")?;
        }
        Ok(())
    }

    fn sidecar_identity() -> Result<(OwnedFd, (libc::dev_t, libc::ino_t)), String> {
        let executable = open_absolute(EXECUTABLE_PATH, libc::O_PATH)?;
        let stat = validate_regular(executable.as_raw_fd(), "installed sidecar")?;
        if stat.st_mode & 0o100 == 0 {
            return Err("installed sidecar is not executable by its owner".to_owned());
        }
        Ok((executable, (stat.st_dev, stat.st_ino)))
    }

    fn credentials() -> Result<([libc::uid_t; 3], [libc::gid_t; 3]), String> {
        // SAFETY: each call writes exactly three credentials to valid pointers.
        let mut uids = [0; 3];
        let mut gids = [0; 3];
        if unsafe { libc::getresuid(&mut uids[0], &mut uids[1], &mut uids[2]) } != 0 {
            return Err(last_error("read UID credentials"));
        }
        // SAFETY: gids points to three writable credential values.
        if unsafe { libc::getresgid(&mut gids[0], &mut gids[1], &mut gids[2]) } != 0 {
            return Err(last_error("read GID credentials"));
        }
        Ok((uids, gids))
    }

    fn validate_privileged_caller() -> Result<libc::pid_t, String> {
        // SAFETY: PR_GET_NO_NEW_PRIVS takes no pointer arguments.
        let no_new_privs = unsafe { libc::prctl(libc::PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) };
        if no_new_privs != 0 {
            return Err("launcher cannot run with no_new_privs enabled".to_owned());
        }
        let (uids, _) = credentials()?;
        if uids != [BACKEND_UID, 0, 0] {
            return Err(
                "launcher requires real UID 1001 and effective/saved root; install it setuid root"
                    .to_owned(),
            );
        }
        let parent = unsafe { libc::getppid() };
        if parent <= 0 {
            return Err("launcher has no valid backend parent".to_owned());
        }
        Ok(parent)
    }

    fn clear_environment() -> Result<(), String> {
        // SAFETY: clearenv takes no pointers and removes all inherited variables.
        if unsafe { libc::clearenv() } != 0 {
            return Err(last_error("clear launcher environment"));
        }
        Ok(())
    }

    fn decimal(text: &[u8]) -> Result<u64, DecimalError> {
        if text.is_empty() || !text.iter().all(u8::is_ascii_digit) {
            return Err(DecimalError::Invalid);
        }
        text.iter()
            .try_fold(0_u64, |value, digit| {
                value.checked_mul(10)?.checked_add(u64::from(digit - b'0'))
            })
            .ok_or(DecimalError::Overflow)
    }

    fn positive_u64(value: &str, flag: &str) -> Result<u64, String> {
        match decimal(value.as_bytes()) {
            Err(DecimalError::Invalid) => {
                Err(format!("{flag} requires a positive decimal integer"))
            }
            Err(DecimalError::Overflow) => Err(format!("{flag} is out of range")),
            Ok(0) => Err(format!("{flag} must be positive")),
            Ok(parsed) => Ok(parsed),
        }
    }

    fn parse_launch(args: &[String]) -> Result<LaunchConfig, String> {
        if args.len() != MAX_ARGUMENTS || args.first().map(String::as_str) != Some("launch") {
            return Err("usage: launch --generation n --tier core|data|full --trust system|user --threads n --queue n --max-active n --memory-budget n --max-rss n".to_owned());
        }
        let mut values = std::collections::HashMap::with_capacity(LAUNCH_FLAGS.len());
        for pair in args[1..].chunks_exact(2) {
            let flag = pair[0].as_str();
            if !LAUNCH_FLAGS.contains(&flag) {
                return Err(format!("unsupported launcher argument {flag:?}"));
            }
            if values.insert(flag, pair[1].as_str()).is_some() {
                return Err(format!("{flag} must appear exactly once"));
            }
        }
        if values.len() != LAUNCH_FLAGS.len() {
            return Err("each launcher argument must appear exactly once".to_owned());
        }
        let get = |flag: &str| {
            values
                .get(flag)
                .copied()
                .ok_or_else(|| format!("{flag} is required"))
        };
        let generation = u32::try_from(positive_u64(get("--generation")?, "--generation")?)
            .map_err(|_| "--generation is out of range".to_owned())?;
        let tier = get("--tier")?;
        if !matches!(tier, "core" | "data" | "full") {
            return Err("--tier must be core, data, or full".to_owned());
        }
        let trust = get("--trust")?;
        if !matches!(trust, "system" | "user") {
            return Err("--trust must be system or user".to_owned());
        }
        let usize_value = |flag: &str| {
            usize::try_from(positive_u64(get(flag)?, flag)?)
                .map_err(|_| format!("{flag} is out of range for this target"))
        };
        Ok(LaunchConfig {
            generation,
            tier: tier.to_owned(),
            trust: trust.to_owned(),
            threads: usize_value("--threads")?,
            queue: usize_value("--queue")?,
            max_active: usize_value("--max-active")?,
            memory_budget: positive_u64(get("--memory-budget")?, "--memory-budget")?,
            max_rss: positive_u64(get("--max-rss")?, "--max-rss")?,
        })
    }

    fn sockopt_int(option: libc::c_int) -> Option<libc::c_int> {
        let mut value: libc::c_int = 0;
        let mut length = std::mem::size_of_val(&value) as libc::socklen_t;
        // SAFETY: getsockopt writes at most length bytes into value.
        let result = unsafe {
            libc::getsockopt(
                SOCKET_FD,
                libc::SOL_SOCKET,
                option,
                (&mut value as *mut libc::c_int).cast(),
                &mut length,
            )
        };
        (result == 0).then_some(value)
    }

    fn check_socket() -> Result<(), String> {
        let stat = fstat(SOCKET_FD, "inspect descriptor 3")?;
        if stat.st_mode & libc::S_IFMT != libc::S_IFSOCK {
            return Err("descriptor 3 must be a connected AF_UNIX stream socket".to_owned());
        }
        if sockopt_int(libc::SO_DOMAIN) != Some(libc::AF_UNIX) {
            return Err("descriptor 3 must use AF_UNIX".to_owned());
        }
        if sockopt_int(libc::SO_TYPE) != Some(libc::SOCK_STREAM) {
            return Err("descriptor 3 must be SOCK_STREAM".to_owned());
        }
        if sockopt_int(libc::SO_ACCEPTCONN) != Some(0) {
            return Err("descriptor 3 must be connected, not listening".to_owned());
        }
        let mut peer = unsafe { std::mem::zeroed::<libc::sockaddr_storage>() };
        let mut peer_length = std::mem::size_of_val(&peer) as libc::socklen_t;
        // SAFETY: peer points to a sockaddr_storage with its size in peer_length.
        if unsafe {
            libc::getpeername(
                SOCKET_FD,
                (&mut peer as *mut libc::sockaddr_storage).cast(),
                &mut peer_length,
            )
        } != 0
            || peer.ss_family as libc::c_int != libc::AF_UNIX
        {
            return Err("descriptor 3 must have a connected AF_UNIX peer".to_owned());
        }
        let mut credentials = unsafe { std::mem::zeroed::<libc::ucred>() };
        let mut length = std::mem::size_of_val(&credentials) as libc::socklen_t;
        // SAFETY: getsockopt writes a ucred into credentials.
        if unsafe {
            libc::getsockopt(
                SOCKET_FD,
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                (&mut credentials as *mut libc::ucred).cast(),
                &mut length,
            )
        } != 0
        {
            return Err(last_error("read descriptor 3 peer credentials"));
        }
        let caller = unsafe { libc::getppid() };
        if credentials.pid != caller || credentials.uid != BACKEND_UID {
            return Err("descriptor 3 peer must be the UID-1001 backend parent".to_owned());
        }
        // SAFETY: F_GETFD reads descriptor flags and F_SETFD writes a scalar flag value.
        let descriptor_flags = unsafe { libc::fcntl(SOCKET_FD, libc::F_GETFD) };
        if descriptor_flags < 0
            || unsafe {
                libc::fcntl(
                    SOCKET_FD,
                    libc::F_SETFD,
                    descriptor_flags & !libc::FD_CLOEXEC,
                )
            } < 0
        {
            return Err(last_error("preserve descriptor 3 for the sidecar"));
        }
        Ok(())
    }

    fn read_bounded(fd: RawFd, limit: usize, context: &str) -> Result<Vec<u8>, String> {
        let mut bytes = vec![0; limit + 1];
        let mut count = 0;
        while count < bytes.len() {
            // SAFETY: the remaining slice is writable and fd is open.
            let read =
                unsafe { libc::read(fd, bytes[count..].as_mut_ptr().cast(), bytes.len() - count) };
            if read < 0 {
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(format!("read {context}: {error}"));
            }
            if read == 0 {
                bytes.truncate(count);
                return Ok(bytes);
            }
            count += read as usize;
        }
        Err(format!("{context} exceeds the launcher limit"))
    }

    fn process_file(pid: libc::pid_t, name: &str, limit: usize) -> Result<Vec<u8>, ProcessError> {
        let path = CString::new(format!("/proc/{pid}/{name}"))
            .map_err(|_| "invalid proc path".to_owned())?;
        // SAFETY: path is a nul-terminated proc path.
        let raw = unsafe {
            libc::open(
                path.as_ptr(),
                libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        if raw < 0 {
            let error = io::Error::last_os_error();
            let message = format!("open process identity: {error}");
            return Err(if error.kind() == io::ErrorKind::NotFound {
                ProcessError::Gone(message)
            } else {
                ProcessError::Failed(message)
            });
        }
        let fd = owned_fd(raw, "open process identity")?;
        read_bounded(fd.as_raw_fd(), limit, "process identity").map_err(ProcessError::Failed)
    }

    fn parse_stat(bytes: &[u8], pid: libc::pid_t) -> Result<ProcessStat, String> {
        let text = std::str::from_utf8(bytes).map_err(|_| "invalid process stat encoding")?;
        let close = text
            .rfind(')')
            .ok_or_else(|| "invalid process stat format".to_owned())?;
        let reported_pid = text[..close]
            .split_ascii_whitespace()
            .next()
            .and_then(|value| value.parse::<libc::pid_t>().ok())
            .ok_or_else(|| "invalid process stat PID".to_owned())?;
        let fields = text[close + 1..]
            .split_ascii_whitespace()
            .collect::<Vec<_>>();
        if reported_pid != pid || fields.len() <= 19 {
            return Err("process stat does not match the requested PID".to_owned());
        }
        Ok(ProcessStat {
            state: fields[0]
                .as_bytes()
                .first()
                .copied()
                .ok_or_else(|| "invalid process state".to_owned())?,
            parent: fields[1]
                .parse()
                .map_err(|_| "invalid process parent PID".to_owned())?,
            start: fields[19]
                .parse()
                .map_err(|_| "invalid process start time".to_owned())?,
        })
    }

    fn process_stat(pid: libc::pid_t) -> Result<ProcessStat, ProcessError> {
        let bytes = process_file(pid, "stat", 4096)?;
        parse_stat(&bytes, pid).map_err(ProcessError::Failed)
    }

    fn is_stale(stat: Result<ProcessStat, ProcessError>, child_start: u64) -> Result<bool, String> {
        match stat {
            Ok(stat) => Ok(stat.start != child_start),
            Err(ProcessError::Gone(_)) => Ok(true),
            Err(ProcessError::Failed(error)) => Err(error),
        }
    }

    fn record_is_stale(pid: libc::pid_t, stored: &StoredAttestation) -> Result<bool, String> {
        is_stale(process_stat(pid), stored.value.child_start)
            .map_err(|error| format!("cannot verify attested PID {pid}: {error}"))
    }

    fn parse_four(line: &str, name: &str) -> Result<[u32; 4], String> {
        let values = line
            .strip_prefix(name)
            .ok_or_else(|| format!("process status is missing {name}"))?
            .split_ascii_whitespace()
            .map(|value| value.parse::<u32>().map_err(|_| format!("invalid {name}")))
            .collect::<Result<Vec<_>, _>>()?;
        values
            .try_into()
            .map_err(|_| format!("process status has invalid {name}"))
    }

    fn process_info(pid: libc::pid_t) -> Result<ProcessInfo, String> {
        let stat = process_stat(pid).map_err(ProcessError::message)?;
        let status = process_file(pid, "status", 8192).map_err(ProcessError::message)?;
        let status = std::str::from_utf8(&status).map_err(|_| "invalid process status encoding")?;
        let mut status_pid = None;
        let mut status_parent = None;
        let mut uids = None;
        let mut gids = None;
        for line in status.lines() {
            if let Some(value) = line.strip_prefix("Pid:\t") {
                status_pid = Some(
                    value
                        .parse::<libc::pid_t>()
                        .map_err(|_| "invalid status PID")?,
                );
            } else if let Some(value) = line.strip_prefix("PPid:\t") {
                status_parent = Some(
                    value
                        .parse::<libc::pid_t>()
                        .map_err(|_| "invalid status parent PID")?,
                );
            } else if line.starts_with("Uid:") {
                uids = Some(parse_four(line, "Uid:")?);
            } else if line.starts_with("Gid:") {
                gids = Some(parse_four(line, "Gid:")?);
            }
            if status_pid.is_some() && status_parent.is_some() && uids.is_some() && gids.is_some() {
                break;
            }
        }
        let status_pid = status_pid.ok_or_else(|| "process status is missing PID".to_owned())?;
        let status_parent =
            status_parent.ok_or_else(|| "process status is missing parent PID".to_owned())?;
        if status_pid != pid || status_parent != stat.parent {
            return Err("process status changed while reading identity".to_owned());
        }
        Ok(ProcessInfo {
            stat,
            uids: uids.ok_or_else(|| "process status is missing UIDs".to_owned())?,
            gids: gids.ok_or_else(|| "process status is missing GIDs".to_owned())?,
        })
    }

    fn is_backend(info: &ProcessInfo) -> bool {
        info.uids == [BACKEND_UID; 4]
    }

    fn verify_peer_process(caller_pid: libc::pid_t) -> Result<u64, String> {
        let info = process_info(caller_pid)?;
        if !is_backend(&info) {
            return Err("launcher parent must have UID 1001 in all process ID slots".to_owned());
        }
        Ok(info.stat.start)
    }

    fn number(value: &str) -> Result<u64, String> {
        decimal(value.as_bytes()).map_err(|error| {
            match error {
                DecimalError::Invalid => "invalid attestation number",
                DecimalError::Overflow => "attestation number is out of range",
            }
            .to_owned()
        })
    }

    fn encode_attestation(value: &Attestation) -> Vec<u8> {
        format!(
            "RYOT_SANDBOXD_LAUNCH=1\nexecutable={}\ncaller_pid={}\ncaller_start={}\nchild_pid={}\nchild_start={}\nexecutable_dev={}\nexecutable_ino={}\n",
            EXECUTABLE_PATH.to_str().expect("static path"),
            value.caller_pid,
            value.caller_start,
            value.child_pid,
            value.child_start,
            value.executable_dev,
            value.executable_ino,
        )
        .into_bytes()
    }

    fn attestation_field<'a>(line: Option<&'a str>, name: &str) -> Result<&'a str, String> {
        line.and_then(|line| line.strip_prefix(name))
            .ok_or_else(|| format!("invalid launch attestation field {name}"))
    }

    fn decode_attestation(bytes: &[u8]) -> Result<Attestation, String> {
        let text = std::str::from_utf8(bytes).map_err(|_| "invalid launch attestation encoding")?;
        let mut lines = text.lines();
        if lines.next() != Some("RYOT_SANDBOXD_LAUNCH=1")
            || lines.next()
                != Some(
                    format!(
                        "executable={}",
                        EXECUTABLE_PATH.to_str().expect("static path")
                    )
                    .as_str(),
                )
        {
            return Err("invalid launch attestation identity".to_owned());
        }
        let caller_pid =
            libc::pid_t::try_from(number(attestation_field(lines.next(), "caller_pid=")?)?)
                .map_err(|_| "invalid attested caller PID".to_owned())?;
        let caller_start = number(attestation_field(lines.next(), "caller_start=")?)?;
        let child_pid =
            libc::pid_t::try_from(number(attestation_field(lines.next(), "child_pid=")?)?)
                .map_err(|_| "invalid attested child PID".to_owned())?;
        let child_start = number(attestation_field(lines.next(), "child_start=")?)?;
        let executable_dev = number(attestation_field(lines.next(), "executable_dev=")?)?;
        let executable_ino = number(attestation_field(lines.next(), "executable_ino=")?)?;
        if lines.next().is_some() || caller_pid <= 0 || child_pid <= 0 {
            return Err("invalid launch attestation contents".to_owned());
        }
        Ok(Attestation {
            caller_pid,
            caller_start,
            child_pid,
            child_start,
            executable_dev,
            executable_ino,
        })
    }

    fn pid_name(pid: libc::pid_t) -> Result<CString, String> {
        CString::new(pid.to_string()).map_err(|_| "invalid PID filename".to_owned())
    }

    fn read_record_at(dirfd: RawFd, pid: libc::pid_t) -> Result<Option<StoredAttestation>, String> {
        let name = pid_name(pid)?;
        // SAFETY: dirfd is a verified private directory and name is numeric.
        let raw = unsafe {
            libc::openat(
                dirfd,
                name.as_ptr(),
                libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK,
            )
        };
        if raw < 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::NotFound {
                return Ok(None);
            }
            return Err(format!("open launch attestation: {error}"));
        }
        let fd = owned_fd(raw, "open launch attestation")?;
        let stat = fstat(fd.as_raw_fd(), "inspect launch attestation")?;
        if !stat_matches(
            &stat,
            0,
            None,
            libc::S_IFREG,
            Permissions::Exact(&[0o600]),
            Some(1),
        ) {
            return Err(
                "launch attestation must be a root-owned mode-0600 regular file".to_owned(),
            );
        }
        let bytes = read_bounded(fd.as_raw_fd(), MAX_RECORD_BYTES, "launch attestation")?;
        let value = decode_attestation(&bytes)?;
        if value.child_pid != pid {
            return Err("launch attestation filename does not match its child PID".to_owned());
        }
        Ok(Some(StoredAttestation {
            value,
            device: stat.st_dev,
            inode: stat.st_ino,
        }))
    }

    fn open_attestation_directory() -> Result<OwnedFd, String> {
        let directory = open_absolute(ATTESTATION_PATH, libc::O_RDONLY | libc::O_DIRECTORY)?;
        validate_private_directory(directory.as_raw_fd())?;
        Ok(directory)
    }

    fn lock_directory(dirfd: RawFd) -> Result<DirectoryLock, String> {
        // SAFETY: dirfd is a verified directory and the lock name is fixed.
        let fd = owned_fd(
            unsafe {
                libc::openat(
                    dirfd,
                    c".lock".as_ptr(),
                    libc::O_RDWR | libc::O_CREAT | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                    0o600,
                )
            },
            "open attestation lock",
        )?;
        let stat = fstat(fd.as_raw_fd(), "inspect attestation lock")?;
        if !stat_matches(
            &stat,
            0,
            Some(0),
            libc::S_IFREG,
            Permissions::Exact(&[0o600]),
            Some(1),
        ) {
            return Err("attestation lock must be a root-owned mode-0600 regular file".to_owned());
        }
        // SAFETY: flock only operates on the open lock descriptor.
        if unsafe { libc::flock(fd.as_raw_fd(), libc::LOCK_EX) } != 0 {
            return Err(last_error("lock attestation directory"));
        }
        Ok(DirectoryLock { _fd: fd })
    }

    fn record_pid(name: &[u8]) -> Result<Option<libc::pid_t>, String> {
        if matches!(name, b"." | b".." | b".lock") {
            return Ok(None);
        }
        let pid = match decimal(name) {
            Ok(pid) => {
                libc::pid_t::try_from(pid).map_err(|_| "invalid attestation filename".to_owned())?
            }
            Err(DecimalError::Invalid) => {
                return Err("attestation directory contains an unexpected entry".to_owned());
            }
            Err(DecimalError::Overflow) => return Err("invalid attestation filename".to_owned()),
        };
        if pid <= 0 {
            return Err("invalid attestation filename".to_owned());
        }
        Ok(Some(pid))
    }

    fn directory_entries(dirfd: RawFd) -> Result<Vec<libc::pid_t>, String> {
        let duplicate = duplicate_above_slots(dirfd, "duplicate attestation directory")?;
        // SAFETY: fdopendir takes ownership of the descriptor only when it succeeds.
        let stream = unsafe { libc::fdopendir(duplicate.as_raw_fd()) };
        if stream.is_null() {
            return Err(last_error("read attestation directory"));
        }
        let _ = duplicate.into_raw_fd();
        let stream = DirGuard(stream);
        let mut pids = Vec::new();
        let mut entries = 0;
        loop {
            // SAFETY: errno is thread-local and writable on Linux targets.
            unsafe { *libc::__errno_location() = 0 };
            // SAFETY: the stream stays open until the guard drops.
            let entry = unsafe { libc::readdir(stream.0) };
            if entry.is_null() {
                // SAFETY: errno is thread-local and writable on Linux targets.
                let error = unsafe { *libc::__errno_location() };
                if error != 0 {
                    return Err(io::Error::from_raw_os_error(error).to_string());
                }
                return Ok(pids);
            }
            entries += 1;
            if entries > MAX_RECORDS + 3 {
                return Err("attestation directory exceeds the record limit".to_owned());
            }
            // SAFETY: d_name is a nul-terminated directory entry name.
            let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
            if let Some(pid) = record_pid(name)? {
                if pids.len() == MAX_RECORDS {
                    return Err("attestation directory exceeds the record limit".to_owned());
                }
                pids.push(pid);
            }
        }
    }

    fn unlink_record(
        dirfd: RawFd,
        pid: libc::pid_t,
        stored: &StoredAttestation,
    ) -> Result<(), String> {
        let name = pid_name(pid)?;
        // SAFETY: fstatat does not follow the final symlink and writes to a valid structure.
        let mut current = unsafe { std::mem::zeroed::<libc::stat>() };
        if unsafe {
            libc::fstatat(
                dirfd,
                name.as_ptr(),
                &mut current,
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } != 0
        {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::NotFound {
                return Ok(());
            }
            return Err(format!("inspect launch attestation for removal: {error}"));
        }
        if current.st_dev != stored.device
            || current.st_ino != stored.inode
            || !stat_matches(
                &current,
                0,
                None,
                libc::S_IFREG,
                Permissions::Exact(&[0o600]),
                None,
            )
        {
            return Err("launch attestation changed before removal".to_owned());
        }
        // SAFETY: name is a numeric basename within the verified directory.
        if unsafe { libc::unlinkat(dirfd, name.as_ptr(), 0) } != 0 {
            return Err(last_error("remove launch attestation"));
        }
        // SAFETY: fsync persists the directory entry update.
        if unsafe { libc::fsync(dirfd) } != 0 {
            return Err(last_error("sync attestation directory"));
        }
        Ok(())
    }

    fn sweep_locked(dirfd: RawFd, _lock: &DirectoryLock) -> Result<(), String> {
        for pid in directory_entries(dirfd)? {
            let Some(stored) = read_record_at(dirfd, pid)? else {
                continue;
            };
            if record_is_stale(pid, &stored)? {
                unlink_record(dirfd, pid, &stored)?;
            }
        }
        Ok(())
    }

    fn sweep_stale_records(dirfd: RawFd) -> Result<(), String> {
        let lock = lock_directory(dirfd)?;
        sweep_locked(dirfd, &lock)
    }

    fn write_all(fd: RawFd, bytes: &[u8]) -> Result<(), String> {
        let mut written = 0;
        while written < bytes.len() {
            // SAFETY: bytes[written..] is a readable buffer and fd is open.
            let count =
                unsafe { libc::write(fd, bytes[written..].as_ptr().cast(), bytes.len() - written) };
            if count < 0 {
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(format!("write launch attestation: {error}"));
            }
            if count == 0 {
                return Err("short write of launch attestation".to_owned());
            }
            written += count as usize;
        }
        Ok(())
    }

    fn create_attestation(dirfd: RawFd, value: &Attestation) -> Result<(), String> {
        let lock = lock_directory(dirfd)?;
        sweep_locked(dirfd, &lock)?;
        let name = pid_name(value.child_pid)?;
        // SAFETY: name is a PID basename in the verified private root-owned directory.
        let raw = unsafe {
            libc::openat(
                dirfd,
                name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                0o600,
            )
        };
        let fd = owned_fd(raw, "create launch attestation")?;
        let result = (|| {
            // SAFETY: fchmod changes permissions on the newly created root-owned file.
            if unsafe { libc::fchmod(fd.as_raw_fd(), 0o600) } != 0 {
                return Err(last_error("secure launch attestation"));
            }
            let text = encode_attestation(value);
            if text.len() > MAX_RECORD_BYTES {
                return Err("launch attestation exceeds the launcher limit".to_owned());
            }
            write_all(fd.as_raw_fd(), &text)?;
            // SAFETY: fsync flushes the complete record before the sidecar exec.
            if unsafe { libc::fsync(fd.as_raw_fd()) } != 0 {
                return Err(last_error("sync launch attestation"));
            }
            // SAFETY: fsync flushes the new directory entry.
            if unsafe { libc::fsync(dirfd) } != 0 {
                return Err(last_error("sync attestation directory"));
            }
            Ok(())
        })();
        if result.is_err() {
            // SAFETY: name is a PID basename within the verified private directory.
            unsafe { libc::unlinkat(dirfd, name.as_ptr(), 0) };
        }
        result
    }

    fn set_core_limit() -> Result<(), String> {
        let limit = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        // SAFETY: limit points to a valid rlimit structure.
        if unsafe { libc::setrlimit(libc::RLIMIT_CORE, &limit) } != 0 {
            return Err(last_error("disable core dumps"));
        }
        // SAFETY: getrlimit writes into a valid rlimit structure.
        let mut current = unsafe { std::mem::zeroed::<libc::rlimit>() };
        if unsafe { libc::getrlimit(libc::RLIMIT_CORE, &mut current) } != 0
            || current.rlim_cur != 0
            || current.rlim_max != 0
        {
            return Err("core dumps could not be disabled".to_owned());
        }
        Ok(())
    }

    fn set_oom_score() -> Result<(), String> {
        // SAFETY: the proc path is static and the descriptor is used only for this process.
        let fd = owned_fd(
            unsafe {
                libc::open(
                    c"/proc/self/oom_score_adj".as_ptr(),
                    libc::O_RDWR | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                )
            },
            "open OOM score adjustment",
        )?;
        write_all(fd.as_raw_fd(), b"1000\n")?;
        // SAFETY: lseek and read use a valid descriptor and writable buffer.
        if unsafe { libc::lseek(fd.as_raw_fd(), 0, libc::SEEK_SET) } < 0 {
            return Err(last_error("verify OOM score adjustment"));
        }
        let mut value = [0; 16];
        let count = unsafe { libc::read(fd.as_raw_fd(), value.as_mut_ptr().cast(), value.len()) };
        if count < 0 {
            return Err(last_error("verify OOM score adjustment"));
        }
        if std::str::from_utf8(&value[..count as usize])
            .unwrap_or_default()
            .trim()
            != "1000"
        {
            return Err("OOM score adjustment is not 1000".to_owned());
        }
        Ok(())
    }

    fn close_unrelated_descriptors() -> Result<(), String> {
        // SAFETY: close_range closes only descriptors outside the fixed launcher set.
        if unsafe { libc::syscall(libc::SYS_close_range, 6_u32, u32::MAX, 0_u32) } != 0 {
            return Err(last_error("close inherited descriptors"));
        }
        // SAFETY: standard descriptors are deliberately not inherited by the sidecar.
        if unsafe { libc::syscall(libc::SYS_close_range, 0_u32, 2_u32, 0_u32) } != 0 {
            return Err(last_error("close standard descriptors"));
        }
        Ok(())
    }

    fn drop_privileges() -> Result<(), String> {
        // SAFETY: setgroups drops all supplementary groups before the identity transition.
        if unsafe { libc::setgroups(0, std::ptr::null()) } != 0 {
            return Err(last_error("clear supplementary groups"));
        }
        // SAFETY: the launcher is root and is setting all GID slots to the fixed sidecar GID.
        if unsafe { libc::setresgid(SIDECAR_GID, SIDECAR_GID, SIDECAR_GID) } != 0 {
            return Err(last_error("drop sidecar GID"));
        }
        // SAFETY: the launcher is root and is setting all UID slots to the fixed sidecar UID.
        if unsafe { libc::setresuid(SIDECAR_UID, SIDECAR_UID, SIDECAR_UID) } != 0 {
            return Err(last_error("drop sidecar UID"));
        }
        let (uids, gids) = credentials()?;
        // SAFETY: getgroups with size zero returns the supplementary group count.
        let groups = unsafe { libc::getgroups(0, std::ptr::null_mut()) };
        if uids != [SIDECAR_UID; 3]
            || gids != [SIDECAR_GID; 3]
            || groups != 0
            || unsafe { libc::syscall(libc::SYS_setfsuid, u32::MAX) } as libc::uid_t != SIDECAR_UID
            || unsafe { libc::syscall(libc::SYS_setfsgid, u32::MAX) } as libc::gid_t != SIDECAR_GID
        {
            return Err("sidecar credentials did not drop to UID/GID 1002".to_owned());
        }
        Ok(())
    }

    fn arguments(config: &LaunchConfig) -> Result<Vec<CString>, String> {
        let values = [
            EXECUTABLE_PATH.to_string_lossy().into_owned(),
            "--generation".to_owned(),
            config.generation.to_string(),
            "--snapshots".to_owned(),
            SNAPSHOT_PATH.to_string_lossy().into_owned(),
            "--tier".to_owned(),
            config.tier.clone(),
            "--trust".to_owned(),
            config.trust.clone(),
            "--threads".to_owned(),
            config.threads.to_string(),
            "--queue".to_owned(),
            config.queue.to_string(),
            "--max-active".to_owned(),
            config.max_active.to_string(),
            "--memory-budget".to_owned(),
            config.memory_budget.to_string(),
            "--max-executions".to_owned(),
            MAX_EXECUTIONS.to_owned(),
            "--max-rss".to_owned(),
            config.max_rss.to_string(),
            "--grace-ms".to_owned(),
            GRACE_MS.to_owned(),
        ];
        values
            .into_iter()
            .map(|value| CString::new(value).map_err(|_| "invalid sidecar argument".to_owned()))
            .collect()
    }

    fn remove_created_record(dirfd: RawFd, pid: libc::pid_t) {
        if let Ok(_lock) = lock_directory(dirfd)
            && let Ok(Some(stored)) = read_record_at(dirfd, pid)
        {
            let _ = unlink_record(dirfd, pid, &stored);
        }
    }

    /// Runs everything after the attestation exists. `record_directory` names the descriptor that
    /// cleanup must use: the verified attestation directory until its copy occupies the reserved
    /// slot, then that slot.
    fn exec_sidecar(
        executable: RawFd,
        directory: RawFd,
        caller_pid: libc::pid_t,
        values: &[CString],
        record_directory: &mut RawFd,
    ) -> Result<Infallible, String> {
        let (uids, _) = credentials()?;
        if uids != [BACKEND_UID, 0, 0] || unsafe { libc::getppid() } != caller_pid {
            return Err("launcher identity changed before sidecar exec".to_owned());
        }
        let executable = duplicate_above_slots(executable, "duplicate sidecar executable")?;
        let directory = duplicate_above_slots(directory, "duplicate attestation directory")?;
        // SAFETY: dup3 replaces only the reserved attestation descriptor and keeps it close-on-exec.
        if unsafe { libc::dup3(directory.as_raw_fd(), ATTESTATION_FD, libc::O_CLOEXEC) } < 0 {
            return Err(last_error("prepare attestation descriptor"));
        }
        *record_directory = ATTESTATION_FD;
        // SAFETY: dup3 replaces only the reserved executable descriptor and keeps it close-on-exec.
        if unsafe { libc::dup3(executable.as_raw_fd(), EXECUTABLE_FD, libc::O_CLOEXEC) } < 0 {
            return Err(last_error("prepare sidecar executable descriptor"));
        }
        drop((executable, directory));
        close_unrelated_descriptors()?;
        drop_privileges()?;
        let mut pointers = values
            .iter()
            .map(|value| value.as_ptr())
            .collect::<Vec<_>>();
        pointers.push(std::ptr::null());
        let environment: [*const libc::c_char; 1] = [std::ptr::null()];
        // SAFETY: fd 4 is the verified fixed ELF executable; argv and the empty environment are nul-terminated.
        unsafe {
            libc::syscall(
                libc::SYS_execveat,
                EXECUTABLE_FD,
                c"".as_ptr(),
                pointers.as_ptr(),
                environment.as_ptr(),
                libc::AT_EMPTY_PATH,
            )
        };
        Err(last_error("execute fixed sidecar"))
    }

    fn launch(args: &[String]) -> Result<(), String> {
        let caller_pid = validate_privileged_caller()?;
        clear_environment()?;
        let config = parse_launch(args)?;
        let values = arguments(&config)?;
        verify_launcher()?;
        check_socket()?;
        let caller_start = verify_peer_process(caller_pid)?;
        set_core_limit()?;
        set_oom_score()?;
        validate_snapshots()?;
        let (executable, (executable_dev, executable_ino)) = sidecar_identity()?;
        let child_pid = unsafe { libc::getpid() };
        let child_start = process_stat(child_pid)
            .map_err(ProcessError::message)?
            .start;
        let directory = open_attestation_directory()?;
        create_attestation(
            directory.as_raw_fd(),
            &Attestation {
                caller_pid,
                caller_start,
                child_pid,
                child_start,
                executable_dev,
                executable_ino,
            },
        )?;
        let mut record_directory = directory.as_raw_fd();
        let Err(error) = exec_sidecar(
            executable.as_raw_fd(),
            directory.as_raw_fd(),
            caller_pid,
            &values,
            &mut record_directory,
        );
        remove_created_record(record_directory, child_pid);
        Err(error)
    }

    fn pidfd_exited(pidfd: RawFd) -> Result<bool, String> {
        let mut descriptor = libc::pollfd {
            fd: pidfd,
            events: libc::POLLIN,
            revents: 0,
        };
        // SAFETY: descriptor is a valid pollfd and timeout zero does not block.
        let result = unsafe { libc::poll(&mut descriptor, 1, 0) };
        if result < 0 {
            return Err(last_error("check pidfd exit state"));
        }
        Ok(result > 0 && descriptor.revents & libc::POLLIN != 0)
    }

    fn sweep_after_exit() -> Result<(), String> {
        let directory = open_attestation_directory()?;
        sweep_stale_records(directory.as_raw_fd())
    }

    fn remove_confirmed_exit(pid: libc::pid_t, caller_pid: libc::pid_t) -> Result<(), String> {
        let directory = open_attestation_directory()?;
        let _lock = lock_directory(directory.as_raw_fd())?;
        let Some(stored) = read_record_at(directory.as_raw_fd(), pid)? else {
            return Ok(());
        };
        let caller = process_info(caller_pid)?;
        if !is_backend(&caller)
            || stored.value.caller_pid != caller_pid
            || stored.value.caller_start != caller.stat.start
        {
            return Err("exited target attestation does not match its backend caller".to_owned());
        }
        match process_stat(pid) {
            Ok(stat) if stat.start != stored.value.child_start => Ok(()),
            Ok(_) | Err(ProcessError::Gone(_)) => {
                unlink_record(directory.as_raw_fd(), pid, &stored)
            }
            Err(ProcessError::Failed(error)) => {
                Err(format!("cannot verify exited target PID {pid}: {error}"))
            }
        }
    }

    fn terminate(pid_text: &str) -> Result<(), String> {
        let caller_pid = validate_privileged_caller()?;
        let pid = i32::try_from(positive_u64(pid_text, "PID")?)
            .map_err(|_| "PID is out of range".to_owned())?;
        clear_environment()?;
        // SAFETY: pid is validated and pidfd_open is the first target operation.
        let raw_pidfd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0_u32) as RawFd };
        if raw_pidfd < 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ESRCH) {
                let _ = sweep_after_exit();
            }
            return Err(format!("pidfd_open: {error}"));
        }
        let pidfd = owned_fd(raw_pidfd, "pidfd_open")?;
        let target = match process_info(pid) {
            Ok(target) => target,
            Err(error) => {
                if pidfd_exited(pidfd.as_raw_fd()).unwrap_or(false) {
                    remove_confirmed_exit(pid, caller_pid)?;
                    return Ok(());
                }
                return Err(error);
            }
        };
        let directory = open_attestation_directory()?;
        let _lock = lock_directory(directory.as_raw_fd())?;
        let Some(stored) = read_record_at(directory.as_raw_fd(), pid)? else {
            return Err("target has no trusted launcher attestation".to_owned());
        };
        let record = &stored.value;
        if target.stat.parent != caller_pid
            || target.uids != [SIDECAR_UID; 4]
            || target.gids != [SIDECAR_GID; 4]
            || target.stat.start != record.child_start
            || record.caller_pid != caller_pid
        {
            return Err(
                "target process identity does not match the launcher attestation".to_owned(),
            );
        }
        let caller = process_info(caller_pid)?;
        if !is_backend(&caller)
            || caller.stat.start != record.caller_start
            || unsafe { libc::getppid() } != caller_pid
        {
            return Err(
                "target parent identity does not match the launcher attestation".to_owned(),
            );
        }
        verify_launcher()?;
        let (_, identity) = sidecar_identity()?;
        if identity != (record.executable_dev, record.executable_ino) {
            return Err("target executable identity does not match the fixed sidecar".to_owned());
        }
        if target.stat.state == b'Z' || target.stat.state == b'X' {
            unlink_record(directory.as_raw_fd(), pid, &stored)?;
            return Ok(());
        }
        // SAFETY: pidfd was opened before target inspection and signal is fixed to SIGKILL.
        let signalled = unsafe {
            libc::syscall(
                libc::SYS_pidfd_send_signal,
                pidfd.as_raw_fd(),
                libc::SIGKILL,
                std::ptr::null::<libc::siginfo_t>(),
                0_u32,
            )
        };
        if signalled != 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ESRCH)
                && pidfd_exited(pidfd.as_raw_fd()).unwrap_or(false)
            {
                unlink_record(directory.as_raw_fd(), pid, &stored)?;
                return Ok(());
            }
            return Err(format!("pidfd_send_signal(SIGKILL): {error}"));
        }
        unlink_record(directory.as_raw_fd(), pid, &stored)?;
        Ok(())
    }

    fn arguments_from_environment() -> Result<Vec<String>, String> {
        let mut args = Vec::new();
        for value in std::env::args_os().skip(1) {
            let value = value
                .into_string()
                .map_err(|_| "launcher arguments must be UTF-8".to_owned())?;
            if value.len() > MAX_ARGUMENT_BYTES {
                return Err("launcher argument exceeds the size limit".to_owned());
            }
            args.push(value);
            if args.len() > MAX_ARGUMENTS {
                return Err("too many launcher arguments".to_owned());
            }
        }
        Ok(args)
    }

    pub fn run() -> Result<(), String> {
        let args = arguments_from_environment()?;
        match args.first().map(String::as_str) {
            Some("launch") => launch(&args),
            Some("terminate") if args.len() == 2 => terminate(&args[1]),
            Some("terminate") => Err("usage: terminate <pid>".to_owned()),
            _ => Err("usage: launch <allowlisted sidecar arguments> | terminate <pid>".to_owned()),
        }
    }

    #[cfg(test)]
    mod tests {
        use std::fs::File;
        use std::io::Read;
        use std::os::fd::AsRawFd;
        use std::os::unix::net::UnixStream;

        use super::*;

        fn launch_args() -> Vec<String> {
            [
                "launch",
                "--generation",
                "9",
                "--tier",
                "data",
                "--trust",
                "system",
                "--threads",
                "3",
                "--queue",
                "4",
                "--max-active",
                "2",
                "--memory-budget",
                "8192",
                "--max-rss",
                "16384",
            ]
            .map(str::to_owned)
            .to_vec()
        }

        fn stat_line(pid: libc::pid_t, start: &str) -> String {
            format!("{pid} (ryot sandboxd) S 7 {}{start} 0", "0 ".repeat(17))
        }

        #[test]
        fn launch_passes_flags_through_and_injects_fixed_ones() {
            let args = launch_args();
            for flag in ["--snapshots", "--max-executions", "--grace-ms"] {
                let mut injected = args.clone();
                injected[3] = flag.to_owned();
                assert!(
                    parse_launch(&injected)
                        .is_err_and(|error| error.starts_with("unsupported launcher argument")),
                    "{flag}"
                );
            }
            let mut duplicate = args.clone();
            duplicate[3] = "--generation".to_owned();
            assert!(
                parse_launch(&duplicate)
                    .is_err_and(|error| error == "--generation must appear exactly once")
            );

            let values = arguments(&parse_launch(&args).expect("valid launch configuration"))
                .expect("sidecar arguments");
            let values = values
                .iter()
                .map(|value| value.to_str().expect("UTF-8 argument"))
                .collect::<Vec<_>>();
            assert_eq!(values[0], EXECUTABLE_PATH.to_str().expect("static path"));
            let value_of = |flag: &str| {
                let index = values
                    .iter()
                    .position(|value| *value == flag)
                    .expect("sidecar flag");
                values[index + 1]
            };
            for pair in args[1..].chunks_exact(2) {
                assert_eq!(value_of(pair[0].as_str()), pair[1]);
            }
            assert_eq!(
                value_of("--snapshots"),
                SNAPSHOT_PATH.to_str().expect("static path")
            );
            assert_eq!(value_of("--max-executions"), MAX_EXECUTIONS);
            assert_eq!(value_of("--grace-ms"), GRACE_MS);
        }

        #[test]
        fn trusted_paths_are_absolute_without_relative_components() {
            for path in [
                EXECUTABLE_PATH,
                SNAPSHOT_PATH,
                LAUNCHER_PATH,
                ATTESTATION_PATH,
            ] {
                let bytes = path.to_bytes();
                assert_eq!(bytes.first(), Some(&b'/'), "{path:?}");
                let components = bytes
                    .split(|byte| *byte == b'/')
                    .filter(|component| !component.is_empty())
                    .collect::<Vec<_>>();
                assert!(!components.is_empty(), "{path:?}");
                assert!(
                    components
                        .iter()
                        .all(|component| *component != b"." && *component != b".."),
                    "{path:?}"
                );
            }
        }

        #[test]
        fn only_a_missing_process_makes_a_record_stale() {
            let stat = parse_stat(stat_line(42, "99").as_bytes(), 42).expect("process stat");
            assert_eq!((stat.state, stat.parent, stat.start), (b'S', 7, 99));
            assert!(matches!(is_stale(Ok(stat), 99), Ok(false)));
            let restarted = parse_stat(stat_line(42, "100").as_bytes(), 42);
            assert!(matches!(
                is_stale(restarted.map_err(ProcessError::Failed), 99),
                Ok(true)
            ));
            assert!(matches!(
                is_stale(Err(ProcessError::Gone("gone".to_owned())), 99),
                Ok(true)
            ));
            assert!(matches!(
                process_stat(libc::pid_t::MAX),
                Err(ProcessError::Gone(_))
            ));

            for (text, pid) in [
                (stat_line(43, "99"), 42),
                (stat_line(42, "soon"), 42),
                ("42 (ryot sandboxd) S 7".to_owned(), 42),
            ] {
                let parsed = parse_stat(text.as_bytes(), pid);
                assert!(
                    is_stale(parsed.map_err(ProcessError::Failed), 99).is_err(),
                    "{text}"
                );
            }
        }

        #[test]
        fn attestation_directory_entries_must_be_positive_pids() {
            assert!(matches!(record_pid(b"12"), Ok(Some(12))));
            for name in [b".".as_slice(), b"..", b".lock"] {
                assert!(matches!(record_pid(name), Ok(None)));
            }
            for name in [
                b"0".as_slice(),
                b"000",
                b"+1",
                b"-1",
                b"",
                b"12a",
                b"99999999999",
                b"99999999999999999999999",
            ] {
                assert!(record_pid(name).is_err(), "{name:?}");
            }
        }

        #[test]
        fn descriptor_cleanup_keeps_only_protocol_and_exec_descriptors() {
            let (mut peer, child_peer) = UnixStream::pair().expect("socket pair");
            let extra = File::open("/dev/null").expect("extra descriptor");
            let socket_fd = child_peer.as_raw_fd();
            let extra_fd = extra.as_raw_fd();
            // SAFETY: the child performs only descriptor operations and _exit after fork.
            let pid = unsafe { libc::fork() };
            assert!(pid >= 0, "fork descriptor probe");
            if pid == 0 {
                // SAFETY: dup2 remaps valid descriptors in the forked child.
                let remapped = unsafe {
                    libc::dup2(socket_fd, SOCKET_FD) >= 0
                        && libc::dup2(extra_fd, EXECUTABLE_FD) >= 0
                        && libc::dup2(extra_fd, ATTESTATION_FD) >= 0
                        && [6, 7, 8, 9, 10]
                            .into_iter()
                            .all(|fd| libc::dup2(extra_fd, fd) >= 0)
                };
                if !remapped || close_unrelated_descriptors().is_err() {
                    // SAFETY: _exit terminates only the forked child without touching the parent.
                    unsafe { libc::_exit(1) };
                }
                let mut retained = true;
                for fd in [SOCKET_FD, EXECUTABLE_FD, ATTESTATION_FD] {
                    // SAFETY: F_GETFD inspects an integer descriptor in the forked child.
                    if unsafe { libc::fcntl(fd, libc::F_GETFD) } < 0 {
                        retained = false;
                    }
                }
                let mut closed = true;
                for fd in [0, 1, 2, 6, 7, 8, 9, 10] {
                    // SAFETY: F_GETFD inspects an integer descriptor in the forked child.
                    if unsafe { libc::fcntl(fd, libc::F_GETFD) } >= 0 {
                        closed = false;
                    }
                }
                if !retained || !closed {
                    // SAFETY: _exit terminates only the forked child without touching the parent.
                    unsafe { libc::_exit(2) };
                }
                // SAFETY: fd 3 is the connected socket and the message is a valid readable buffer.
                if unsafe { libc::write(SOCKET_FD, b"ok".as_ptr().cast(), 2) } != 2 {
                    // SAFETY: _exit terminates only the forked child without touching the parent.
                    unsafe { libc::_exit(3) };
                }
                // SAFETY: _exit terminates only the forked child without touching the parent.
                unsafe { libc::_exit(0) };
            }
            drop(child_peer);
            let mut report = [0; 2];
            peer.read_exact(&mut report).expect("descriptor report");
            assert_eq!(&report, b"ok");
            // SAFETY: waitpid writes status for the child process created above.
            let mut status = 0;
            assert_eq!(unsafe { libc::waitpid(pid, &mut status, 0) }, pid);
            assert!(libc::WIFEXITED(status));
            assert_eq!(libc::WEXITSTATUS(status), 0);
        }
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    if let Err(error) = linux::run() {
        eprintln!("ryot-sandbox-launcher: {error}");
        std::process::exit(70);
    }

    #[cfg(not(target_os = "linux"))]
    {
        eprintln!("ryot-sandbox-launcher: this launcher requires Linux");
        std::process::exit(69);
    }
}
