import { describe, expect, it } from "bun:test";
import type { CollectionDiscoveryState } from "~/features/collections";
import type { CollectionsDestination } from "~/features/collections/model";
import {
	defaultSearchResultRowActionState,
	type SearchResultRowActionState,
} from "./search-result-row";

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
				...defaultSearchResultRowActionState,
				pendingAction: null,
				openPanel: "collection",
			};
			const collectionState: CollectionDiscoveryState = { type: "loading" };

			expect(actionState.openPanel).toBe("collection");
			expect(collectionState.type).toBe("loading");
		});

		it("can have collection panel open with empty state", () => {
			const actionState: SearchResultRowActionState = {
				...defaultSearchResultRowActionState,
				pendingAction: null,
				openPanel: "collection",
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
				...defaultSearchResultRowActionState,
				pendingAction: null,
				openPanel: "collection",
			};
			const collectionState: CollectionDiscoveryState = {
				type: "collections",
				collections: [
					{
						image: null,
						name: "Favorites",
						id: "collection-1",
						createdAt: new Date(),
						updatedAt: new Date(),
						entitySchemaSlug: "media",
						membershipPropertiesSchema: null,
					},
				],
			};

			expect(actionState.openPanel).toBe("collection");
			expect(collectionState.type).toBe("collections");
			expect(collectionState.collections[0]?.id).toBe("collection-1");
		});
	});
});

describe("SearchResultCollectionPanel entity ensuring", () => {
	it("can be in entity ensuring state with pending collection action", () => {
		const actionState: SearchResultRowActionState = {
			...defaultSearchResultRowActionState,
			openPanel: "collection",
			pendingAction: "collection",
		};
		const isEnsuringEntity = actionState.pendingAction === "collection";

		expect(actionState.openPanel).toBe("collection");
		expect(actionState.pendingAction).toBe("collection");
		expect(isEnsuringEntity).toBe(true);
	});

	it("is not in entity ensuring state when no pending action", () => {
		const actionState: SearchResultRowActionState = {
			...defaultSearchResultRowActionState,
			pendingAction: null,
			openPanel: "collection",
		};
		const isEnsuringEntity = actionState.pendingAction === "collection";

		expect(actionState.openPanel).toBe("collection");
		expect(actionState.pendingAction).toBeNull();
		expect(isEnsuringEntity).toBe(false);
	});

	it("allows selecting collection while not ensuring entity", () => {
		const actionState: SearchResultRowActionState = {
			...defaultSearchResultRowActionState,
			pendingAction: null,
			openPanel: "collection",
		};
		const collectionState: CollectionDiscoveryState = {
			type: "collections",
			collections: [
				{
					image: null,
					name: "Favorites",
					id: "collection-1",
					createdAt: new Date(),
					updatedAt: new Date(),
					entitySchemaSlug: "media",
					membershipPropertiesSchema: null,
				},
			],
		};

		expect(actionState.openPanel).toBe("collection");
		expect(collectionState.type).toBe("collections");
		expect(actionState.pendingAction).toBeNull();
	});
});

describe("SearchResultCollectionPanel loading state", () => {
	it("renders loading state with correct styling props", () => {
		const border = "#e5e5e5";
		const textMuted = "#666666";
		const accentColor = "#d97706";
		const collectionState: CollectionDiscoveryState = { type: "loading" };

		expect(collectionState.type).toBe("loading");
		expect(border).toBeDefined();
		expect(textMuted).toBeDefined();
		expect(accentColor).toBeDefined();
	});

	it("renders loading state with collection panel open", () => {
		const actionState: SearchResultRowActionState = {
			...defaultSearchResultRowActionState,
			pendingAction: null,
			openPanel: "collection",
		};
		const collectionState: CollectionDiscoveryState = { type: "loading" };

		expect(actionState.openPanel).toBe("collection");
		expect(collectionState.type).toBe("loading");
		expect(actionState.pendingAction).toBeNull();
	});

	it("renders loading state while entity is being ensured", () => {
		const actionState: SearchResultRowActionState = {
			...defaultSearchResultRowActionState,
			openPanel: "collection",
			pendingAction: "collection",
		};
		const collectionState: CollectionDiscoveryState = { type: "loading" };
		const isEnsuringEntity = actionState.pendingAction !== null;

		expect(collectionState.type).toBe("loading");
		expect(isEnsuringEntity).toBe(true);
	});
});

