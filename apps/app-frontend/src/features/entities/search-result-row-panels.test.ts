import { describe, expect, it } from "bun:test";
import type { CollectionDiscoveryState } from "~/features/collections";
import type { CollectionsDestination } from "~/features/collections/model";
import type { SearchResultRowActionState } from "./search-result-row";

describe("SearchResultCollectionPanel props", () => {
	describe("collection discovery state", () => {
		it("accepts loading state", () => {
			const state: CollectionDiscoveryState = { type: "loading" };
			expect(state.type).toBe("loading");
		});

		it("accepts empty state", () => {
			const state: CollectionDiscoveryState = { type: "empty" };
			expect(state.type).toBe("empty");
		});

		it("accepts collections state with collections array", () => {
			const state: CollectionDiscoveryState = {
				type: "collections",
				collections: [
					{
						id: "collection-1",
						name: "Test Collection",
						image: null,
						createdAt: new Date(),
						updatedAt: new Date(),
						membershipPropertiesSchema: null,
						entitySchemaSlug: "media",
					},
				],
			};
			expect(state.type).toBe("collections");
			if (state.type === "collections") {
				expect(state.collections).toHaveLength(1);
				const firstCollection = state.collections[0];
				if (firstCollection) {
					expect(firstCollection.id).toBe("collection-1");
				}
			}
		});
	});

	describe("collections destination", () => {
		it("accepts view destination with viewId", () => {
			const destination: CollectionsDestination = {
				type: "view",
				viewId: "view-123",
			};
			expect(destination.type).toBe("view");
			expect(destination.viewId).toBe("view-123");
		});

		it("accepts none destination", () => {
			const destination: CollectionsDestination = { type: "none" };
			expect(destination.type).toBe("none");
		});
	});

	describe("panel state integration", () => {
		it("can have collection panel open with loading state", () => {
			const actionState: SearchResultRowActionState = {
				rateStars: 0,
				logDate: "now",
				rateReview: "",
				openPanel: "collection",
				doneActions: [],
				logStartedOn: "",
				rateStarsHover: 0,
				actionError: null,
				logCompletedOn: "",
				pendingAction: null,
				selectedCollectionId: null,
				collectionProperties: {},
			};
			const collectionState: CollectionDiscoveryState = { type: "loading" };

			expect(actionState.openPanel).toBe("collection");
			expect(collectionState.type).toBe("loading");
		});

		it("can have collection panel open with empty state", () => {
			const actionState: SearchResultRowActionState = {
				rateStars: 0,
				logDate: "now",
				rateReview: "",
				openPanel: "collection",
				doneActions: [],
				logStartedOn: "",
				rateStarsHover: 0,
				actionError: null,
				logCompletedOn: "",
				pendingAction: null,
				selectedCollectionId: null,
				collectionProperties: {},
			};
			const collectionState: CollectionDiscoveryState = { type: "empty" };
			const destination: CollectionsDestination = {
				type: "view",
				viewId: "collections-view",
			};

			expect(actionState.openPanel).toBe("collection");
			expect(collectionState.type).toBe("empty");
			expect(destination.type).toBe("view");
		});

		it("can have collection panel open with collections available", () => {
			const actionState: SearchResultRowActionState = {
				rateStars: 0,
				logDate: "now",
				rateReview: "",
				openPanel: "collection",
				doneActions: [],
				logStartedOn: "",
				rateStarsHover: 0,
				actionError: null,
				logCompletedOn: "",
				pendingAction: null,
				selectedCollectionId: "collection-1",
				collectionProperties: {},
			};
			const collectionState: CollectionDiscoveryState = {
				type: "collections",
				collections: [
					{
						id: "collection-1",
						name: "Favorites",
						image: null,
						createdAt: new Date(),
						updatedAt: new Date(),
						membershipPropertiesSchema: null,
						entitySchemaSlug: "media",
					},
				],
			};

			expect(actionState.openPanel).toBe("collection");
			expect(collectionState.type).toBe("collections");
			expect(actionState.selectedCollectionId).toBe("collection-1");
		});
	});
});

describe("SearchResultCollectionPanel entity ensuring", () => {
	it("can be in entity ensuring state with pending collection action", () => {
		const actionState: SearchResultRowActionState = {
			rateStars: 0,
			logDate: "now",
			rateReview: "",
			openPanel: "collection",
			doneActions: [],
			logStartedOn: "",
			rateStarsHover: 0,
			actionError: null,
			logCompletedOn: "",
			pendingAction: "collection",
			selectedCollectionId: "collection-1",
			collectionProperties: {},
		};
		const isEnsuringEntity = actionState.pendingAction === "collection";

		expect(actionState.openPanel).toBe("collection");
		expect(actionState.pendingAction).toBe("collection");
		expect(isEnsuringEntity).toBe(true);
	});

	it("is not in entity ensuring state when no pending action", () => {
		const actionState: SearchResultRowActionState = {
			rateStars: 0,
			logDate: "now",
			rateReview: "",
			openPanel: "collection",
			doneActions: [],
			logStartedOn: "",
			rateStarsHover: 0,
			actionError: null,
			logCompletedOn: "",
			pendingAction: null,
			selectedCollectionId: "collection-1",
			collectionProperties: {},
		};
		const isEnsuringEntity = actionState.pendingAction === "collection";

		expect(actionState.openPanel).toBe("collection");
		expect(actionState.pendingAction).toBeNull();
		expect(isEnsuringEntity).toBe(false);
	});

	it("allows selecting collection while not ensuring entity", () => {
		const actionState: SearchResultRowActionState = {
			rateStars: 0,
			logDate: "now",
			rateReview: "",
			openPanel: "collection",
			doneActions: [],
			logStartedOn: "",
			rateStarsHover: 0,
			actionError: null,
			logCompletedOn: "",
			pendingAction: null,
			selectedCollectionId: null,
			collectionProperties: {},
		};
		const collectionState: CollectionDiscoveryState = {
			type: "collections",
			collections: [
				{
					id: "collection-1",
					name: "Favorites",
					image: null,
					createdAt: new Date(),
					updatedAt: new Date(),
					membershipPropertiesSchema: null,
					entitySchemaSlug: "media",
				},
			],
		};

		expect(actionState.selectedCollectionId).toBeNull();
		expect(collectionState.type).toBe("collections");
		expect(actionState.pendingAction).toBeNull();
	});
});
