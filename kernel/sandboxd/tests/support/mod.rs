#![allow(dead_code)]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

use ryot_sandboxd::protocol::{
    Assembled, Assembly, ChunkedType, HostOutcome, Inbound, Lane, LimitKind, Limits, Module,
    Outbound, Outcome, PART_BYTES, Phase, Run, Tier, decode_outbound, encode_inbound, frame,
    read_frame, split,
};
use serde_json::Value;
use serde_json::value::RawValue;
use sha2::{Digest, Sha256};

pub const GENERATION: u32 = 1;
const MIB: u64 = 1024 * 1024;

pub fn snapshots() -> &'static str {
    env!("OUT_DIR")
}

pub fn limits() -> Limits {
    Limits {
        cpu_ms: 5_000,
        heap_bytes: 64 * MIB,
        deadline_ms: 10_000,
        external_bytes: 32 * MIB,
    }
}

pub fn module(source: &str) -> Module {
    Module {
        sha256: format!("{:x}", Sha256::digest(source.as_bytes())),
        source: source.to_owned(),
    }
}

pub fn raw(value: Value) -> Box<RawValue> {
    RawValue::from_string(value.to_string()).expect("json")
}

pub fn run_frame(handle: &str, tier: Tier, source: &str, input: Value, limits: Limits) -> Inbound {
    Inbound::Run(Box::new(Run::new(
        GENERATION,
        handle.to_owned(),
        tier,
        Lane::Interactive,
        raw(input),
        module(source),
        limits,
    )))
}

pub struct Sidecar {
    pub child: Child,
    pub drained: Option<ryot_sandboxd::protocol::DrainReason>,
    socket: UnixStream,
    assemblies: HashMap<(String, u64, ChunkedType), Assembly>,
}

pub struct Done {
    pub outcome: Outcome,
    pub console: ryot_sandboxd::protocol::Console,
}

impl Done {
    pub fn value(&self) -> Value {
        match &self.outcome {
            Outcome::Completed(value) => serde_json::from_str(value.get()).expect("json"),
            other => panic!("expected completion, got {other:?}"),
        }
    }

    pub fn failure(&self) -> (Phase, &str) {
        match &self.outcome {
            Outcome::Failed(phase, message) => (*phase, message),
            other => panic!("expected failure, got {other:?}"),
        }
    }

    pub fn limit(&self) -> LimitKind {
        match &self.outcome {
            Outcome::Limit(limit, _) => *limit,
            other => panic!("expected a limit, got {other:?}"),
        }
    }
}

pub fn tier_name(tier: Tier) -> &'static str {
    match tier {
        Tier::Core => "core",
        Tier::Data => "data",
        Tier::Full => "full",
    }
}

pub fn command(tier: Tier, extra: &[&str]) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_ryot-sandboxd"));
    command
        .args([
            "--generation",
            &GENERATION.to_string(),
            "--snapshots",
            snapshots(),
        ])
        .args(["--tier", tier_name(tier)])
        .args(extra)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    command
}

