import type { EntityUpdatedFrame } from "@ryot/contract/modules/entity-interest/messages";

const DEFAULT_ENTITY_UPDATE_BATCH_WINDOW_MS = 250;
const DEFAULT_ENTITY_UPDATE_BATCH_SIZE = 25;

type BatchableUpdate = { readonly entityId: string };
type Awaitable<T> = T | PromiseLike<T>;

export type EntityUpdateBatchHandler<T extends BatchableUpdate> = (
	updates: readonly T[],
	signal: AbortSignal,
) => Awaitable<void>;

type EntityUpdateBatcherOptions<T extends BatchableUpdate> = {
	readonly windowMs?: number;
	readonly onDrain?: () => void;
	readonly maxBatchSize?: number;
	readonly onError?: (error: unknown) => void;
	readonly onBatch: EntityUpdateBatchHandler<T>;
};

export class EntityUpdateBatcher<T extends BatchableUpdate = EntityUpdatedFrame> {
	private blocked = false;
	private disposed = false;
	private windowElapsed = false;
	private readonly windowMs: number;
	private readonly maxBatchSize: number;
	private readonly pending = new Map<string, T>();
	private readonly onDrain: (() => void) | undefined;
	private readonly onError: (error: unknown) => void;
	private readonly onBatch: EntityUpdateBatchHandler<T>;
	private inFlightController: AbortController | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(options: EntityUpdateBatcherOptions<T>) {
		this.onBatch = options.onBatch;
		this.onDrain = options.onDrain;
		this.onError = options.onError ?? reportBatchError;
		this.windowMs = options.windowMs ?? DEFAULT_ENTITY_UPDATE_BATCH_WINDOW_MS;
		this.maxBatchSize = options.maxBatchSize ?? DEFAULT_ENTITY_UPDATE_BATCH_SIZE;
	}

	push(update: T) {
		if (this.disposed) {
			return;
		}
		this.pending.set(update.entityId, update);
		if (this.blocked) {
			return;
		}
		if (this.pending.size >= this.maxBatchSize) {
			this.clearTimer();
			this.windowElapsed = true;
			if (!this.inFlightController) {
				this.flush();
			}
			return;
		}
		this.ensureTimer();
	}

	setBlocked(blocked: boolean) {
		if (this.disposed || this.blocked === blocked) {
			return;
		}
		this.blocked = blocked;
		if (blocked) {
			this.clearTimer();
			this.windowElapsed = false;
			return;
		}
		if (this.pending.size === 0) {
			return;
		}
		this.clearTimer();
		this.windowElapsed = true;
		if (!this.inFlightController) {
			this.flush();
		}
	}

	dispose() {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.clearTimer();
		this.pending.clear();
		this.inFlightController?.abort();
		this.inFlightController = undefined;
	}

	private ensureTimer() {
		if (this.timer !== undefined || this.windowElapsed || this.pending.size === 0) {
			return;
		}
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.windowElapsed = true;
			if (!this.blocked && !this.inFlightController) {
				this.flush();
			}
		}, this.windowMs);
	}

	private flush() {
		if (this.disposed || this.blocked || this.inFlightController || this.pending.size === 0) {
			return;
		}
		this.clearTimer();
		this.windowElapsed = false;
		const updates: T[] = [];
		for (const [entityId, update] of this.pending) {
			updates.push(update);
			this.pending.delete(entityId);
			if (updates.length === this.maxBatchSize) {
				break;
			}
		}
		const controller = new AbortController();
		this.inFlightController = controller;
		void this.runBatch(updates, controller);
	}

	private async runBatch(updates: readonly T[], controller: AbortController) {
		try {
			await this.onBatch(updates, controller.signal);
		} catch (error) {
			if (this.disposed) {
				return;
			}
			try {
				this.onError(error);
			} catch (reportError) {
				reportBatchError(reportError);
			}
		}
		if (this.inFlightController !== controller) {
			return;
		}
		this.inFlightController = undefined;
		if (this.disposed) {
			return;
		}
		if (this.pending.size === 0) {
			this.onDrain?.();
			return;
		}
		if (this.blocked) {
			return;
		}
		if (this.windowElapsed || this.timer === undefined) {
			this.flush();
		}
	}

	private clearTimer() {
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}
}

const reportBatchError = (error: unknown) => {
	globalThis.console.error("entity update batch failed", error);
};
