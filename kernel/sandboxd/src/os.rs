use std::time::Duration;

#[derive(Clone, Copy)]
pub struct ThreadClock(
    #[cfg(target_os = "linux")] libc::clockid_t,
    #[cfg(target_os = "macos")] libc::mach_port_t,
);

impl ThreadClock {
    pub fn current() -> Self {
        #[cfg(target_os = "linux")]
        {
            let mut clock: libc::clockid_t = 0;
            // SAFETY: pthread_self is always a valid thread handle for the calling thread.
            let result = unsafe { libc::pthread_getcpuclockid(libc::pthread_self(), &mut clock) };
            assert_eq!(result, 0, "pthread_getcpuclockid failed");
            Self(clock)
        }
        #[cfg(target_os = "macos")]
        {
            // SAFETY: pthread_self is always a valid thread handle for the calling thread.
            Self(unsafe { libc::pthread_mach_thread_np(libc::pthread_self()) })
        }
    }

    pub fn elapsed(self) -> Duration {
        #[cfg(target_os = "linux")]
        {
            let mut time = libc::timespec {
                tv_sec: 0,
                tv_nsec: 0,
            };
            // SAFETY: the clock id belongs to a pooled worker thread that outlives every reader.
            unsafe { libc::clock_gettime(self.0, &mut time) };
            Duration::new(time.tv_sec as u64, time.tv_nsec as u32)
        }
        #[cfg(target_os = "macos")]
        {
            // SAFETY: zeroed thread_basic_info is a valid output buffer for thread_info.
            let mut info: libc::thread_basic_info = unsafe { std::mem::zeroed() };
            let mut count = (size_of::<libc::thread_basic_info>() / size_of::<libc::integer_t>())
                as libc::mach_msg_type_number_t;
            // SAFETY: the port names a pooled worker thread that outlives every reader.
            unsafe {
                libc::thread_info(
                    self.0,
                    libc::THREAD_BASIC_INFO as libc::thread_flavor_t,
                    (&raw mut info).cast(),
                    &mut count,
                )
            };
            let micros = |time: libc::time_value_t| {
                time.seconds as u64 * 1_000_000 + time.microseconds as u64
            };
            Duration::from_micros(micros(info.user_time) + micros(info.system_time))
        }
    }
}

pub fn lower_thread_priority() {
    #[cfg(target_os = "linux")]
    // SAFETY: setpriority on the calling thread id has no memory-safety preconditions.
    unsafe {
        libc::setpriority(libc::PRIO_PROCESS, libc::gettid() as libc::id_t, 10);
    }
    #[cfg(target_os = "macos")]
    // SAFETY: PRIO_DARWIN_THREAD with id 0 targets the calling thread.
    unsafe {
        libc::setpriority(libc::PRIO_DARWIN_THREAD, 0, libc::PRIO_DARWIN_BG);
    }
}

#[cfg(target_os = "linux")]
pub struct ResidentMemory(std::fs::File);

#[cfg(target_os = "macos")]
pub struct ResidentMemory;

impl ResidentMemory {
    pub fn open() -> std::io::Result<Self> {
        #[cfg(target_os = "linux")]
        {
            std::fs::File::open("/proc/self/statm").map(Self)
        }
        #[cfg(target_os = "macos")]
        {
            Ok(Self)
        }
    }

    pub fn bytes(&self) -> u64 {
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::fs::FileExt;
            let mut buffer = [0_u8; 128];
            let length = self.0.read_at(&mut buffer, 0).unwrap_or(0);
            let pages = std::str::from_utf8(&buffer[..length])
                .ok()
                .and_then(|text| text.split_whitespace().nth(1))
                .and_then(|pages| pages.parse::<u64>().ok())
                .unwrap_or(0);
            // SAFETY: sysconf has no memory-safety preconditions.
            pages * unsafe { libc::sysconf(libc::_SC_PAGESIZE) } as u64
        }
        #[cfg(target_os = "macos")]
        {
            // SAFETY: zeroed proc_taskinfo is a valid output buffer of the size passed.
            let mut info: libc::proc_taskinfo = unsafe { std::mem::zeroed() };
            // SAFETY: the buffer pointer and size describe `info`.
            unsafe {
                libc::proc_pidinfo(
                    libc::getpid(),
                    libc::PROC_PIDTASKINFO,
                    0,
                    (&raw mut info).cast(),
                    size_of::<libc::proc_taskinfo>() as libc::c_int,
                )
            };
            info.pti_resident_size
        }
    }
}
