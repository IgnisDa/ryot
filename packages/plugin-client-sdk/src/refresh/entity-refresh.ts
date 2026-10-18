import * as Effect from "effect/Effect";

import type { EntityUpdate } from "../client/adapter";
import { RyotClientError } from "../client/errors";
import type { RyotSchedule } from "../schedule";

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

const mergeUpdate = (updates: Map<string, EntityUpdate>, update: EntityUpdate) => {
	const previous = updates.get(update.entityId);
	if (
		update.reason !== "enrichment-updated" ||
		previous === undefined ||
		previous.reason === "enrichment-updated"
	) {
		updates.set(update.entityId, update);
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
	let immediate = false;
	const requeue = (batch: readonly EntityUpdate[]) => {
		const restored = new Map(batch.map((update) => [update.entityId, update]));
		for (const update of queued?.values() ?? []) {
			mergeUpdate(restored, update);
		}
		queued = restored;
	};
	const arm = () => {
		if (disposed || queued === undefined || blocked || running || cancel !== undefined) {
			return;
		}
		const run = () => {
			cancel = undefined;
			if (disposed || blocked || running || queued === undefined) {
				return;
			}
			const batch = [...queued.values()];
			const ready = immediate;
			queued = undefined;
			immediate = false;
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
								immediate ||= ready;
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
		};
		if (immediate) {
			run();
		} else {
			cancel = schedule.after(250, run);
		}
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
		hintNow: () => {
			queued ??= new Map();
			immediate = true;
			cancel?.();
			cancel = undefined;
			arm();
		},
		hint: (update?: EntityUpdate) => {
			queued ??= new Map();
			if (update !== undefined) {
				mergeUpdate(queued, update);
			}
			arm();
		},
	};
};
