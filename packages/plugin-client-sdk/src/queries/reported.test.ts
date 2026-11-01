import { expect, it } from "vitest";

import { reportingPageParam } from "./reported";

it("pins a reporting page's resolved selection with its continuation", () => {
	const selection = {
		grouping: "day",
		comparison: "none",
		range: { kind: "custom", endDate: "2026-03-08", startDate: "2026-03-01" },
	} as const;
	expect(
		reportingPageParam({
			reporting: { selection },
			pageInfo: { hasMore: true, nextCursor: "next" },
		}),
	).toEqual({ selection, after: "next" });
	expect(
		reportingPageParam({
			reporting: { selection },
			pageInfo: { hasMore: false, nextCursor: null },
		}),
	).toBeNull();
});
