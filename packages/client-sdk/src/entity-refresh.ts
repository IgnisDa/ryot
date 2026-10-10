import * as Effect from "effect/Effect";

import { RyotClientError, type EntityUpdate } from "./index";
import type { RyotSchedule } from "./schedule";

export const entityTransport = <A>(run: () => A) => {
	try {
		return run();
	} catch (error) {
		if (
			!(error instanceof RyotClientError) ||
			(error.reason !== "transport" && error.reason !== "disposed")
		) {
			throw error;
		}
		return undefined;
	}
};

export const createEntityRefresh = <E>(
	schedule: RyotSchedule,
	refresh: (updates: readonly EntityUpdate[]) => Effect.Effect<void, E>,
) => {
	let running = false;
	let blocked = false;
	let disposed = false;
	let cancel: (() => void) | undefined;
	let interrupt: (() => void) | undefined;
	let queued: Map<string, EntityUpdate> | undefined;
	const requeue = (batch: readonly EntityUpdate[]) => {
		const restored = new Map(batch.map((update) => [update.entityId, update]));
		for (const [entityId, update] of queued ?? []) {
			restored.set(entityId, update);
		}
		queued = restored;
	};
	const arm = () => {
		if (disposed || queued === undefined || blocked || running || cancel !== undefined) {
			return;
		}
		cancel = schedule.after(250, () => {
			cancel = undefined;
			if (disposed || blocked || running || queued === undefined) {
				return;
			}
			const batch = [...queued.values()];
			queued = undefined;
			running = true;
			interrupt = schedule.run(
				Effect.asVoid(
					Effect.exit(
						Effect.suspend(() => {
							if (disposed) {
								return Effect.void;
							}
							if (blocked) {
								requeue(batch);
								return Effect.void;
							}
							return refresh(batch);
						}),
					),
				),
				() => {
					interrupt = undefined;
					running = false;
					arm();
				},
			);
		});
	};
	return {
		block: (value: boolean) => {
			blocked = value;
			arm();
		},
		dispose: () => {
			disposed = true;
			queued = undefined;
			cancel?.();
			interrupt?.();
		},
		hint: (update?: EntityUpdate) => {
			queued ??= new Map();
			if (update !== undefined) {
				queued.set(update.entityId, update);
			}
			arm();
		},
	};
};
