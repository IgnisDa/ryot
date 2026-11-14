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

pub enum StopCause {
    Cancelled,
    Limit { kind: LimitKind, message: String },
}

pub struct Stopping {
    pub since: Instant,
    pub cause: StopCause,
}

#[derive(Default)]
pub struct EntryState {
    pub stopping: Option<Stopping>,
    pub isolate: Option<v8::IsolateHandle>,
    pub meter: Option<Meter>,
    /// Set while the execution holds a CPU slot and is being polled.
    pub polling_since: Option<Instant>,
    /// Set while synchronous inline settlement or CPU reacquisition blocks the isolate thread.
    pub(crate) sync_waiting_since: Option<Instant>,
    /// The leaked `Arc<Entry>` owned by a pending external-memory interrupt.
    pub interrupt: Option<usize>,
    pub finished: bool,
}

impl EntryState {
    pub fn terminate_isolate(&self) {
        if let Some(isolate) = &self.isolate {
            isolate.terminate_execution();
        }
    }
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
        if state.stopping.is_some() {
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
    /// script code is terminated. Cancellation supersedes a limit without restarting termination.
    pub(crate) fn stop(&self, state: &mut EntryState, cause: StopCause) {
        if let Some(stopping) = state.stopping.as_mut() {
            if matches!(cause, StopCause::Cancelled) {
                stopping.cause = cause;
            }
            return;
        }
        state.stopping = Some(Stopping {
            since: Instant::now(),
            cause,
        });
        self.stopping.send_replace(true);
        self.pending.lock().expect("pending calls").clear();
        self.abort.notify_one();
        state.terminate_isolate();
    }

    pub fn cancel(&self) {
        let mut state = self.state();
        self.stop(&mut state, StopCause::Cancelled);
    }

    pub fn exceed(&self, limit: LimitKind, message: String) {
        let mut state = self.state();
        self.stop(
            &mut state,
            StopCause::Limit {
                kind: limit,
                message,
            },
        );
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

#[cfg(test)]
mod tests {
    use deno_core::futures::FutureExt;

    use super::*;

    #[test]
    fn cancellation_supersedes_a_limit_without_restarting_termination() {
        let entry = Entry::new("limit-then-cancel".to_owned(), Limits::minimal());
        entry.exceed(LimitKind::Cpu, "first limit".to_owned());
        let since = entry.state().stopping.as_ref().expect("stopping").since;

        entry.cancel();

        let state = entry.state();
        let stopping = state.stopping.as_ref().expect("stopping");
        assert!(matches!(stopping.cause, StopCause::Cancelled));
        assert_eq!(stopping.since, since);
    }

    #[test]
    fn cancellation_remains_selected_after_later_limits_and_repeated_cancellation() {
        let entry = Entry::new("cancel-first".to_owned(), Limits::minimal());
        entry.cancel();
        let since = entry.state().stopping.as_ref().expect("stopping").since;

        for kind in [
            LimitKind::Cpu,
            LimitKind::Heap,
            LimitKind::External,
            LimitKind::Deadline,
        ] {
            entry.exceed(kind, "later limit".to_owned());
            entry.cancel();

            let state = entry.state();
            let stopping = state.stopping.as_ref().expect("stopping");
            assert!(matches!(stopping.cause, StopCause::Cancelled));
            assert_eq!(stopping.since, since);
        }
    }

    #[test]
    fn the_first_limit_message_and_timestamp_win_over_competing_limits() {
        let kinds = [
            LimitKind::Cpu,
            LimitKind::Heap,
            LimitKind::External,
            LimitKind::Deadline,
        ];
        for first in kinds {
            let entry = Entry::new("competing-limits".to_owned(), Limits::minimal());
            entry.exceed(first, "first limit".to_owned());
            let since = entry.state().stopping.as_ref().expect("stopping").since;

            for later in kinds {
                entry.exceed(later, "later limit".to_owned());

                let state = entry.state();
                let stopping = state.stopping.as_ref().expect("stopping");
                assert!(matches!(
                    &stopping.cause,
                    StopCause::Limit { kind, message } if *kind == first && message == "first limit"
                ));
                assert_eq!(stopping.since, since);
            }
        }
    }

    #[test]
    fn stopping_clears_pending_calls_and_signals_waiters_only_once() {
        for cause in [
            StopCause::Cancelled,
            StopCause::Limit {
                kind: LimitKind::Deadline,
                message: "deadline".to_owned(),
            },
        ] {
            let entry = Entry::new("pending-stop".to_owned(), Limits::minimal());
            let mut first = entry.await_result(1).expect("first pending call");
            let mut second = entry.await_result(2).expect("second pending call");
            let mut stopping = entry.stop_receiver();
            assert!(!*stopping.borrow_and_update());
            assert!(entry.abort.notified().now_or_never().is_none());

            entry.stop(&mut entry.state(), cause);

            assert!(matches!(
                first.try_recv(),
                Err(oneshot::error::TryRecvError::Closed)
            ));
            assert!(matches!(
                second.try_recv(),
                Err(oneshot::error::TryRecvError::Closed)
            ));
            assert!(entry.pending.lock().expect("pending calls").is_empty());
            assert!(entry.await_result(3).is_none());
            assert!(!entry.deliver(1, HostOutcome::Failure("late result".to_owned())));
            assert!(stopping.has_changed().expect("stop sender"));
            assert!(*stopping.borrow_and_update());
            assert!(*entry.stop_receiver().borrow());
            assert!(entry.abort.notified().now_or_never().is_some());

            entry.cancel();
            entry.exceed(LimitKind::Heap, "later limit".to_owned());
            entry.cancel();

            assert!(!stopping.has_changed().expect("stop sender"));
            assert!(entry.abort.notified().now_or_never().is_none());
        }
    }

    #[test]
    fn cancellation_after_isolate_disposal_still_supersedes_a_limit() {
        let entry = Entry::new("late-cancel".to_owned(), Limits::minimal());
        entry.exceed(LimitKind::External, "external memory".to_owned());
        let since = {
            let mut state = entry.state();
            state.finished = true;
            state.stopping.as_ref().expect("stopping").since
        };

        entry.cancel();

        let state = entry.state();
        let stopping = state.stopping.as_ref().expect("stopping");
        assert!(state.finished);
        assert!(matches!(stopping.cause, StopCause::Cancelled));
        assert_eq!(stopping.since, since);
    }
}
