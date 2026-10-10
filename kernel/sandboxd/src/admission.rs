use std::cell::{Cell, RefCell};
use std::collections::{HashSet, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::task::{Context, Poll, Waker};
use std::time::{Duration, Instant};

use crate::protocol::Lane;
use crate::registry::Entry;

const INTERACTIVE_GRANTS_BEFORE_BACKGROUND: u32 = 4;

#[derive(Default)]
struct SlotState {
    free: usize,
    background_holders: usize,
    interactive_streak: u32,
    next_id: u64,
    queues: [VecDeque<(u64, Waker)>; 2],
    granted: HashSet<u64>,
}

impl SlotState {
    fn queue(lane: Lane) -> usize {
        match lane {
            Lane::Interactive => 0,
            Lane::Background => 1,
        }
    }

    fn grant(&mut self, woken: &mut Vec<Waker>) {
        while self.free > 0 {
            let interactive = !self.queues[0].is_empty();
            let background = !self.queues[1].is_empty();
            let background_starved = background && self.background_holders == 0;
            let lane = match (interactive, background) {
                (false, false) => return,
                (true, true)
                    if background_starved
                        && self.interactive_streak >= INTERACTIVE_GRANTS_BEFORE_BACKGROUND =>
                {
                    Lane::Background
                }
                (true, _) => Lane::Interactive,
                (false, true) => Lane::Background,
            };
            let (id, waker) = self.queues[Self::queue(lane)]
                .pop_front()
                .expect("lane has a waiter");
            self.free -= 1;
            match lane {
                Lane::Interactive => {
                    if background_starved {
                        self.interactive_streak += 1;
                    }
                }
                Lane::Background => {
                    self.background_holders += 1;
                    self.interactive_streak = 0;
                }
            }
            self.granted.insert(id);
            woken.push(waker);
        }
    }

    fn release(&mut self, lane: Lane) {
        self.free += 1;
        if lane == Lane::Background {
            self.background_holders -= 1;
        }
    }
}

/// CPU-active slots granted to interactive waiters first. While background waiters exist and no
/// background run holds a slot, every fifth grant goes to a background waiter. Held slots are
/// never revoked.
pub struct LaneSlots {
    state: Mutex<SlotState>,
}

impl LaneSlots {
    pub fn new(slots: usize) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(SlotState {
                free: slots,
                ..SlotState::default()
            }),
        })
    }

    fn lock(&self) -> MutexGuard<'_, SlotState> {
        self.state.lock().expect("CPU slots")
    }

    fn settle(&self, state: MutexGuard<'_, SlotState>, release: Option<Lane>) {
        let mut state = state;
        if let Some(lane) = release {
            state.release(lane);
        }
        let mut woken = Vec::new();
        state.grant(&mut woken);
        drop(state);
        woken.into_iter().for_each(Waker::wake);
    }

    pub(crate) fn acquire(self: &Arc<Self>, lane: Lane) -> Acquire {
        Acquire {
            slots: self.clone(),
            lane,
            id: None,
            started: Instant::now(),
        }
    }
}

pub(crate) struct CpuSlot {
    slots: Arc<LaneSlots>,
    lane: Lane,
    waited: Duration,
}

impl CpuSlot {
    pub(crate) fn waited(&self) -> Duration {
        self.waited
    }
}

impl Drop for CpuSlot {
    fn drop(&mut self) {
        self.slots.settle(self.slots.lock(), Some(self.lane));
    }
}

pub(crate) struct Acquire {
    slots: Arc<LaneSlots>,
    lane: Lane,
    id: Option<u64>,
    started: Instant,
}

impl Future for Acquire {
    type Output = CpuSlot;

