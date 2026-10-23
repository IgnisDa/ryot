export type SyncReason = "populating" | "translating";

export type SyncStatus = "pending" | "ready" | "failed" | "none";

export type FieldSyncState = "ready" | "pending" | "failed" | "absent";

export type EntitySyncState = {
	readonly populationStatus: SyncStatus;
	readonly translationStatus: SyncStatus;
};

export const fieldSyncState = (value: unknown, sync: EntitySyncState): FieldSyncState => {
	if (value !== null && value !== undefined) {
		return "ready";
	}
	if (sync.populationStatus === "pending" || sync.populationStatus === "failed") {
		return sync.populationStatus;
	}
	return "absent";
};

export const isTitleProvisional = (sync: EntitySyncState) => sync.translationStatus === "pending";

export const entityMonogram = (name: string) => {
	const codePoint = name.trim().codePointAt(0);
	return codePoint === undefined ? "" : String.fromCodePoint(codePoint).toUpperCase();
};
