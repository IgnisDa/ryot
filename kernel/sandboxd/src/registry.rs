use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use deno_core::v8;
use tokio::sync::{Notify, oneshot, watch};

use crate::os::ThreadClock;
use crate::protocol::{HostOutcome, LimitKind, Limits};

pub struct Meter {
    pub clock: ThreadClock,
    pub cpu_start: Duration,
    pub started: Instant,
    pub paused: Duration,
    pub paused_since: Option<Instant>,
}

impl Meter {
    pub fn cpu(&self) -> Duration {
        self.clock.elapsed().saturating_sub(self.cpu_start)
    }

    /// Wall time spent running script code: inline settlement pauses the deadline.
    pub fn script_time(&self, now: Instant) -> Duration {
        let paused = self.paused
            + self
                .paused_since
                .map_or(Duration::ZERO, |since| now - since);
        (now - self.started).saturating_sub(paused)
    }
}

#[derive(Default)]
pub struct EntryState {
    pub cancelled: bool,
    pub limit: Option<(LimitKind, String)>,
    pub isolate: Option<v8::IsolateHandle>,
    pub meter: Option<Meter>,
    pub terminating_since: Option<Instant>,
    /// Set while the execution holds a CPU slot and is being polled.
    pub polling_since: Option<Instant>,
    /// Set while synchronous inline settlement or CPU reacquisition blocks the isolate thread.
    pub(crate) sync_waiting_since: Option<Instant>,
    /// The leaked `Arc<Entry>` owned by a pending external-memory interrupt.
    pub interrupt: Option<usize>,
    pub finished: bool,
}

pub struct Entry {
    pub handle: String,
    pub limits: Limits,
    pub abort: Notify,
    stopping: watch::Sender<bool>,
    pending: Mutex<HashMap<u64, oneshot::Sender<HostOutcome>>>,
    state: Mutex<EntryState>,
}

impl Entry {
    pub fn new(handle: String, limits: Limits) -> Self {
        let (stopping, _) = watch::channel(false);
        Self {
            handle,
            limits,
            abort: Notify::new(),
            stopping,
            pending: Mutex::default(),
            state: Mutex::default(),
        }
    }

    pub fn state(&self) -> MutexGuard<'_, EntryState> {
        self.state.lock().expect("entry state")
    }

    pub fn await_result(&self, seq: u64) -> Option<oneshot::Receiver<HostOutcome>> {
        let state = self.state();
        if state.cancelled || state.limit.is_some() {
            return None;
        }
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .expect("pending calls")
            .insert(seq, sender);
        Some(receiver)
    }

    pub(crate) fn stop_receiver(&self) -> watch::Receiver<bool> {
        self.stopping.subscribe()
    }

    /// Delivers a host result at most once; results for unknown or settled calls are dropped.
    pub fn deliver(&self, seq: u64, outcome: HostOutcome) -> bool {
        let sender = self.pending.lock().expect("pending calls").remove(&seq);
        sender.is_some_and(|sender| sender.send(outcome).is_ok())
    }

    pub(crate) fn inline_settlement_finished(&self) {
        let mut state = self.state();
        if let Some(meter) = state.meter.as_mut()
            && let Some(since) = meter.paused_since.take()
        {
            meter.paused += since.elapsed();
        }
    }

    /// Stops the execution: pending host calls fail, an idle event loop is woken, and running
    /// script code is terminated. Returns false when the execution was already stopping.
    pub fn stop(&self, state: &mut EntryState) -> bool {
        if state.terminating_since.is_some() {
            return false;
        }
        state.terminating_since = Some(Instant::now());
        self.stopping.send_replace(true);
        self.pending.lock().expect("pending calls").clear();
        self.abort.notify_one();
        if let Some(isolate) = &state.isolate {
            isolate.terminate_execution();
        }
        true
    }

    pub fn cancel(&self) {
        let mut state = self.state();
        state.cancelled = true;
        self.stop(&mut state);
    }

    pub fn exceed(&self, limit: LimitKind, message: String) {
        let mut state = self.state();
        if state.limit.is_none() && !state.cancelled {
            state.limit = Some((limit, message));
        }
        self.stop(&mut state);
    }
}

#[derive(Default)]
struct Handles {
    active: HashMap<String, Arc<Entry>>,
    seen: HashSet<String>,
}

#[derive(Clone, Default)]
pub struct Registry(Arc<Mutex<Handles>>);

impl Registry {
    pub fn admit(&self, entry: Arc<Entry>) -> bool {
        let mut handles = self.0.lock().expect("registry");
        if !handles.seen.insert(entry.handle.clone()) {
            return false;
        }
        handles.active.insert(entry.handle.clone(), entry);
        true
    }

    pub fn claim(&self, handle: &str) -> bool {
        self.0
            .lock()
            .expect("registry")
            .seen
            .insert(handle.to_owned())
    }

    pub fn get(&self, handle: &str) -> Option<Arc<Entry>> {
        self.0.lock().expect("registry").active.get(handle).cloned()
    }

    pub fn retire(&self, handle: &str) {
        self.0.lock().expect("registry").active.remove(handle);
    }

    pub fn active(&self) -> Vec<Arc<Entry>> {
        self.0
            .lock()
            .expect("registry")
            .active
            .values()
            .cloned()
            .collect()
    }
}