    fn poll(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<CpuSlot> {
        let slots = self.slots.clone();
        let mut woken = Vec::new();
        let mut state = slots.lock();
        let id = match self.id {
            Some(id) => id,
            None => {
                let id = state.next_id;
                state.next_id += 1;
                state.queues[SlotState::queue(self.lane)].push_back((id, context.waker().clone()));
                state.grant(&mut woken);
                self.id = Some(id);
                id
            }
        };
        let granted = state.granted.remove(&id);
        if !granted {
            let (_, waker) = state.queues[SlotState::queue(self.lane)]
                .iter_mut()
                .find(|(queued, _)| *queued == id)
                .expect("an ungranted waiter stays queued");
            waker.clone_from(context.waker());
        }
        drop(state);
        woken.into_iter().for_each(Waker::wake);
        if !granted {
            return Poll::Pending;
        }
        self.id = None;
        Poll::Ready(CpuSlot {
            slots,
            lane: self.lane,
            waited: self.started.elapsed(),
        })
    }
}

impl Drop for Acquire {
    fn drop(&mut self) {
        let Some(id) = self.id else {
            return;
        };
        let mut state = self.slots.lock();
        let queue = &mut state.queues[SlotState::queue(self.lane)];
        if let Some(position) = queue.iter().position(|(queued, _)| *queued == id) {
            queue.remove(position);
            return;
        }
        if state.granted.remove(&id) {
            self.slots.settle(state, Some(self.lane));
        }
    }
}

pub(crate) struct CpuLease {
    entry: Arc<Entry>,
    slots: Arc<LaneSlots>,
    lane: Lane,
    slot: RefCell<Option<CpuSlot>>,
    waited: Cell<Duration>,
}

impl CpuLease {
    pub(crate) fn new(
        entry: Arc<Entry>,
        slots: Arc<LaneSlots>,
        lane: Lane,
        waited: Duration,
    ) -> Rc<Self> {
        Rc::new(Self {
            entry,
            slots,
            lane,
            slot: RefCell::new(None),
            waited: Cell::new(waited),
        })
    }

    pub(crate) fn waited_ms(&self) -> u64 {
        self.waited.get().as_millis() as u64
    }

    fn has_slot(&self) -> bool {
        self.slot.borrow().is_some()
    }

    fn install(&self, slot: CpuSlot) {
        self.waited.set(self.waited.get() + slot.waited());
        *self.slot.borrow_mut() = Some(slot);
    }

    fn release_polling(&self) {
        let slot = self.slot.borrow_mut().take();
        self.entry.state().polling_since = None;
        drop(slot);
    }

    pub(crate) fn park_for_inline(&self) {
        assert!(self.has_slot(), "inline settlement requires a CPU lease");
        let now = Instant::now();
        {
            let mut state = self.entry.state();
            state.polling_since = None;
            state.sync_waiting_since = Some(now);
            if let Some(meter) = state.meter.as_mut() {
                meter.paused_since = Some(now);
            }
        }
        drop(self.slot.borrow_mut().take());
    }

    pub(crate) fn resume_after_inline(&self) -> bool {
        let mut stopping = self.entry.stop_receiver();
        let acquire = self.slots.acquire(self.lane);
        let slot = deno_core::futures::executor::block_on(async move {
            if *stopping.borrow() {
                None
            } else {
                tokio::select! {
                    biased;
                    _ = stopping.changed() => None,
                    slot = acquire => Some(slot),
                }
            }
        });
        let mut state = self.entry.state();
        state.sync_waiting_since = None;
        let Some(slot) = slot.filter(|_| {
            !state.cancelled && state.limit.is_none() && state.terminating_since.is_none()
        }) else {
            return false;
        };
        drop(state);
        self.install(slot);
        self.start_polling();
        true
    }

