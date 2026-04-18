import { describe, expect, it } from "bun:test";
import {
	defaultSearchResultRowActionState,
	type SearchResultRowActionState,
} from "./search-result-row";

describe("SearchResultRowActionState", () => {
	describe("defaultSearchResultRowActionState", () => {
		it("keeps action errors empty by default", () => {
			expect(defaultSearchResultRowActionState.actionError).toBeNull();
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
});
