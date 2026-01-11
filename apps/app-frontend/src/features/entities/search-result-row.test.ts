import { describe, expect, it } from "bun:test";
import {
	defaultSearchResultRowActionState,
	type SearchResultRowActionState,
} from "./search-result-row";

describe("SearchResultRowActionState", () => {
	describe("defaultSearchResultRowActionState", () => {
		it("includes collection-related default values", () => {
			expect(defaultSearchResultRowActionState.selectedCollectionId).toBeNull();
			expect(defaultSearchResultRowActionState.collectionProperties).toEqual(
				{},
			);
		});
	});

	describe("action state types", () => {
		it("allows collection as an openPanel value", () => {
			const state: SearchResultRowActionState = {
				...defaultSearchResultRowActionState,
				openPanel: "collection",
			};
			expect(state.openPanel).toBe("collection");
		});

		it("allows collection as a pendingAction value", () => {
			const state: SearchResultRowActionState = {
				...defaultSearchResultRowActionState,
				pendingAction: "collection",
			};
			expect(state.pendingAction).toBe("collection");
		});

		it("allows null openPanel value", () => {
			const state: SearchResultRowActionState = {
				...defaultSearchResultRowActionState,
				openPanel: null,
			};
			expect(state.openPanel).toBeNull();
		});

		it("allows log as an openPanel value", () => {
			const state: SearchResultRowActionState = {
				...defaultSearchResultRowActionState,
				openPanel: "log",
			};
			expect(state.openPanel).toBe("log");
		});

		it("allows rate as an openPanel value", () => {
			const state: SearchResultRowActionState = {
				...defaultSearchResultRowActionState,
				openPanel: "rate",
			};
			expect(state.openPanel).toBe("rate");
		});
	});

	describe("collection selection state", () => {
		it("can store a selected collection ID", () => {
			const state: SearchResultRowActionState = {
				...defaultSearchResultRowActionState,
				selectedCollectionId: "collection-123",
			};
			expect(state.selectedCollectionId).toBe("collection-123");
		});

		it("can store collection properties", () => {
			const state: SearchResultRowActionState = {
				...defaultSearchResultRowActionState,
				collectionProperties: { rating: 5, notes: "Great item" },
			};
			expect(state.collectionProperties).toEqual({
				rating: 5,
				notes: "Great item",
			});
		});
	});
});
