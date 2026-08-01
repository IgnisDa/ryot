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
	private readonly interests = new Map<string, Set<string>>();
	private readonly ownersByEntity = new Map<string, Set<string>>();
	private readonly listenersByOwner = new Map<string, UpdateListener>();

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

	disconnect(streamId: string) {
		if (this.streamId !== streamId) {
			return;
		}
		this.setConnection(undefined);
	}

	setInterest(owner: string, entityIds: readonly string[], listener: UpdateListener) {
		if (this.disposed) {
			return;
		}
		const next = new Set(entityIds);
		const current = this.interests.get(owner);
		this.listenersByOwner.set(owner, listener);
		if (current && current.size === next.size && [...current].every((id) => next.has(id))) {
			return;
		}
		if (current) {
			this.removeOwnerFromEntityIndex(owner, current);
		}
		this.interests.set(owner, next);
		for (const entityId of next) {
			const owners = this.ownersByEntity.get(entityId) ?? new Set<string>();
			owners.add(owner);
			this.ownersByEntity.set(entityId, owners);
		}
		this.requestDeclaration();
	}

	removeInterest(owner: string) {
		if (this.disposed) {
			return;
		}
		const current = this.interests.get(owner);
		if (current) {
			this.removeOwnerFromEntityIndex(owner, current);
			this.interests.delete(owner);
			this.listenersByOwner.delete(owner);
			this.requestDeclaration();
		}
	}

	receive(frame: EntityUpdatedFrame) {
		if (this.disposed || !this.streamId) {
			return;
		}
		this.emit(frame);
	}

	dispose() {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.dirty = false;
		this.streamId = undefined;
		this.invalidateWork();
		this.interests.clear();
		this.ownersByEntity.clear();
		this.listenersByOwner.clear();
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
		const owners = this.ownersByEntity.get(frame.entityId);
		if (!owners) {
			return;
		}
		for (const owner of owners) {
			this.listenersByOwner.get(owner)?.(frame);
		}
	}

	private removeOwnerFromEntityIndex(owner: string, entityIds: ReadonlySet<string>) {
		for (const entityId of entityIds) {
			const owners = this.ownersByEntity.get(entityId);
			if (!owners) {
				continue;
			}
			owners.delete(owner);
			if (owners.size === 0) {
				this.ownersByEntity.delete(entityId);
			}
		}
	}
}
