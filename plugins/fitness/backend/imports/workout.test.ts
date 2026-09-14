import { expect, it } from "vitest";

import { toWorkoutWriteItem } from "./workout";

it("does not emit media membership for fitness imports", () => {
	const item = toWorkoutWriteItem({
		itemIndex: 0,
		endedAt: null,
		exercises: [],
		name: "Morning workout",
		sourceIdentifier: "workout-1",
		sourceLabel: "Morning workout",
		startedAt: "2026-01-01T08:00:00.000Z",
	});

	expect(item.subjectEntityAlias).toBe("workout");
	expect(item.relationships).toEqual([]);
	expect(JSON.stringify(item)).not.toContain("in-library");
});