    fn start_polling(&self) {
        self.entry.state().polling_since = Some(Instant::now());
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
        if !self.lease.has_slot() {
            let lease = self.lease.clone();
            let acquiring = self
                .acquiring
                .get_or_insert_with(|| lease.slots.acquire(lease.lane));
            match Pin::new(acquiring).poll(context) {
                Poll::Ready(slot) => {
                    self.acquiring = None;
                    self.lease.install(slot);
                }
                Poll::Pending => return Poll::Pending,
            }
        }
        self.lease.start_polling();
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
    use deno_core::futures::task::noop_waker;

    use super::*;
    use crate::protocol::Limits;

    fn ready(acquire: &mut Acquire) -> Option<CpuSlot> {
        let waker = noop_waker();
        match Pin::new(acquire).poll(&mut Context::from_waker(&waker)) {
            Poll::Ready(slot) => Some(slot),
            Poll::Pending => None,
        }
    }

    fn held(slots: &Arc<LaneSlots>, lane: Lane) -> CpuSlot {
        ready(&mut slots.acquire(lane)).expect("a free CPU slot")
    }

    fn queue(slots: &Arc<LaneSlots>, lane: Lane, count: usize) -> Vec<(Lane, Acquire)> {
        (0..count)
            .map(|_| {
                let mut acquire = slots.acquire(lane);
                assert!(ready(&mut acquire).is_none(), "the slot is occupied");
                (lane, acquire)
            })
            .collect()
    }

    fn take_granted(waiters: &mut Vec<(Lane, Acquire)>) -> (Lane, CpuSlot) {
        let granted: Vec<usize> = (0..waiters.len())
            .filter(|index| {
                waiters[*index]
                    .1
                    .slots
                    .lock()
                    .granted
                    .contains(&waiters[*index].1.id.expect("queued"))
            })
            .collect();
        assert_eq!(granted.len(), 1, "exactly one waiter is granted");
        let (lane, mut acquire) = waiters.remove(granted[0]);
        (lane, ready(&mut acquire).expect("granted waiter is ready"))
    }

    #[test]
    fn cancellation_interrupts_cpu_lease_reacquisition() {
        let slots = LaneSlots::new(1);
        let entry = Arc::new(Entry::new(
            "cancelled-reacquisition".to_owned(),
            Limits::minimal(),
        ));
        let lease = CpuLease::new(
            entry.clone(),
            slots.clone(),
            Lane::Interactive,
            Duration::ZERO,
        );
        lease.install(held(&slots, Lane::Interactive));
        lease.park_for_inline();
        let occupied = held(&slots, Lane::Interactive);
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

    #[test]
    fn interactive_waiters_are_granted_before_earlier_background_waiters() {
        let slots = LaneSlots::new(1);
        let holder = held(&slots, Lane::Background);
        let mut waiters = queue(&slots, Lane::Background, 2);
        waiters.extend(queue(&slots, Lane::Interactive, 2));
        drop(holder);
        let (lane, slot) = take_granted(&mut waiters);
        assert_eq!(lane, Lane::Interactive);
        drop(slot);
        assert_eq!(take_granted(&mut waiters).0, Lane::Interactive);
    }

    #[test]
    fn background_waiters_are_granted_no_later_than_the_fifth_grant() {
        let slots = LaneSlots::new(1);
        let mut holder = held(&slots, Lane::Interactive);
        let mut waiters = queue(&slots, Lane::Background, 1);
        waiters.extend(queue(&slots, Lane::Interactive, 8));
        let mut order = Vec::new();
        for _ in 0..5 {
            drop(holder);
            let (lane, slot) = take_granted(&mut waiters);
            order.push(lane);
            holder = slot;
        }
        assert_eq!(
            order,
            [
                Lane::Interactive,
                Lane::Interactive,
                Lane::Interactive,
                Lane::Interactive,
                Lane::Background
            ]
        );
        drop(holder);
        assert_eq!(take_granted(&mut waiters).0, Lane::Interactive);
    }

    #[test]
    fn interactive_grants_are_not_counted_while_a_background_run_holds_a_slot() {
        let slots = LaneSlots::new(2);
        let background_holder = held(&slots, Lane::Background);
        let mut holder = held(&slots, Lane::Interactive);
        let mut waiters = queue(&slots, Lane::Background, 1);
        waiters.extend(queue(&slots, Lane::Interactive, 12));
        for _ in 0..8 {
            drop(holder);
            let (lane, slot) = take_granted(&mut waiters);
            assert_eq!(lane, Lane::Interactive);
            holder = slot;
        }
        drop(background_holder);
        let mut holders = vec![holder];
        let mut order = Vec::new();
        for grant in 0..5 {
            if grant > 0 {
                drop(holders.remove(0));
            }
            let (lane, slot) = take_granted(&mut waiters);
            order.push(lane);
            holders.push(slot);
        }
        assert_eq!(
            order,
            [
                Lane::Interactive,
                Lane::Interactive,
                Lane::Interactive,
                Lane::Interactive,
                Lane::Background
            ]
        );
    }

    #[test]
    fn dropped_waiters_never_leak_or_double_grant_a_slot() {
        let slots = LaneSlots::new(1);
        let holder = held(&slots, Lane::Background);
        let mut waiters = queue(&slots, Lane::Interactive, 2);
        waiters.extend(queue(&slots, Lane::Background, 1));
        drop(waiters.remove(0));
        drop(holder);
        drop(waiters.remove(0));
        drop(waiters.remove(0));
        let mut extra = slots.acquire(Lane::Background);
        let slot = ready(&mut extra).expect("every dropped waiter returned its slot");
        assert!(
            ready(&mut slots.acquire(Lane::Interactive)).is_none(),
            "the slot was granted twice"
        );
        drop(slot);
    }
}
