import type { EntityUpdate } from "../client/adapter";
import type { RyotSchedule } from "../schedule";

export type EntitySettleReason = "populating" | "translating";

export type EntitySettle = ReadonlyMap<string, EntitySettleReason>;

const settleReason = (reason: EntityUpdate["reason"]): EntitySettleReason | null => {
	if (reason === "projection-updated") {
		return null;
	}
	return reason === "translated" ? "translating" : "populating";
};

export const createSettleTracker = (schedule: RyotSchedule, durationMs: number) => {
	let disposed = false;
	let visible: EntitySettle = new Map();
	let staged = new Map<string, EntitySettleReason>();
	const listeners = new Set<() => void>();
	const timers = new Map<string, () => void>();
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
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		stage: (update: EntityUpdate) => {
			const reason = settleReason(update.reason);
			if (!disposed && reason !== null) {
				staged.set(update.entityId, reason);
			}
		},
		dispose: () => {
			disposed = true;
			staged = new Map();
			visible = new Map();
			listeners.clear();
			for (const cancel of timers.values()) {
				cancel();
			}
			timers.clear();
		},
		commit: () => {
			if (disposed || staged.size === 0) {
				return;
			}
			const next = new Map(visible);
			for (const [entityId, reason] of staged) {
				next.set(entityId, reason);
				timers.get(entityId)?.();
				timers.set(
					entityId,
					schedule.after(durationMs, () => expire(entityId)),
				);
			}
			staged = new Map();
			visible = next;
			emit();
		},
	};
};
