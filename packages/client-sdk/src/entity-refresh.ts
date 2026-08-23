import { RyotClientError, type EntityUpdate } from "./index";

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

export const createEntityRefresh = (
	refresh: (updates: readonly EntityUpdate[]) => Promise<void>,
) => {
	let running = false;
	let blocked = false;
	let disposed = false;
	let queued: Map<string, EntityUpdate> | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const requeue = (batch: readonly EntityUpdate[]) => {
		const restored = new Map(batch.map((update) => [update.entityId, update]));
		for (const [entityId, update] of queued ?? []) {
			restored.set(entityId, update);
		}
		queued = restored;
	};
	const schedule = () => {
		if (disposed || queued === undefined || blocked || running || timer !== undefined) {
			return;
		}
		timer = setTimeout(() => {
			timer = undefined;
			if (disposed || blocked || running || queued === undefined) {
				return;
			}
			const batch = [...queued.values()];
			queued = undefined;
			running = true;
			void Promise.resolve()
				.then(() => {
					if (disposed) {
						return undefined;
					}
					if (blocked) {
						requeue(batch);
						return undefined;
					}
					return refresh(batch);
				})
				.catch(() => undefined)
				.finally(() => {
					running = false;
					schedule();
				});
		}, 250);
	};
	return {
		block: (value: boolean) => {
			blocked = value;
			schedule();
		},
		dispose: () => {
			disposed = true;
			queued = undefined;
			clearTimeout(timer);
		},
		hint: (update?: EntityUpdate) => {
			queued ??= new Map();
			if (update !== undefined) {
				queued.set(update.entityId, update);
			}
			schedule();
		},
	};
};
