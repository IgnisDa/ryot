import { Effect } from "effect";

import type { RyotClient } from "../client/client";
import type { BrowserBulkAction } from "./selection-bar";

export const addToCollectionAction = (client: RyotClient): BrowserBulkAction => ({
	icon: "folder",
	label: "Add to collection",
	run: (entityIds) =>
		client.screens
			.changeCollectionMembers({ entityIds, kind: "add" })
			.pipe(Effect.map(({ kind }) => kind === "changed")),
});

export const removeFromCollectionAction = (
	client: RyotClient,
	collectionId: string,
): BrowserBulkAction => ({
	danger: true,
	label: "Remove",
	icon: "trash-2",
	run: (entityIds) =>
		client.screens
			.changeCollectionMembers({ entityIds, collectionId, kind: "remove" })
			.pipe(Effect.map(({ kind }) => kind === "changed")),
});
