#[cfg(target_os = "linux")]
mod linux {
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

    #[derive(Clone, Debug, PartialEq, Eq)]
    struct Attestation {
        caller_pid: libc::pid_t,
        caller_start: u64,
        child_pid: libc::pid_t,
        child_start: u64,
        executable_dev: u64,
        executable_ino: u64,
    }

    struct StoredAttestation {
        value: Attestation,
        device: libc::dev_t,
        inode: libc::ino_t,
    }

    struct ProcessInfo {
        pid: libc::pid_t,
        parent: libc::pid_t,
        start: u64,
        state: u8,
        uids: [u32; 4],
        gids: [u32; 4],
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

    fn fstat(fd: RawFd, context: &str) -> Result<libc::stat, String> {
        // SAFETY: fstat writes to the valid output structure.
        let mut stat = unsafe { std::mem::zeroed::<libc::stat>() };
        // SAFETY: stat points to writable memory and fd is checked by the caller.
        if unsafe { libc::fstat(fd, &mut stat) } != 0 {
            return Err(last_error(context));
        }
        Ok(stat)
    }

    fn validate_directory(fd: RawFd, context: &str) -> Result<(), String> {
        let stat = fstat(fd, context)?;
        if stat.st_uid != 0
            || stat.st_gid != 0
            || stat.st_mode & libc::S_IFMT != libc::S_IFDIR
            || stat.st_mode & 0o022 != 0
        {
            return Err(format!(
                "{context} must be a root-owned, non-writable directory"
            ));
        }
        Ok(())
    }

    fn validate_private_directory(fd: RawFd) -> Result<(), String> {
        let stat = fstat(fd, "attestation directory")?;
        if stat.st_uid != 0
            || stat.st_gid != 0
            || stat.st_mode & libc::S_IFMT != libc::S_IFDIR
            || !matches!(stat.st_mode & 0o7777, 0o700 | 0o750)
        {
            return Err(
                "attestation directory must be root-owned and private (0700 or 0750)".to_owned(),
            );
        }
        Ok(())
    }

    fn validate_regular(fd: RawFd, context: &str) -> Result<libc::stat, String> {
        let stat = fstat(fd, context)?;
        if stat.st_uid != 0
            || stat.st_mode & libc::S_IFMT != libc::S_IFREG
            || stat.st_mode & 0o022 != 0
            || stat.st_nlink != 1
        {
            return Err(format!(
                "{context} must be a root-owned, non-writable regular file"
            ));
        }
        Ok(stat)
    }

