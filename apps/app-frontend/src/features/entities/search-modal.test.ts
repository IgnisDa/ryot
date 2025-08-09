import { describe, expect, it } from "bun:test";

import { createAppCollectionFixture } from "~/features/test-fixtures";

import {
	defaultSearchResultRowActionState,
	type SearchResultRowActionState,
} from "./search-result-row";

describe("search-modal collection panel submission", () => {
	describe("success notification with collection name", () => {
		it("includes collection name in success message", () => {
			const itemName = "Test Movie";
			const collectionName = "My Favorites";
			const selectedCollectionId = "collection-123";

			const collections = [
				createAppCollectionFixture({ id: "collection-1", name: "Watchlist" }),
				createAppCollectionFixture({
					id: selectedCollectionId,
					name: collectionName,
				}),
			];

			const selectedCollection = collections.find((c) => c.id === selectedCollectionId);
			const resolvedName = selectedCollection?.name ?? "collection";

			const message = `${itemName} was added to ${resolvedName}.`;

			expect(message).toBe("Test Movie was added to My Favorites.");
		});

		it("falls back to generic 'collection' when collection not found", () => {
			const itemName = "Test Book";
			const collections: ReturnType<typeof createAppCollectionFixture>[] = [];

			const selectedCollection = collections.find((c) => c.id === "missing-id");
			const resolvedName = selectedCollection?.name ?? "collection";

			const message = `${itemName} was added to ${resolvedName}.`;

			expect(message).toBe("Test Book was added to collection.");
		});
	});

	describe("displayError computation in SearchResultRow", () => {
		it("shows actionError when present", () => {
			const actionState: SearchResultRowActionState = {
				...defaultSearchResultRowActionState,
				openPanel: null,
				pendingAction: null,
				actionError: "Failed to save log",
			};
			const addStatus: string = "idle";
			const addError = undefined;

			const displayError =
				actionState.actionError ??
				(addStatus === "error" ? (addError ?? "Failed to add item") : null);

			expect(displayError).toBe("Failed to save log");
		});

		it("falls back to addError when actionError is null and addStatus is error", () => {
			const actionState: SearchResultRowActionState = {
				...defaultSearchResultRowActionState,
				openPanel: null,
				actionError: null,
				pendingAction: null,
			};
			const addStatus: string = "error";
			const addError = "Entity creation failed";

			const displayError =
				actionState.actionError ??
				(addStatus === "error" ? (addError ?? "Failed to add item") : null);

			expect(displayError).toBe("Entity creation failed");
		});

		it("shows no error when both actionError and addStatus are clean", () => {
			const actionState: SearchResultRowActionState = {
				...defaultSearchResultRowActionState,
				openPanel: null,
				actionError: null,
				pendingAction: null,
			};
			const addStatus: string = "idle";
			const addError = undefined;

			const displayError =
				actionState.actionError ??
				(addStatus === "error" ? (addError ?? "Failed to add item") : null);

			expect(displayError).toBeNull();
		});
	});
});
