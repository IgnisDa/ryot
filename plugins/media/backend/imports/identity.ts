export const mediaEntityOperationId = (itemIndex: number) =>
	JSON.stringify(["media", itemIndex, "entity"]);

export const mediaLibraryOperationId = (itemIndex: number) =>
	JSON.stringify(["media", itemIndex, "library"]);

export const mediaLibraryMembershipOperationId = (itemIndex: number) =>
	JSON.stringify(["media", itemIndex, "library-membership"]);

export const mediaCollectionOperationId = (itemIndex: number, collectionName: string) =>
	JSON.stringify(["media", itemIndex, "collection", collectionName]);

export const mediaEventOperationId = (rowIndex: number, eventIndex: number) =>
	JSON.stringify(["media-event", rowIndex, eventIndex]);

export const mediaMembershipOperationId = (rowIndex: number, collectionName: string) =>
	JSON.stringify(["media-membership", rowIndex, collectionName]);

export const mediaAssociationOperationId = (rowIndex: number) =>
	JSON.stringify(["media-association", rowIndex]);

export const mediaSourceFailureOperationId = (
	rowIndex: number,
	eventIndexBase: number,
	ordinal: number,
) => JSON.stringify(["media-source", rowIndex, eventIndexBase, ordinal]);

export const mediaRecordId = (itemIndex: number) => JSON.stringify(["media", itemIndex]);

export const mediaSourceRecordId = (rowIndex: number) => JSON.stringify(["media-source", rowIndex]);
