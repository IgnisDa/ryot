use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Condvar, Mutex};
use std::task::{Context, Poll};

use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use crate::registry::Entry;

type Acquire = Pin<Box<dyn Future<Output = OwnedSemaphorePermit> + Send>>;

/// Polls `inner` only while holding a CPU-active slot and gives the slot back whenever the
/// execution is idle, so isolates parked on host calls or timers do not count against the cap.
pub struct Admitted<F> {
    entry: Arc<Entry>,
    slots: Arc<Semaphore>,
    permit: Option<OwnedSemaphorePermit>,
    acquiring: Option<Acquire>,
    inner: Pin<Box<F>>,
}

impl<F: Future> Admitted<F> {
    pub fn new(entry: Arc<Entry>, slots: Arc<Semaphore>, inner: F) -> Self {
        Self {
            entry,
            slots,
            permit: None,
            acquiring: None,
            inner: Box::pin(inner),
        }
    }
}

impl<F: Future> Future for Admitted<F> {
    type Output = F::Output;

    fn poll(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<F::Output> {
        if self.permit.is_none() {
            let slots = self.slots.clone();
            let acquiring = self.acquiring.get_or_insert_with(|| {
                Box::pin(async move { slots.acquire_owned().await.expect("CPU slots stay open") })
            });
            match acquiring.as_mut().poll(context) {
                Poll::Ready(permit) => {
                    self.acquiring = None;
                    self.permit = Some(permit);
                }
                Poll::Pending => return Poll::Pending,
            }
        }
        self.entry.state().polling_since = Some(std::time::Instant::now());
        let result = self.inner.as_mut().poll(context);
        self.entry.state().polling_since = None;
        self.permit = None;
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
