import { describe, expect, it } from "vitest";

import { RECENT_DESTINATION_LIMIT, recordRecent } from "#/modules/command-center/recents";

const recent = (n: number) => ({ icon: "list", href: `/${n}`, group: "Go to", label: `Item ${n}` });

describe("recent destinations", () => {
	it("puts the newest first and moves a repeat to the front", () => {
		const next = recordRecent([recent(1), recent(2)], recent(2));

		expect(next.map(({ href }) => href)).toEqual(["/2", "/1"]);
	});

	it("keeps only the last eight", () => {
		const full = Array.from({ length: RECENT_DESTINATION_LIMIT }, (_, index) => recent(index));
		const next = recordRecent(full, recent(99));

		expect(next).toHaveLength(RECENT_DESTINATION_LIMIT);
		expect(next[0]?.href).toBe("/99");
		expect(next.at(-1)?.href).toBe(`/${RECENT_DESTINATION_LIMIT - 2}`);
	});
});
