import { planNextSlot } from "../cadence";

export type Slot = {
	readonly scheduledMs: number;
	readonly startedMs: number;
	readonly startedMonotonicMs: number;
	readonly missedSlotsBefore: number;
};

export const createStopSignal = () => {
	let stopped = false;
	let wake: (() => void) | null = null;
	return {
		isStopped: () => stopped,
		stop: () => {
			stopped = true;
			wake?.();
		},
		sleep: (ms: number) =>
			new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, ms);
				wake = () => {
					clearTimeout(timer);
					resolve();
				};
			}).finally(() => {
				wake = null;
			}),
	};
};
export type StopSignal = ReturnType<typeof createStopSignal>;

export const runFixedRate = async (
	intervalMs: number,
	signal: StopSignal,
	tick: (slot: Slot) => void | Promise<void>,
) => {
	const originMs = performance.now();
	let slotIndex = 0;
	let deadlineMs = originMs;
	let missedSlotsBefore = 0;
	while (!signal.isStopped()) {
		const waitMs = deadlineMs - performance.now();
		if (waitMs > 0) {
			// oxlint-disable-next-line no-await-in-loop -- slots run strictly in sequence
			await signal.sleep(waitMs);
			continue;
		}
		const startedMonotonicMs = performance.now();
		// oxlint-disable-next-line no-await-in-loop -- samples must never overlap
		await tick({
			missedSlotsBefore,
			startedMonotonicMs,
			scheduledMs: performance.timeOrigin + deadlineMs,
			startedMs: performance.timeOrigin + startedMonotonicMs,
		});
		const plan = planNextSlot({
			originMs,
			intervalMs,
			nowMs: performance.now(),
			currentSlotIndex: slotIndex,
		});
		slotIndex = plan.nextSlotIndex;
		deadlineMs = plan.nextDeadlineMs;
		missedSlotsBefore = plan.missedSlots;
	}
};
