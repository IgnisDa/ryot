import {
	MAX_INTEREST_ENTITY_IDS,
	type EntityUpdatedFrame,
} from "@ryot/contract/modules/entity-interest/messages";

type DeclareInterest = (
	streamId: string,
	entityIds: readonly string[],
	signal: AbortSignal,
) => Promise<readonly EntityUpdatedFrame[]>;

type UpdateListener = (frame: EntityUpdatedFrame) => void;

type RetryDelay = (delayMs: number, signal: AbortSignal) => Promise<void>;

type DeclarationFailure = (error: unknown, attempt: number, retryDelayMs: number) => void;

const waitForRetry: RetryDelay = (delayMs, signal) => {
	if (signal.aborted) {
		return Promise.resolve();
	}
	let timeout: ReturnType<typeof setTimeout>;
	let handleAbort: () => void;
	const timeoutElapsed = new Promise<void>((resolve) => {
		timeout = setTimeout(resolve, delayMs);
	});
	const aborted = new Promise<void>((resolve) => {
		handleAbort = () => resolve();
		signal.addEventListener("abort", handleAbort, { once: true });
	});
	return Promise.race([timeoutElapsed, aborted]).finally(() => {
		clearTimeout(timeout);
		signal.removeEventListener("abort", handleAbort);
	});
};

export class EntityInterestCoordinator {
	private dirty = false;
	private generation = 0;
	private disposed = false;
	private declaring = false;
	private streamId: string | undefined;
	private activeController: AbortController | undefined;
	private readonly listeners = new Set<UpdateListener>();
	private readonly interests = new Map<string, ReadonlySet<string>>();

	constructor(
		private readonly declareInterest: DeclareInterest,
		private readonly retryDelay: RetryDelay = waitForRetry,
		private readonly onDeclarationFailure?: DeclarationFailure,
	) {}

	setConnection(streamId: string | undefined) {
		if (this.disposed || this.streamId === streamId) {
			return;
		}
		this.invalidateWork();
		this.streamId = streamId;
		if (streamId) {
			this.requestDeclaration();
		} else {
			this.dirty = false;
		}
	}

	setInterest(owner: string, entityIds: readonly string[]) {
		if (this.disposed) {
			return;
		}
		const next = new Set(entityIds);
		const current = this.interests.get(owner);
		if (current && current.size === next.size && [...current].every((id) => next.has(id))) {
			return;
		}
		this.interests.set(owner, next);
		this.requestDeclaration();
	}

	removeInterest(owner: string) {
		if (this.disposed) {
			return;
		}
		if (this.interests.delete(owner)) {
			this.requestDeclaration();
		}
	}

	subscribe(listener: UpdateListener) {
		if (this.disposed) {
			return () => false;
		}
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	receive(frame: EntityUpdatedFrame) {
		if (this.disposed || !this.streamId) {
			return;
		}
		this.emit(frame);
		if (frame.reason === "populated") {
			this.requestDeclaration();
		}
	}

	dispose() {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.dirty = false;
		this.streamId = undefined;
		this.invalidateWork();
		this.listeners.clear();
		this.interests.clear();
	}

	private requestDeclaration() {
		if (this.disposed) {
			return;
		}
		this.dirty = true;
		if (!this.declaring && this.streamId) {
			void this.flush();
		}
	}

	private async flush() {
		this.declaring = true;
		let failures = 0;
		try {
			while (!this.disposed && this.dirty && this.streamId) {
				this.dirty = false;
				const generation = this.generation;
				const streamId = this.streamId;
				const entityIds = this.currentEntityIds();
				const controller = new AbortController();
				this.activeController = controller;
				try {
					// Declarations have replace semantics, so each must finish before the latest set is sent.
					// oxlint-disable-next-line no-await-in-loop
					const terminal = await this.declareInterest(streamId, entityIds, controller.signal);
					if (!this.isCurrent(generation, streamId)) {
						return;
					}
					failures = 0;
					for (const frame of terminal) {
						this.emit(frame);
					}
				} catch (error) {
					if (!this.isCurrent(generation, streamId)) {
						return;
					}
					this.dirty = true;
					failures += 1;
					const retryDelayMs = Math.min(1_000 * 2 ** (failures - 1), 30_000);
					this.onDeclarationFailure?.(error, failures, retryDelayMs);
					// oxlint-disable-next-line no-await-in-loop
					await this.retryDelay(retryDelayMs, controller.signal);
					if (!this.isCurrent(generation, streamId)) {
						return;
					}
				} finally {
					if (this.activeController === controller) {
						this.activeController = undefined;
					}
				}
			}
		} finally {
			this.declaring = false;
			if (!this.disposed && this.dirty && this.streamId) {
				void this.flush();
			}
		}
	}

	private invalidateWork() {
		this.generation += 1;
		this.activeController?.abort();
		this.activeController = undefined;
	}

	private isCurrent(generation: number, streamId: string) {
		return !this.disposed && this.generation === generation && this.streamId === streamId;
	}

	private currentEntityIds() {
		const entityIds = new Set<string>();
		for (const interest of this.interests.values()) {
			for (const entityId of interest) {
				entityIds.add(entityId);
				if (entityIds.size === MAX_INTEREST_ENTITY_IDS) {
					return [...entityIds];
				}
			}
		}
		return [...entityIds];
	}

	private emit(frame: EntityUpdatedFrame) {
		if (this.disposed) {
			return;
		}
		for (const listener of this.listeners) {
			listener(frame);
		}
	}
}