pub fn attach(mut command: Command) -> Sidecar {
    let (ours, theirs) = UnixStream::pair().expect("socketpair");
    ours.set_read_timeout(Some(Duration::from_secs(60)))
        .expect("timeout");
    let fd = theirs.as_raw_fd();
    // SAFETY: dup2 and fcntl are async-signal-safe; they only rewire the child's descriptors.
    unsafe {
        command.pre_exec(move || {
            if libc::dup2(fd, 3) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let child = command.spawn().expect("spawn sidecar");
    drop(theirs);
    let mut sidecar = Sidecar {
        child,
        drained: None,
        socket: ours,
        assemblies: HashMap::new(),
    };
    match sidecar.try_recv() {
        Some(Outbound::Ready { generation }) => assert_eq!(generation, GENERATION),
        Some(other) => panic!("expected ready, got {other:?}"),
        None => panic!(
            "sidecar exited before ready: {:?} {}",
            sidecar.wait(Duration::from_secs(5)),
            sidecar.stderr()
        ),
    }
    sidecar
}

pub fn spawn(tier: Tier, extra: &[&str]) -> Sidecar {
    attach(command(tier, extra))
}

impl Sidecar {
    pub fn raw_socket(&self) -> &UnixStream {
        &self.socket
    }

    pub fn write_raw(&mut self, bytes: &[u8]) {
        self.socket.write_all(bytes).expect("write");
    }

    pub fn send(&mut self, frame_value: &Inbound) {
        let payload = encode_inbound(frame_value);
        if payload.len() <= PART_BYTES {
            self.write_raw(&frame(&payload));
            return;
        }
        let (handle, seq, frame_type) = match frame_value {
            Inbound::Run(run) => (run.handle.clone(), 0, ChunkedType::Run),
            Inbound::HostResult { handle, seq, .. } => {
                (handle.clone(), *seq, ChunkedType::HostResult)
            }
            _ => panic!("only runs and host results are chunked"),
        };
        for part in split(GENERATION, &handle, seq, frame_type, &payload) {
            self.write_raw(&frame(&encode_inbound(&Inbound::Part(part))));
        }
    }

    pub fn try_recv(&mut self) -> Option<Outbound> {
        loop {
            let payload = read_frame(&mut self.socket).ok()??;
            match decode_outbound(&payload).expect("valid outbound frame") {
                Outbound::Part(part) => {
                    let key = (part.handle.clone(), part.seq, part.frame_type);
                    if part.index == 0 {
                        self.assemblies
                            .insert(key.clone(), Assembly::start(&part).expect("part"));
                    }
                    let assembly = self.assemblies.get_mut(&key).expect("assembly");
                    if let Assembled::Complete(bytes) = assembly.push(&part).expect("part") {
                        self.assemblies.remove(&key);
                        return Some(decode_outbound(&bytes).expect("assembled frame"));
                    }
                }
                frame_value => return Some(frame_value),
            }
        }
    }

    pub fn recv_within(&mut self, timeout: Duration) -> Option<Outbound> {
        self.socket
            .set_read_timeout(Some(timeout))
            .expect("timeout");
        let frame_value = self.try_recv();
        self.socket
            .set_read_timeout(Some(Duration::from_secs(60)))
            .expect("timeout");
        frame_value
    }

    /// Returns the drain reason, whether it arrived before or after the last done frame.
    pub fn drain_reason(&mut self) -> ryot_sandboxd::protocol::DrainReason {
        if let Some(reason) = self.drained {
            return reason;
        }
        match self.recv() {
            Outbound::Draining { reason, .. } => reason,
            other => panic!("expected draining, got {other:?}"),
        }
    }

    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    pub fn recv(&mut self) -> Outbound {
        self.try_recv().expect("sidecar closed the connection")
    }

    pub fn reply(&mut self, handle: &str, seq: u64, value: Value) {
        self.send(&Inbound::HostResult {
            generation: GENERATION,
            handle: handle.to_owned(),
            seq,
            outcome: HostOutcome::Success(raw(value)),
        });
    }

    pub fn finish(&mut self, handle: &str, mut host: impl FnMut(&str, Value) -> Value) -> Done {
        loop {
            match self.recv() {
                Outbound::HostCall {
                    handle: call_handle,
                    seq,
                    name,
                    args,
                    ..
                } if call_handle == handle => {
                    let value = host(&name, serde_json::from_str(args.get()).expect("args"));
                    self.reply(handle, seq, value);
                }
                Outbound::Done {
                    handle: done_handle,
                    outcome,
                    console,
                    ..
                } if done_handle == handle => return Done { outcome, console },
                Outbound::Draining { reason, .. } => self.drained = Some(reason),
                other => panic!("unexpected frame {other:?}"),
            }
        }
    }

    pub fn execute(&mut self, tier: Tier, source: &str, input: Value) -> Done {
        self.execute_with(tier, source, input, limits())
    }

    pub fn execute_with(&mut self, tier: Tier, source: &str, input: Value, limits: Limits) -> Done {
        let handle = format!("h{:x}", rand_suffix());
        self.send(&run_frame(&handle, tier, source, input, limits));
        self.finish(&handle, |name, _| panic!("unexpected host call {name}"))
    }

    pub fn wait(&mut self, timeout: Duration) -> Option<ExitStatus> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if let Some(status) = self.child.try_wait().expect("wait") {
                return Some(status);
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        None
    }

    pub fn stderr(&mut self) -> String {
        let mut text = String::new();
        if let Some(stderr) = self.child.stderr.as_mut() {
            stderr.read_to_string(&mut text).ok();
        }
        text
    }

    pub fn close(mut self) -> ExitStatus {
        self.socket.shutdown(std::net::Shutdown::Both).ok();
        self.wait(Duration::from_secs(10))
            .expect("sidecar exits after close")
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.child.kill().ok();
        self.child.wait().ok();
    }
}

fn rand_suffix() -> u128 {
    let mut bytes = [0_u8; 8];
    getrandom::fill(&mut bytes).expect("random");
    u128::from(u64::from_le_bytes(bytes))
}
