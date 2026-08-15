import type { EntityUpdate } from "./index";

export type EntitySettleReason = "populating" | "translating";

export type EntitySettle = ReadonlyMap<string, EntitySettleReason>;

const settleReason = (reason: EntityUpdate["reason"]): EntitySettleReason =>
	reason === "translated" ? "translating" : "populating";

export const createSettleTracker = (durationMs: number) => {
	let disposed = false;
	let visible: EntitySettle = new Map();
	let staged = new Map<string, EntitySettleReason>();
	const listeners = new Set<() => void>();
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	const emit = () => {
		for (const listener of listeners) {
			listener();
		}
	};
	const expire = (entityId: string) => {
		timers.delete(entityId);
		if (disposed || !visible.has(entityId)) {
			return;
		}
		const next = new Map(visible);
		next.delete(entityId);
		visible = next;
		emit();
	};
	return {
		snapshot: () => visible,
		stage: (update: EntityUpdate) => {
			if (!disposed) {
				staged.set(update.entityId, settleReason(update.reason));
			}
		},
		commit: () => {
			if (disposed || staged.size === 0) {
				return;
			}
			const next = new Map(visible);
			for (const [entityId, reason] of staged) {
				next.set(entityId, reason);
				clearTimeout(timers.get(entityId));
				timers.set(
					entityId,
					setTimeout(() => expire(entityId), durationMs),
				);
			}
			staged = new Map();
			visible = next;
			emit();
		},
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		dispose: () => {
			disposed = true;
			staged = new Map();
			visible = new Map();
			listeners.clear();
			for (const timer of timers.values()) {
				clearTimeout(timer);
			}
			timers.clear();
		},
	};
};
