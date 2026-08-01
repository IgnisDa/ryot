import {
	MAX_INTEREST_ENTITY_IDS,
	type EntityUpdatedFrame,
} from "@ryot/contract/modules/entity-interest/messages";

type DeclareInterest = (
	streamId: string,
	entityIds: readonly string[],
) => Promise<readonly EntityUpdatedFrame[]>;

type UpdateListener = (frame: EntityUpdatedFrame) => void;

export class EntityInterestCoordinator {
	private dirty = false;
	private declaring = false;
	private streamId: string | undefined;
	private readonly listeners = new Set<UpdateListener>();
	private readonly interests = new Map<string, ReadonlySet<string>>();

	constructor(private readonly declareInterest: DeclareInterest) {}

	setConnection(streamId: string | undefined) {
		this.streamId = streamId;
		if (streamId) {
			this.requestDeclaration();
		}
	}

	setInterest(owner: string, entityIds: readonly string[]) {
		this.interests.set(owner, new Set(entityIds));
		this.requestDeclaration();
		return () => {
			if (this.interests.delete(owner)) {
				this.requestDeclaration();
			}
		};
	}

	subscribe(listener: UpdateListener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	receive(frame: EntityUpdatedFrame) {
		this.emit(frame);
		if (frame.reason === "populated") {
			this.requestDeclaration();
		}
	}

	private requestDeclaration() {
		this.dirty = true;
		if (!this.declaring) {
			void this.flush();
		}
	}

	private async flush() {
		this.declaring = true;
		try {
			while (this.dirty && this.streamId) {
				this.dirty = false;
				const streamId = this.streamId;
				const entityIds = this.currentEntityIds();
				try {
					// Declarations have replace semantics, so each must finish before the latest set is sent.
					// oxlint-disable-next-line no-await-in-loop
					const terminal = await this.declareInterest(streamId, entityIds);
					for (const frame of terminal) {
						this.emit(frame);
					}
				} catch {
					return;
				}
			}
		} finally {
			this.declaring = false;
			if (this.dirty && this.streamId) {
				void this.flush();
			}
		}
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
		for (const listener of this.listeners) {
			listener(frame);
		}
	}
}
