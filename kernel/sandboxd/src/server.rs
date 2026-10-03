use std::collections::HashMap;
use std::io::Read;
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{Receiver, SyncSender, sync_channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use deno_core::futures::executor::block_on;
use tokio::sync::Semaphore;

use crate::admission::MemoryBudget;
use crate::config::Config;
use crate::execute::{Executor, HEAP_HEADROOM_BYTES, set_escalation, set_running};
use crate::os::{ResidentMemory, lower_thread_priority};
use crate::outbox::Outbox;
use crate::protocol::{
    Assembled, Assembly, ChunkedType, Console, DrainReason, FramingError, Inbound, Lane, Outbound,
    Outcome, Phase, Run, Usage, decode_inbound, inbound_type, read_frame, valid_handle,
};
use crate::registry::{Entry, Registry};
use crate::snapshots::Snapshot;
use crate::watchdog;

pub const EXIT_DESYNC: i32 = 65;
pub const EXIT_ESCALATED: i32 = 70;
const WORKER_STACK: usize = 8 * 1024 * 1024;
const ASSEMBLY_BYTES: usize = 64 * 1024 * 1024;
const FLUSH_TIMEOUT: Duration = Duration::from_secs(1);

struct Job {
    run: Box<Run>,
    entry: Arc<Entry>,
}

struct Shared {
    config: Config,
    outbox: Outbox,
    registry: Registry,
    budget: MemoryBudget,
    resident: ResidentMemory,
    draining: AtomicBool,
    escalated: AtomicBool,
    in_flight: AtomicUsize,
    completed: AtomicU64,
}

impl Shared {
    fn send_done(&self, handle: &str, outcome: Outcome, console: Console, usage: Usage) {
        let message = Outbound::Done {
            generation: self.config.generation,
            handle: handle.to_owned(),
            seq: 0,
            outcome,
            console,
            usage,
        };
        block_on(self.outbox.send(
            self.config.generation,
            handle,
            0,
            ChunkedType::Done,
            &message,
        ));
    }

    fn finish(&self, handle: &str, outcome: Outcome, console: Console, usage: Usage) {
        self.registry.retire(handle);
        self.send_done(handle, outcome, console, usage);
        self.outbox.release(handle);
        let completed = self.completed.fetch_add(1, Ordering::SeqCst) + 1;
        if completed >= self.config.max_executions {
            self.drain(DrainReason::Executions);
        } else if self.resident.bytes() >= self.config.max_rss {
            self.drain(DrainReason::Memory);
        }
        if self.in_flight.fetch_sub(1, Ordering::SeqCst) == 1 {
            self.exit_if_drained();
        }
    }

    fn drain(&self, reason: DrainReason) {
        if !self.draining.swap(true, Ordering::SeqCst) {
            self.outbox.control(&Outbound::Draining {
                generation: self.config.generation,
                reason,
            });
        }
    }

    fn exit_if_drained(&self) {
        if self.draining.load(Ordering::SeqCst) && self.in_flight.load(Ordering::SeqCst) == 0 {
            self.outbox.drain(FLUSH_TIMEOUT);
            std::process::exit(self.exit_status(0));
        }
    }

    fn exit_status(&self, code: i32) -> i32 {
        if self.escalated.load(Ordering::SeqCst) {
            EXIT_ESCALATED
        } else {
            code
        }
    }

    fn escalate(&self, handle: &str) -> ! {
        self.escalated.store(true, Ordering::SeqCst);
        let ticket = self.outbox.control(&Outbound::Fatal {
            generation: self.config.generation,
            handle: handle.to_owned(),
        });
        self.outbox.flush_control(ticket, FLUSH_TIMEOUT);
        eprintln!("ryot-sandboxd: execution {handle} requires process exit");
        std::process::exit(EXIT_ESCALATED);
    }
}

fn spawn_workers(
    shared: &Arc<Shared>,
    executor: impl Fn() -> Executor,
    lane: Lane,
    receiver: Receiver<Job>,
) {
    let receiver = Arc::new(Mutex::new(receiver));
    for index in 0..shared.config.threads {
        let shared = shared.clone();
        let receiver = receiver.clone();
        let executor = executor();
        std::thread::Builder::new()
            .name(format!("{lane:?}-{index}").to_lowercase())
            .stack_size(WORKER_STACK)
            .spawn(move || {
                if lane == Lane::Background {
                    lower_thread_priority();
                }
                loop {
                    let Ok(Job { run, entry }) = receiver.lock().expect("lane queue").recv() else {
                        return;
                    };
                    set_running(Some(entry.handle.clone()));
                    let reserve = run.limits.heap_bytes
                        + HEAP_HEADROOM_BYTES
                        + run.limits.external_bytes
                        + (run.module.source.len() + run.input.get().len()) as u64;
                    let (outcome, console, usage) = match shared.budget.reserve(reserve) {
                        None => (
                            Outcome::Failed(
                                Phase::Admission,
                                format!(
                                    "execution needs {reserve} bytes, more than the memory budget"
                                ),
                            ),
                            Console::default(),
                            Usage::default(),
                        ),
                        Some(_reservation) if entry.state().cancelled => {
                            (Outcome::Cancelled, Console::default(), Usage::default())
                        }
                        Some(_reservation) => executor.execute(&run, &entry),
                    };
                    shared.finish(&entry.handle, outcome, console, usage);
                    set_running(None);
                }
            })
            .expect("spawn worker");
    }
}

struct Reader {
    shared: Arc<Shared>,
    lanes: [SyncSender<Job>; 2],
    assemblies: HashMap<(String, u64, ChunkedType), Assembly>,
    assembled_bytes: usize,
}

impl Reader {
    fn reject_run(&self, handle: &str, message: String) {
        if !self.shared.registry.claim(handle) {
            return;
        }
        self.shared.in_flight.fetch_add(1, Ordering::SeqCst);
        self.shared.finish(
            handle,
            Outcome::Failed(Phase::Protocol, message),
            Console::default(),
            Usage::default(),
        );
    }

    /// A well-framed but invalid frame fails only the execution it names, and only when it is a
    /// run the sidecar has not seen; anything else is dropped.
    fn reject(&self, payload: &[u8], message: String) {
        let Ok(value) = serde_json::from_slice::<serde_json::Value>(payload) else {
            return;
        };
        let names_run =
            value["type"] == "run" || (value["type"] == "part" && value["frameType"] == "run");
        let generation =
            value["generation"].as_u64() == Some(u64::from(self.shared.config.generation));
        if let (true, true, Some(handle)) = (names_run, generation, value["handle"].as_str())
            && valid_handle(handle)
        {
            self.reject_run(handle, message);
        }
    }

    fn submit(&self, run: Box<Run>) {
        let entry = Arc::new(Entry::new(run.handle.clone(), run.limits.clone()));
        if !self.shared.registry.admit(entry.clone()) {
            return;
        }
        self.shared.in_flight.fetch_add(1, Ordering::SeqCst);
        if run.tier != self.shared.config.tier {
            self.shared.finish(
                &run.handle,
                Outcome::Failed(
                    Phase::Admission,
                    format!("this sidecar serves the {:?} tier", self.shared.config.tier)
                        .to_lowercase(),
                ),
                Console::default(),
                Usage::default(),
            );
            return;
        }
        if self.shared.draining.load(Ordering::SeqCst) {
            self.shared.finish(
                &run.handle,
                Outcome::Failed(Phase::Admission, "sidecar is draining".to_owned()),
                Console::default(),
                Usage::default(),
            );
            return;
        }
        let lane = match run.lane {
            Lane::Interactive => &self.lanes[0],
            Lane::Background => &self.lanes[1],
        };
        lane.send(Job { run, entry })
            .expect("lane workers stay alive");
    }

    fn assemble(&mut self, part: crate::protocol::Part) -> Result<Option<Vec<u8>>, String> {
        let key = (part.handle.clone(), part.seq, part.frame_type);
        if part.index == 0 {
            if self.assemblies.contains_key(&key) {
                return Err("chunked frame restarted before it completed".to_owned());
            }
            let assembly = Assembly::start(&part).map_err(|error| error.0)?;
            if self.assembled_bytes + assembly.reserved() > ASSEMBLY_BYTES {
                return Err("too many chunked frames in flight".to_owned());
            }
            self.assembled_bytes += assembly.reserved();
            self.assemblies.insert(key.clone(), assembly);
        }
        let Some(assembly) = self.assemblies.get_mut(&key) else {
            return Err("part does not continue a chunked frame".to_owned());
        };
        let pushed = assembly.push(&part);
        if !matches!(pushed, Ok(Assembled::Pending)) {
            let assembly = self.assemblies.remove(&key).expect("assembly");
            self.assembled_bytes -= assembly.reserved();
        }
        match pushed.map_err(|error| error.0)? {
            Assembled::Pending => Ok(None),
            Assembled::Complete(bytes) => Ok(Some(bytes)),
        }
    }

    fn dispatch(&mut self, frame: Inbound) {
        let generation = match &frame {
            Inbound::Run(run) => run.generation,
            Inbound::HostResult { generation, .. } | Inbound::Cancel { generation, .. } => {
                *generation
            }
            Inbound::Part(part) => part.generation,
        };
        if generation != self.shared.config.generation {
            return;
        }
        match frame {
            Inbound::Run(run) => self.submit(run),
            Inbound::HostResult {
                handle,
                seq,
                outcome,
                ..
            } => {
                if let Some(entry) = self.shared.registry.get(&handle) {
                    entry.deliver(seq, outcome);
                }
            }
            Inbound::Cancel { handle, .. } => {
                if let Some(entry) = self.shared.registry.get(&handle) {
                    entry.cancel();
                }
            }
            Inbound::Part(part) => {
                let (handle, seq, frame_type) = (part.handle.clone(), part.seq, part.frame_type);
                let rejected = |reader: &Self, message: String| {
                    if frame_type == ChunkedType::Run {
                        reader.reject_run(&handle, message);
                    }
                };
                match self.assemble(part) {
                    Ok(None) => {}
                    Ok(Some(bytes)) => match decode_inbound(bytes) {
                        Ok(inner) if inbound_type(&inner) == Some(frame_type) => {
                            let matches = match &inner {
                                Inbound::Run(run) => run.handle == handle && run.seq == seq,
                                Inbound::HostResult {
                                    handle: inner_handle,
                                    seq: inner_seq,
                                    ..
                                } => *inner_handle == handle && *inner_seq == seq,
                                _ => false,
                            };
                            if matches {
                                self.dispatch(inner);
                            } else {
                                rejected(self, "chunked frame does not match its parts".to_owned());
                            }
                        }
                        Ok(_) => rejected(self, "chunked frame has the wrong type".to_owned()),
                        Err(rejection) => rejected(self, rejection.error.0),
                    },
                    Err(message) => rejected(self, message),
                }
            }
        }
    }

    fn run(mut self, mut socket: impl Read) -> i32 {
        loop {
            match read_frame(&mut socket) {
                Ok(None) => return self.shared.exit_status(0),
                Ok(Some(payload)) => match decode_inbound(payload) {
                    Ok(frame) => self.dispatch(frame),
                    Err(rejection) => self.reject(&rejection.payload, rejection.error.0),
                },
                Err(error) => {
                    let detail = match error {
                        FramingError::Length(length) => format!("frame length {length}"),
                        FramingError::Truncated => "truncated frame".to_owned(),
                        FramingError::Io(error) => error,
                    };
                    eprintln!("ryot-sandboxd: protocol desync: {detail}");
                    return self.shared.exit_status(EXIT_DESYNC);
                }
            }
        }
    }
}

pub fn serve(
    config: Config,
    snapshot: Snapshot,
    resident: ResidentMemory,
    socket: UnixStream,
) -> i32 {
    let outbox = Outbox::default();
    let writer = socket.try_clone().expect("clone socket");
    {
        let outbox = outbox.clone();
        std::thread::Builder::new()
            .name("writer".to_owned())
            .spawn(move || outbox.run_writer(writer))
            .expect("spawn writer");
    }
    let cpu = Arc::new(Semaphore::new(config.max_active));
    let snapshot = Arc::new(snapshot);
    let shared = Arc::new(Shared {
        budget: MemoryBudget::new(config.memory_budget),
        config,
        outbox: outbox.clone(),
        registry: Registry::default(),
        resident,
        draining: AtomicBool::new(false),
        escalated: AtomicBool::new(false),
        in_flight: AtomicUsize::new(0),
        completed: AtomicU64::new(0),
    });
    let executor = || {
        Executor::new(
            shared.config.generation,
            shared.config.user_tier,
            snapshot.clone(),
            outbox.clone(),
            cpu.clone(),
        )
    };
    {
        let shared = shared.clone();
        set_escalation(move |handle| shared.escalate(handle));
    }
    let (interactive, interactive_jobs) = sync_channel(shared.config.queue);
    let (background, background_jobs) = sync_channel(shared.config.queue);
    spawn_workers(&shared, executor, Lane::Interactive, interactive_jobs);
    spawn_workers(&shared, executor, Lane::Background, background_jobs);
    {
        let shared = shared.clone();
        std::thread::Builder::new()
            .name("watchdog".to_owned())
            .spawn(move || {
                let registry = shared.registry.clone();
                watchdog::run(registry, shared.config.grace, |entry| {
                    shared.escalate(&entry.handle)
                });
            })
            .expect("spawn watchdog");
    }
    outbox.control(&Outbound::Ready {
        generation: shared.config.generation,
        heap_headroom_bytes: HEAP_HEADROOM_BYTES,
    });
    let reader = Reader {
        shared,
        lanes: [interactive, background],
        assemblies: HashMap::new(),
        assembled_bytes: 0,
    };
    reader.run(socket)
}
