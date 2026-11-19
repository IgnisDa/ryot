use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use crate::protocol::{ChunkedType, Outbound, PART_BYTES, encode_outbound, frame, split};

/// Frames an execution may have queued but not yet written before its sender waits.
const EXECUTION_QUEUE: usize = 8;

struct Chunk {
    bytes: Vec<u8>,
    permit: Option<OwnedSemaphorePermit>,
}

#[derive(Default)]
struct State {
    control: VecDeque<Vec<u8>>,
    order: VecDeque<String>,
    queues: HashMap<String, VecDeque<Chunk>>,
    written_control: u64,
    queued_control: u64,
    writing: bool,
    closed: bool,
}

struct Inner {
    state: Mutex<State>,
    ready: Condvar,
    flushed: Condvar,
    slots: Mutex<HashMap<String, Arc<Semaphore>>>,
}

/// Outbound frame scheduler. Each execution has its own bounded queue; the writer takes one
/// part at a time round-robin, so a large chunked frame never holds the connection.
#[derive(Clone)]
pub struct Outbox(Arc<Inner>);

impl Default for Outbox {
    fn default() -> Self {
        Self(Arc::new(Inner {
            state: Mutex::default(),
            ready: Condvar::new(),
            flushed: Condvar::new(),
            slots: Mutex::default(),
        }))
    }
}

impl Outbox {
    fn slots(&self, handle: &str) -> Arc<Semaphore> {
        self.0
            .slots
            .lock()
            .expect("outbox slots")
            .entry(handle.to_owned())
            .or_insert_with(|| Arc::new(Semaphore::new(EXECUTION_QUEUE)))
            .clone()
    }

    pub fn release(&self, handle: &str) {
        self.0.slots.lock().expect("outbox slots").remove(handle);
    }

    pub fn control(&self, message: &Outbound) -> u64 {
        let mut state = self.0.state.lock().expect("outbox");
        state.control.push_back(frame(&encode_outbound(message)));
        state.queued_control += 1;
        self.0.ready.notify_one();
        state.queued_control
    }

    pub fn flush_control(&self, ticket: u64, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut state = self.0.state.lock().expect("outbox");
        while state.written_control < ticket {
            let now = Instant::now();
            if now >= deadline || state.closed {
                return false;
            }
            state = self
                .0
                .flushed
                .wait_timeout(state, deadline - now)
                .expect("outbox")
                .0;
        }
        true
    }

    pub fn drain(&self, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        let mut state = self.0.state.lock().expect("outbox");
        while state.writing || !state.control.is_empty() || !state.order.is_empty() {
            let now = Instant::now();
            if now >= deadline || state.closed {
                return;
            }
            state = self
                .0
                .flushed
                .wait_timeout(state, deadline - now)
                .expect("outbox")
                .0;
        }
    }

    pub async fn send(
        &self,
        generation: u32,
        handle: &str,
        seq: u64,
        frame_type: ChunkedType,
        message: &Outbound,
    ) {
        let permit = self
            .slots(handle)
            .acquire_owned()
            .await
            .expect("outbox slots stay open");
        self.enqueue(generation, handle, seq, frame_type, message, permit);
    }

    fn enqueue(
        &self,
        generation: u32,
        handle: &str,
        seq: u64,
        frame_type: ChunkedType,
        message: &Outbound,
        permit: OwnedSemaphorePermit,
    ) {
        let payload = encode_outbound(message);
        let mut chunks: Vec<Chunk> = if payload.len() <= PART_BYTES {
            vec![Chunk {
                bytes: frame(&payload),
                permit: None,
            }]
        } else {
            split(generation, handle, seq, frame_type, &payload)
                .iter()
                .map(|part| Chunk {
                    bytes: frame(&encode_outbound(&Outbound::Part(part.clone()))),
                    permit: None,
                })
                .collect()
        };
        if let Some(last) = chunks.last_mut() {
            last.permit = Some(permit);
        }
        let mut state = self.0.state.lock().expect("outbox");
        let queue = state.queues.entry(handle.to_owned()).or_default();
        let was_empty = queue.is_empty();
        queue.extend(chunks);
        if was_empty {
            state.order.push_back(handle.to_owned());
        }
        self.0.ready.notify_one();
    }

    pub fn run_writer(&self, mut socket: impl Write) {
        loop {
            let (bytes, permit, control) = {
                let mut state = self.0.state.lock().expect("outbox");
                loop {
                    if let Some(bytes) = state.control.pop_front() {
                        state.writing = true;
                        break (bytes, None, true);
                    }
                    if let Some(handle) = state.order.pop_front() {
                        let queue = state.queues.get_mut(&handle).expect("queued execution");
                        let chunk = queue.pop_front().expect("non-empty queue");
                        if queue.is_empty() {
                            state.queues.remove(&handle);
                        } else {
                            state.order.push_back(handle);
                        }
                        state.writing = true;
                        break (chunk.bytes, chunk.permit, false);
                    }
                    state = self.0.ready.wait(state).expect("outbox");
                }
            };
            let written = socket.write_all(&bytes).and_then(|()| socket.flush());
            drop(permit);
            let mut state = self.0.state.lock().expect("outbox");
            state.writing = false;
            if control {
                state.written_control += 1;
            }
            if written.is_err() {
                state.closed = true;
                self.0.flushed.notify_all();
                return;
            }
            self.0.flushed.notify_all();
        }
    }
}
