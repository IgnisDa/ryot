use std::cell::RefCell;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::sync::{Arc, Condvar, Mutex};
use std::task::{Context, Poll};
use std::time::Instant;

use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use crate::registry::Entry;

type Acquire = Pin<Box<dyn Future<Output = OwnedSemaphorePermit> + Send>>;

pub(crate) struct CpuLease {
    entry: Arc<Entry>,
    slots: Arc<Semaphore>,
    permit: RefCell<Option<OwnedSemaphorePermit>>,
}

impl CpuLease {
    pub(crate) fn new(entry: Arc<Entry>, slots: Arc<Semaphore>) -> Rc<Self> {
        Rc::new(Self {
            entry,
            slots,
            permit: RefCell::new(None),
        })
    }

    fn has_permit(&self) -> bool {
        self.permit.borrow().is_some()
    }

    fn install(&self, permit: OwnedSemaphorePermit) {
        *self.permit.borrow_mut() = Some(permit);
    }

    fn release_polling(&self) {
        let permit = self.permit.borrow_mut().take();
        self.entry.state().polling_since = None;
        drop(permit);
    }

    pub(crate) fn park_for_inline(&self) {
        assert!(self.has_permit(), "inline settlement requires a CPU lease");
        let now = Instant::now();
        {
            let mut state = self.entry.state();
            state.polling_since = None;
            state.sync_waiting_since = Some(now);
            if let Some(meter) = state.meter.as_mut() {
                meter.paused_since = Some(now);
            }
        }
        drop(self.permit.borrow_mut().take());
    }

    pub(crate) fn resume_after_inline(&self) -> bool {
        let mut stopping = self.entry.stop_receiver();
        let slots = self.slots.clone();
        let permit = deno_core::futures::executor::block_on(async move {
            if *stopping.borrow() {
                None
            } else {
                tokio::select! {
                    biased;
                    _ = stopping.changed() => None,
                    permit = slots.acquire_owned() => permit.ok(),
                }
            }
        });
        let mut state = self.entry.state();
        match permit {
            Some(permit)
                if !state.cancelled
                    && state.limit.is_none()
                    && state.terminating_since.is_none() =>
            {
                state.sync_waiting_since = None;
                state.polling_since = Some(Instant::now());
                drop(state);
                self.install(permit);
                true
            }
            Some(permit) => {
                state.sync_waiting_since = None;
                drop(permit);
                false
            }
            None => {
                state.sync_waiting_since = None;
                false
            }
        }
    }
}

/// Polls `inner` only while holding a CPU-active slot and gives the slot back whenever the
/// execution is idle, so isolates parked on host calls or timers do not count against the cap.
pub(crate) struct Admitted<F> {
    lease: Rc<CpuLease>,
    acquiring: Option<Acquire>,
    inner: Pin<Box<F>>,
}

impl<F: Future> Admitted<F> {
    pub(crate) fn new(lease: Rc<CpuLease>, inner: F) -> Self {
        Self {
            lease,
            acquiring: None,
            inner: Box::pin(inner),
        }
    }
}

impl<F: Future> Future for Admitted<F> {
    type Output = F::Output;

    fn poll(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<F::Output> {
        if !self.lease.has_permit() {
            let slots = self.lease.slots.clone();
            let acquiring = self.acquiring.get_or_insert_with(|| {
                Box::pin(async move { slots.acquire_owned().await.expect("CPU slots stay open") })
            });
            match acquiring.as_mut().poll(context) {
                Poll::Ready(permit) => {
                    self.acquiring = None;
                    self.lease.install(permit);
                }
                Poll::Pending => return Poll::Pending,
            }
        }
        self.lease.entry.state().polling_since = Some(Instant::now());
        let result = self.inner.as_mut().poll(context);
        self.lease.release_polling();
        result
    }
}

pub struct MemoryBudget {
    total: u64,
    available: Mutex<u64>,
    released: Condvar,
}

pub struct Reservation<'a> {
    budget: &'a MemoryBudget,
    bytes: u64,
}

impl MemoryBudget {
    pub fn new(total: u64) -> Self {
        Self {
            total,
            available: Mutex::new(total),
            released: Condvar::new(),
        }
    }

    pub fn reserve(&self, bytes: u64) -> Option<Reservation<'_>> {
        if bytes > self.total {
            return None;
        }
        let mut available = self.available.lock().expect("memory budget");
        while *available < bytes {
            available = self.released.wait(available).expect("memory budget");
        }
        *available -= bytes;
        Some(Reservation {
            budget: self,
            bytes,
        })
    }
}

impl Drop for Reservation<'_> {
    fn drop(&mut self) {
        *self.budget.available.lock().expect("memory budget") += self.bytes;
        self.budget.released.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::protocol::Limits;

    #[test]
    fn cancellation_interrupts_cpu_lease_reacquisition() {
        let slots = Arc::new(Semaphore::new(1));
        let entry = Arc::new(Entry::new(
            "cancelled-reacquisition".to_owned(),
            Limits {
                cpu_ms: 1,
                heap_bytes: 1,
                deadline_ms: 1,
                external_bytes: 1,
            },
        ));
        let lease = CpuLease::new(entry.clone(), slots.clone());
        lease.install(slots.clone().try_acquire_owned().expect("CPU permit"));
        lease.park_for_inline();
        let occupied = slots.try_acquire_owned().expect("park releases the permit");
        let stopper = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            entry.cancel();
            std::thread::sleep(Duration::from_millis(500));
            drop(occupied);
        });

        let start = Instant::now();
        assert!(!lease.resume_after_inline());
        assert!(start.elapsed() < Duration::from_millis(250));
        stopper.join().expect("stopper");
    }
}
