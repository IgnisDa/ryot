import { describe, expect, it } from "bun:test";

import { defaultSearchResultRowActionState } from "./search-result-row";

describe("SearchResultRowActionState", () => {
	describe("defaultSearchResultRowActionState", () => {
		it("keeps action errors empty by default", () => {
			expect(defaultSearchResultRowActionState.actionError).toBeNull();
		});
	});
});