    fn open_absolute(path: &CStr, final_flags: libc::c_int) -> Result<OwnedFd, String> {
        let bytes = path.to_bytes();
        if bytes.first() != Some(&b'/') {
            return Err("trusted path must be absolute".to_owned());
        }
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
        let components = bytes
            .split(|byte| *byte == b'/')
            .filter(|component| !component.is_empty());
        let components = components.collect::<Vec<_>>();
        if components.is_empty() {
            return Err("trusted path must name a file or directory".to_owned());
        }
        for (index, component) in components.iter().enumerate() {
            if *component == b"." || *component == b".." {
                return Err("trusted path contains a relative component".to_owned());
            }
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

    fn file_identity(fd: RawFd, executable: bool, context: &str) -> Result<(u64, u64), String> {
        let stat = validate_regular(fd, context)?;
        if executable && stat.st_mode & 0o100 == 0 {
            return Err(format!("{context} is not executable by its owner"));
        }
        Ok((stat.st_dev as u64, stat.st_ino as u64))
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

    fn open_sidecar() -> Result<(OwnedFd, (u64, u64)), String> {
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
        let executable = open_absolute(EXECUTABLE_PATH, libc::O_PATH)?;
        let identity = file_identity(executable.as_raw_fd(), true, "installed sidecar")?;
        Ok((executable, identity))
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

    fn positive_u64(value: &str, flag: &str) -> Result<u64, String> {
        if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(format!("{flag} requires a positive decimal integer"));
        }
        let parsed = value
            .parse::<u64>()
            .map_err(|_| format!("{flag} is out of range"))?;
        if parsed == 0 {
            return Err(format!("{flag} must be positive"));
        }
        Ok(parsed)
    }

    fn parse_launch(args: &[String]) -> Result<LaunchConfig, String> {
        if args.len() != MAX_ARGUMENTS || args.first().map(String::as_str) != Some("launch") {
            return Err("usage: launch --generation n --tier core|data|full --trust system|user --threads n --queue n --max-active n --memory-budget n --max-rss n".to_owned());
        }
        let mut values = std::collections::HashMap::with_capacity(LAUNCH_FLAGS.len());
        for pair in args[1..].chunks_exact(2) {
            let flag = &pair[0];
            let value = &pair[1];
            if flag.len() > MAX_ARGUMENT_BYTES
                || value.len() > MAX_ARGUMENT_BYTES
                || !LAUNCH_FLAGS.contains(&flag.as_str())
            {
                return Err(format!("unsupported launcher argument {flag:?}"));
            }
            if values.insert(flag.as_str(), value.as_str()).is_some() {
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

    fn check_socket() -> Result<(), String> {
        let stat = fstat(SOCKET_FD, "inspect descriptor 3")?;
        if stat.st_mode & libc::S_IFMT != libc::S_IFSOCK {
            return Err("descriptor 3 must be a connected AF_UNIX stream socket".to_owned());
        }
        let mut value = 0;
        let mut length = std::mem::size_of_val(&value) as libc::socklen_t;
        // SAFETY: getsockopt writes an integer into value.
        if unsafe {
            libc::getsockopt(
                SOCKET_FD,
                libc::SOL_SOCKET,
                libc::SO_DOMAIN,
                (&mut value as *mut libc::c_int).cast(),
                &mut length,
            )
        } != 0
            || value != libc::AF_UNIX
        {
            return Err("descriptor 3 must use AF_UNIX".to_owned());
        }
        value = 0;
        length = std::mem::size_of_val(&value) as libc::socklen_t;
        // SAFETY: getsockopt writes an integer into value.
        if unsafe {
            libc::getsockopt(
                SOCKET_FD,
                libc::SOL_SOCKET,
                libc::SO_TYPE,
                (&mut value as *mut libc::c_int).cast(),
                &mut length,
            )
        } != 0
            || value != libc::SOCK_STREAM
        {
            return Err("descriptor 3 must be SOCK_STREAM".to_owned());
        }
        value = 0;
        length = std::mem::size_of_val(&value) as libc::socklen_t;
        // SAFETY: getsockopt writes an integer into value.
        if unsafe {
            libc::getsockopt(
                SOCKET_FD,
                libc::SOL_SOCKET,
                libc::SO_ACCEPTCONN,
                (&mut value as *mut libc::c_int).cast(),
                &mut length,
            )
        } != 0
            || value != 0
        {
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
        length = std::mem::size_of_val(&credentials) as libc::socklen_t;
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

    fn process_bytes(path: &str, limit: usize) -> Result<Vec<u8>, String> {
        let path = CString::new(path).map_err(|_| "invalid proc path")?;
        // SAFETY: path is a nul-terminated proc path.
        let fd = owned_fd(
            unsafe {
                libc::open(
                    path.as_ptr(),
                    libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                )
            },
            "open process identity",
        )?;
        let mut bytes = vec![0; limit + 1];
        let mut count = 0;
        while count < bytes.len() {
            // SAFETY: the remaining slice is writable and fd is open.
            let read = unsafe {
                libc::read(
                    fd.as_raw_fd(),
                    bytes[count..].as_mut_ptr().cast(),
                    bytes.len() - count,
                )
            };
            if read < 0 {
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(format!("read process identity: {error}"));
            }
            if read == 0 {
                bytes.truncate(count);
                return Ok(bytes);
            }
            count += read as usize;
        }
        Err("process identity exceeds the launcher limit".to_owned())
    }

    fn process_start(pid: libc::pid_t) -> Result<u64, io::Error> {
        let text = std::fs::read(format!("/proc/{pid}/stat"))?;
        if text.len() > 4096 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "process stat exceeds the launcher limit",
            ));
        }
        let text = std::str::from_utf8(&text).map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidData, "invalid process stat encoding")
        })?;
        let fields = text
            .rfind(')')
            .map(|close| text[close + 1..].trim_start())
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidData, "invalid process stat format")
            })?
            .split_ascii_whitespace()
            .collect::<Vec<_>>();
        fields
            .get(19)
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    "process stat is missing its start time",
                )
            })?
            .parse::<u64>()
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid process start time"))
    }

    fn record_is_stale(pid: libc::pid_t, stored: &StoredAttestation) -> Result<bool, String> {
        match process_start(pid) {
            Ok(start) => Ok(start != stored.value.child_start),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(true),
            Err(error) => Err(format!("cannot verify attested PID {pid}: {error}")),
        }
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
        let stat_text = process_bytes(&format!("/proc/{pid}/stat"), 4096)?;
        let stat_text =
            std::str::from_utf8(&stat_text).map_err(|_| "invalid process stat encoding")?;
        let close = stat_text
            .rfind(')')
            .ok_or_else(|| "invalid process stat format".to_owned())?;
        let reported_pid = stat_text[..close]
            .split_ascii_whitespace()
            .next()
            .ok_or_else(|| "invalid process stat PID".to_owned())?
            .parse::<libc::pid_t>()
            .map_err(|_| "invalid process stat PID".to_owned())?;
        let stat_fields = stat_text[close + 1..]
            .split_ascii_whitespace()
            .collect::<Vec<_>>();
        if reported_pid != pid || stat_fields.len() <= 19 {
            return Err("process stat does not match the requested PID".to_owned());
        }
        let state = stat_fields[0]
            .as_bytes()
            .first()
            .copied()
            .ok_or_else(|| "invalid process state".to_owned())?;
        let parent = stat_fields[1]
            .parse::<libc::pid_t>()
            .map_err(|_| "invalid process parent PID".to_owned())?;
        let start = stat_fields[19]
            .parse::<u64>()
            .map_err(|_| "invalid process start time".to_owned())?;
        let status = process_bytes(&format!("/proc/{pid}/status"), 8192)?;
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
        if status_pid != pid || status_parent != parent {
            return Err("process status changed while reading identity".to_owned());
        }
        Ok(ProcessInfo {
            pid,
            parent,
            start,
            state,
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
        Ok(info.start)
    }

    fn number(value: &str) -> Result<u64, String> {
        if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err("invalid attestation number".to_owned());
        }
        value
            .parse::<u64>()
            .map_err(|_| "attestation number is out of range".to_owned())
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
        if pid <= 0 {
            return Err("PID must be positive".to_owned());
        }
        CString::new(pid.to_string()).map_err(|_| "invalid PID filename".to_owned())
    }

    fn read_fd(fd: RawFd, maximum: usize) -> Result<Vec<u8>, String> {
        let mut bytes = vec![0; maximum + 1];
        let mut used = 0;
        while used < bytes.len() {
            // SAFETY: the output slice is writable and fd is open.
            let count =
                unsafe { libc::read(fd, bytes[used..].as_mut_ptr().cast(), bytes.len() - used) };
            if count < 0 {
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(format!("read launch attestation: {error}"));
            }
            if count == 0 {
                bytes.truncate(used);
                return Ok(bytes);
            }
            used += count as usize;
        }
        Err("launch attestation exceeds the launcher limit".to_owned())
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
        if stat.st_uid != 0
            || stat.st_mode & libc::S_IFMT != libc::S_IFREG
            || stat.st_mode & 0o7777 != 0o600
            || stat.st_nlink != 1
        {
            return Err(
                "launch attestation must be a root-owned mode-0600 regular file".to_owned(),
            );
        }
        let bytes = read_fd(fd.as_raw_fd(), MAX_RECORD_BYTES)?;
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

    fn lock_directory(dirfd: RawFd) -> Result<OwnedFd, String> {
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
        if stat.st_uid != 0
            || stat.st_gid != 0
            || stat.st_mode & libc::S_IFMT != libc::S_IFREG
            || stat.st_mode & 0o7777 != 0o600
            || stat.st_nlink != 1
        {
            return Err("attestation lock must be a root-owned mode-0600 regular file".to_owned());
        }
        // SAFETY: flock only operates on the open lock descriptor.
        if unsafe { libc::flock(fd.as_raw_fd(), libc::LOCK_EX) } != 0 {
            return Err(last_error("lock attestation directory"));
        }
        Ok(fd)
    }

    fn directory_entries(dirfd: RawFd) -> Result<Vec<libc::pid_t>, String> {
        // SAFETY: dup returns a new descriptor for the open directory.
        let duplicate = owned_fd(
            unsafe { libc::fcntl(dirfd, libc::F_DUPFD_CLOEXEC, 6) },
            "duplicate attestation directory",
        )?;
        // SAFETY: fdopendir takes ownership of the duplicate descriptor on success.
        let duplicate = duplicate.into_raw_fd();
        let stream = unsafe { libc::fdopendir(duplicate) };
        if stream.is_null() {
            let error = last_error("read attestation directory");
            // SAFETY: fdopendir did not take ownership on failure.
            unsafe { libc::close(duplicate) };
            return Err(error);
        }
        let mut pids = Vec::new();
        let mut entries = 0;
        loop {
            // SAFETY: errno is thread-local and writable on Linux targets.
            unsafe { *libc::__errno_location() = 0 };
            // SAFETY: stream is a valid DIR pointer owned by duplicate.
            let entry = unsafe { libc::readdir(stream) };
            if entry.is_null() {
                // SAFETY: errno is thread-local and writable on Linux targets.
                let error = unsafe { *libc::__errno_location() };
                // SAFETY: stream remains valid and is closed exactly once here.
                unsafe { libc::closedir(stream) };
                if error != 0 {
                    return Err(io::Error::from_raw_os_error(error).to_string());
                }
                break;
            }
            entries += 1;
            if entries > MAX_RECORDS + 3 {
                // SAFETY: stream remains valid and is closed exactly once here.
                unsafe { libc::closedir(stream) };
                return Err("attestation directory exceeds the record limit".to_owned());
            }
            // SAFETY: d_name is a nul-terminated directory entry name.
            let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
            if name == b"." || name == b".." || name == b".lock" {
                continue;
            }
            if name.is_empty() || !name.iter().all(u8::is_ascii_digit) {
                // SAFETY: stream remains valid and is closed exactly once here.
                unsafe { libc::closedir(stream) };
                return Err("attestation directory contains an unexpected entry".to_owned());
            }
            let Ok(text) = std::str::from_utf8(name) else {
                // SAFETY: stream remains valid and is closed exactly once here.
                unsafe { libc::closedir(stream) };
                return Err("invalid attestation filename".to_owned());
            };
            let Ok(pid) = text.parse::<libc::pid_t>() else {
                // SAFETY: stream remains valid and is closed exactly once here.
                unsafe { libc::closedir(stream) };
                return Err("invalid attestation filename".to_owned());
            };
            if pid <= 0 || pids.len() == MAX_RECORDS {
                // SAFETY: stream remains valid and is closed exactly once here.
                unsafe { libc::closedir(stream) };
                return Err("attestation directory exceeds the record limit".to_owned());
            }
            pids.push(pid);
        }
        Ok(pids)
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
            || current.st_uid != 0
            || current.st_mode & libc::S_IFMT != libc::S_IFREG
            || current.st_mode & 0o7777 != 0o600
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

    fn sweep_stale_records(dirfd: RawFd) -> Result<(), String> {
        let _lock = lock_directory(dirfd)?;
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
        let _lock = lock_directory(dirfd)?;
        for pid in directory_entries(dirfd)? {
            let Some(stored) = read_record_at(dirfd, pid)? else {
                continue;
            };
            if record_is_stale(pid, &stored)? {
                unlink_record(dirfd, pid, &stored)?;
            }
        }
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

    fn duplicate_to_slots(
        executable: RawFd,
        directory: RawFd,
        pid: libc::pid_t,
    ) -> Result<(), String> {
        // SAFETY: F_DUPFD_CLOEXEC returns fresh descriptors above the fixed launcher slots.
        let executable = match owned_fd(
            unsafe { libc::fcntl(executable, libc::F_DUPFD_CLOEXEC, 6) },
            "duplicate sidecar executable",
        ) {
            Ok(executable) => executable,
            Err(error) => {
                remove_created_record(directory, pid);
                return Err(error);
            }
        };
        // SAFETY: F_DUPFD_CLOEXEC returns a fresh directory descriptor above the fixed slots.
        let directory = match owned_fd(
            unsafe { libc::fcntl(directory, libc::F_DUPFD_CLOEXEC, 6) },
            "duplicate attestation directory",
        ) {
            Ok(directory) => directory,
            Err(error) => {
                remove_created_record(directory, pid);
                return Err(error);
            }
        };
        // SAFETY: dup3 replaces only the reserved executable descriptor and keeps it close-on-exec.
        if unsafe { libc::dup3(executable.as_raw_fd(), EXECUTABLE_FD, libc::O_CLOEXEC) } < 0 {
            let error = last_error("prepare sidecar executable descriptor");
            remove_created_record(directory.as_raw_fd(), pid);
            return Err(error);
        }
        // SAFETY: dup3 replaces only the reserved attestation descriptor and keeps it close-on-exec.
        if unsafe { libc::dup3(directory.as_raw_fd(), ATTESTATION_FD, libc::O_CLOEXEC) } < 0 {
            let error = last_error("prepare attestation descriptor");
            remove_created_record(directory.as_raw_fd(), pid);
            return Err(error);
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
            "10000".to_owned(),
            "--max-rss".to_owned(),
            config.max_rss.to_string(),
            "--grace-ms".to_owned(),
            "2000".to_owned(),
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
        let (executable, (executable_dev, executable_ino)) = open_sidecar()?;
        let child_pid = unsafe { libc::getpid() };
        let child_start = process_start(child_pid).map_err(|error| error.to_string())?;
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
        let (uids, _) = credentials()?;
        if uids != [BACKEND_UID, 0, 0] || unsafe { libc::getppid() } != caller_pid {
            remove_created_record(directory.as_raw_fd(), child_pid);
            return Err("launcher identity changed before sidecar exec".to_owned());
        }
        duplicate_to_slots(executable.as_raw_fd(), directory.as_raw_fd(), child_pid)?;
        if let Err(error) = close_unrelated_descriptors() {
            remove_created_record(ATTESTATION_FD, child_pid);
            return Err(error);
        }
        if let Err(error) = drop_privileges() {
            remove_created_record(ATTESTATION_FD, child_pid);
            return Err(error);
        }
        let mut pointers = values
            .iter()
            .map(|value| value.as_ptr())
            .collect::<Vec<_>>();
        pointers.push(std::ptr::null());
        let environment: [*const libc::c_char; 1] = [std::ptr::null()];
        // SAFETY: fd 4 is the verified fixed ELF executable; argv and the empty environment are nul-terminated.
        let result = unsafe {
            libc::syscall(
                libc::SYS_execveat,
                EXECUTABLE_FD,
                c"".as_ptr(),
                pointers.as_ptr(),
                environment.as_ptr(),
                libc::AT_EMPTY_PATH,
            )
        };
        if result != 0 {
            remove_created_record(ATTESTATION_FD, child_pid);
            return Err(last_error("execute fixed sidecar"));
        }
        unreachable!("execveat replaces the launcher process")
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
            || stored.value.caller_start != caller.start
        {
            return Err("exited target attestation does not match its backend caller".to_owned());
        }
        match process_start(pid) {
            Ok(start) if start == stored.value.child_start => {
                unlink_record(directory.as_raw_fd(), pid, &stored)?;
            }
            Ok(_) => return Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                unlink_record(directory.as_raw_fd(), pid, &stored)?;
            }
            Err(error) => return Err(format!("cannot verify exited target PID {pid}: {error}")),
        }
        Ok(())
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
        if target.pid != pid
            || target.parent != caller_pid
            || target.uids != [SIDECAR_UID; 4]
            || target.gids != [SIDECAR_GID; 4]
            || target.start != record.child_start
            || record.child_pid != pid
            || record.caller_pid != caller_pid
        {
            return Err(
                "target process identity does not match the launcher attestation".to_owned(),
            );
        }
        let caller = process_info(caller_pid)?;
        if !is_backend(&caller)
            || caller.start != record.caller_start
            || unsafe { libc::getppid() } != caller_pid
        {
            return Err(
                "target parent identity does not match the launcher attestation".to_owned(),
            );
        }
        verify_launcher()?;
        let (executable, identity) = open_sidecar()?;
        drop(executable);
        if identity != (record.executable_dev, record.executable_ino)
            || EXECUTABLE_PATH.to_bytes() != b"/home/ryot/sandboxd/ryot-sandboxd"
        {
            return Err("target executable identity does not match the fixed sidecar".to_owned());
        }
        if target.state == b'Z' || target.state == b'X' {
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

        #[test]
        fn launch_injects_fixed_paths_and_lifecycle_limits() {
            let config = parse_launch(
                &[
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
                .map(str::to_owned),
            )
            .expect("valid launch configuration");
            let values = arguments(&config).expect("sidecar arguments");
            let actual = values
                .iter()
                .map(|value| value.to_str().expect("UTF-8 argument"))
                .collect::<Vec<_>>();
            assert_eq!(
                actual,
                [
                    "/home/ryot/sandboxd/ryot-sandboxd",
                    "--generation",
                    "9",
                    "--snapshots",
                    "/home/ryot/sandboxd/snapshots",
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
                    "--max-executions",
                    "10000",
                    "--max-rss",
                    "16384",
                    "--grace-ms",
                    "2000",
                ]
            );
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
