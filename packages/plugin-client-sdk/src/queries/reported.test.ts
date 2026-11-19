import { expect, it } from "bun:test";

import { reportingPageParam } from "./reported";

it("keeps the requested selection stable with its continuation", () => {
	const selection = {
		grouping: "day",
		comparison: "none",
		range: { kind: "custom", endDate: "2026-03-08", startDate: "2026-03-01" },
	} as const;
	expect(
		reportingPageParam({
			reporting: { requestedSelection: selection },
			pageInfo: { hasMore: true, nextCursor: "next" },
		}),
	).toEqual({ selection, after: "next" });
	expect(
		reportingPageParam({
			reporting: { requestedSelection: selection },
			pageInfo: { hasMore: false, nextCursor: null },
		}),
	).toBeNull();
});
