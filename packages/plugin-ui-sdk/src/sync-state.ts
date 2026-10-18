import type { EnrichmentState, EntitySyncState } from "@ryot-app/contract/modules/entities/schemas";

export type SyncReason = "populating" | "translating";

export type FieldSyncState = "ready" | "pending" | "failed" | "absent";

export const isEnrichmentActive = (enrichment: EnrichmentState) =>
	enrichment.state === "queued" ||
	enrichment.state === "running" ||
	enrichment.state === "retrying";

export const fieldSyncState = (value: unknown, sync: EntitySyncState): FieldSyncState => {
	if (value !== null && value !== undefined) {
		return "ready";
	}
	if (isEnrichmentActive(sync.populationStatus)) {
		return "pending";
	}
	if (sync.populationStatus.state === "failed") {
		return "failed";
	}
	return "absent";
};

export const isTitleProvisional = (sync: EntitySyncState) =>
	isEnrichmentActive(sync.translationStatus);

export const entityMonogram = (name: string) => {
	const codePoint = name.trim().codePointAt(0);
	return codePoint === undefined ? "" : String.fromCodePoint(codePoint).toUpperCase();
};