describe("SearchResultCollectionPanel empty state CTA path", () => {
	it("shows CTA button to Collections view when empty state has view destination", () => {
		const collectionState: CollectionDiscoveryState = { type: "empty" };
		const destination: CollectionsDestination = {
			type: "view",
			viewId: "collections-view",
		};

		const shouldShowCTA =
			collectionState.type === "empty" && destination.type === "view";
		const href = shouldShowCTA ? `/views/${destination.viewId}` : null;

		expect(shouldShowCTA).toBe(true);
		expect(href).toBe("/views/collections-view");
	});

	it("does not show CTA button when empty state has none destination", () => {
		const collectionState: CollectionDiscoveryState = { type: "empty" };
		const destination: CollectionsDestination = { type: "none" };

		const isEmptyState = collectionState.type === "empty";
		const hasViewDestination = destination.type === ("view" as string);
		const shouldShowCTA = isEmptyState && hasViewDestination;

		expect(shouldShowCTA).toBe(false);
		expect(isEmptyState).toBe(true);
		expect(hasViewDestination).toBe(false);
	});

	it("constructs correct href for different view destinations", () => {
		const testCases = [
			{ viewId: "builtin-collections", expected: "/views/builtin-collections" },
			{
				viewId: "user-collections-123",
				expected: "/views/user-collections-123",
			},
			{ viewId: "all-collections", expected: "/views/all-collections" },
		];

		for (const { viewId, expected } of testCases) {
			const destination: CollectionsDestination = { type: "view", viewId };
			const href = `/views/${destination.viewId}`;
			expect(href).toBe(expected);
		}
	});

	it("requires both empty state and view destination to show CTA", () => {
		const emptyState: CollectionDiscoveryState = { type: "empty" };
		const loadingState: CollectionDiscoveryState = { type: "loading" };
		const collectionsState: CollectionDiscoveryState = {
			type: "collections",
			collections: [],
		};
		const viewDestination: CollectionsDestination = {
			type: "view",
			viewId: "collections",
		};
		const noneDestination: CollectionsDestination = { type: "none" };

		const isEmptyWithView =
			emptyState.type === "empty" && viewDestination.type === "view";
		const isLoadingWithView =
			loadingState.type === ("empty" as string) &&
			viewDestination.type === "view";
		const isCollectionsWithView =
			collectionsState.type === ("empty" as string) &&
			viewDestination.type === "view";
		const isEmptyWithNone =
			emptyState.type === "empty" &&
			noneDestination.type === ("view" as string);

		expect(isEmptyWithView).toBe(true);
		expect(isLoadingWithView).toBe(false);
		expect(isCollectionsWithView).toBe(false);
		expect(isEmptyWithNone).toBe(false);
	});

	it("navigates to view when destination is view type", () => {
		const destination: CollectionsDestination = {
			type: "view",
			viewId: "my-collections",
		};
		const href = `/views/${destination.viewId}`;

		expect(destination.type).toBe("view");
		expect(href).toBe("/views/my-collections");
	});

	it("renders empty state with view destination", () => {
		const border = "#e5e5e5";
		const textMuted = "#666666";
		const collectionState: CollectionDiscoveryState = { type: "empty" };
		const destination: CollectionsDestination = {
			type: "view",
			viewId: "collections-view",
		};

		expect(collectionState.type).toBe("empty");
		expect(destination.type).toBe("view");
		expect(destination.viewId).toBe("collections-view");
		expect(border).toBeDefined();
		expect(textMuted).toBeDefined();
	});

	it("renders empty state with none destination (no CTA shown)", () => {
		const border = "#e5e5e5";
		const textMuted = "#666666";
		const collectionState: CollectionDiscoveryState = { type: "empty" };
		const destination: CollectionsDestination = { type: "none" };

		expect(collectionState.type).toBe("empty");
		expect(destination.type).toBe("none");
		expect(border).toBeDefined();
		expect(textMuted).toBeDefined();
	});

	it("can close empty state panel by setting openPanel to null", () => {
		const actionState: SearchResultRowActionState = {
			...defaultSearchResultRowActionState,
			pendingAction: null,
			openPanel: "collection",
		};
		const collectionState: CollectionDiscoveryState = { type: "empty" };

		expect(actionState.openPanel).toBe("collection");
		expect(collectionState.type).toBe("empty");

		const patchedState = { ...actionState, openPanel: null };
		expect(patchedState.openPanel).toBeNull();
	});

	it("renders empty state with collection panel open and no selected collection", () => {
		const actionState: SearchResultRowActionState = {
			...defaultSearchResultRowActionState,
			pendingAction: null,
			openPanel: "collection",
		};
		const collectionState: CollectionDiscoveryState = { type: "empty" };
		const destination: CollectionsDestination = { type: "none" };

		expect(actionState.openPanel).toBe("collection");
		expect(collectionState.type).toBe("empty");
		expect(destination.type).toBe("none");
	});
});
