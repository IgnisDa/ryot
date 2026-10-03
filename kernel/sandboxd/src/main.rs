use std::os::fd::FromRawFd;
use std::os::unix::net::UnixStream;

use ryot_sandboxd::config::Config;
use ryot_sandboxd::os::ResidentMemory;
use ryot_sandboxd::snapshots::Snapshot;
use ryot_sandboxd::{init_v8, server};

const SOCKET_FD: i32 = 3;
const EXIT_USAGE: i32 = 64;
const EXIT_SNAPSHOT: i32 = 66;
#[cfg(target_os = "linux")]
const EXIT_CONFINEMENT: i32 = 71;

fn fail(code: i32, message: &str) -> ! {
    eprintln!("ryot-sandboxd: {message}");
    std::process::exit(code);
}

fn main() {
    let config =
        Config::parse(std::env::args().skip(1)).unwrap_or_else(|error| fail(EXIT_USAGE, &error));

    #[cfg(target_os = "linux")]
    {
        if std::env::vars_os().next().is_some() {
            fail(EXIT_CONFINEMENT, "the environment must be empty");
        }
        ryot_sandboxd::confine::harden_process()
            .unwrap_or_else(|error| fail(EXIT_CONFINEMENT, &error));
    }

    let snapshot = Snapshot::load(&config.snapshots, config.tier)
        .unwrap_or_else(|error| fail(EXIT_SNAPSHOT, &error));

    // SAFETY: fstat only writes into the provided buffer.
    let is_socket = unsafe {
        let mut stat: libc::stat = std::mem::zeroed();
        libc::fstat(SOCKET_FD, &mut stat) == 0 && stat.st_mode & libc::S_IFMT == libc::S_IFSOCK
    };
    if !is_socket {
        fail(EXIT_USAGE, "descriptor 3 must be the inherited socket");
    }
    // SAFETY: descriptor 3 is an inherited socket that nothing else in the process owns.
    let socket = unsafe { UnixStream::from_raw_fd(SOCKET_FD) };

    let resident =
        ResidentMemory::open().unwrap_or_else(|error| fail(EXIT_USAGE, &error.to_string()));

    #[cfg(target_os = "linux")]
    ryot_sandboxd::confine::lock_down().unwrap_or_else(|error| fail(EXIT_CONFINEMENT, &error));

    init_v8();
    std::process::exit(server::serve(config, snapshot, resident, socket));
}
