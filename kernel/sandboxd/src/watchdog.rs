use std::ffi::c_void;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::execute::check_external_memory;
use crate::protocol::LimitKind;
use crate::registry::{Entry, Registry};

pub const TICK: Duration = Duration::from_millis(5);

pub fn run(registry: Registry, grace: Duration, escalate: impl Fn(&Entry)) {
    loop {
        std::thread::sleep(TICK);
        let now = Instant::now();
        for entry in registry.active() {
            let mut state = entry.state();
            if state.finished || state.isolate.is_none() {
                continue;
            }
            if let Some(since) = state.terminating_since {
                if let Some(isolate) = &state.isolate {
                    isolate.terminate_execution();
                }
                // Only an isolate that keeps running after termination is a culprit; one waiting
                // for a CPU slot stops as soon as it is polled.
                let ignoring = state
                    .polling_since
                    .is_some_and(|polling| now - since.max(polling) > grace);
                if ignoring {
                    drop(state);
                    escalate(&entry);
                }
                continue;
            }
            let Some(meter) = &state.meter else { continue };
            let limits = &entry.limits;
            let exceeded = if meter.cpu() > Duration::from_millis(limits.cpu_ms) {
                Some((
                    LimitKind::Cpu,
                    format!("CPU limit of {} ms exceeded", limits.cpu_ms),
                ))
            } else if meter.script_time(now) > Duration::from_millis(limits.deadline_ms) {
                Some((
                    LimitKind::Deadline,
                    format!("deadline of {} ms exceeded", limits.deadline_ms),
                ))
            } else {
                None
            };
            if let Some(limit) = exceeded {
                state.limit.get_or_insert(limit);
                entry.stop(&mut state);
                continue;
            }
            if state.interrupt.is_none() {
                let data = Arc::into_raw(entry.clone());
                let requested = state.isolate.as_ref().is_some_and(|isolate| {
                    isolate.request_interrupt(check_external_memory, data as *mut c_void)
                });
                if requested {
                    state.interrupt = Some(data as usize);
                } else {
                    // SAFETY: the interrupt was not registered, so this is the only owner.
                    unsafe { drop(Arc::from_raw(data)) };
                }
            }
        }
    }
}
