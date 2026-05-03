import { describe, expect, it } from "bun:test";

import { dayjs } from "@ryot/ts-utils";

import { compareContinueItems, compareRateTheseItems, compareUpNextItems } from "./classification";

const date = (value: string) => dayjs(value).toDate();

describe("compareContinueItems", () => {
	it("sorts by progressAt desc, then entityId asc", () => {
		const items = [
			{ entityId: "b", progressAt: date("2024-01-01") },
			{ entityId: "a", progressAt: date("2024-01-02") },
			{ entityId: "c", progressAt: date("2024-01-01") },
		];

		expect(items.sort(compareContinueItems).map((item) => item.entityId)).toEqual(["a", "b", "c"]);
	});
});

describe("compareUpNextItems", () => {
	it("sorts by backlogAt desc, then entityId asc", () => {
		const items = [
			{ entityId: "b", backlogAt: date("2024-01-01") },
			{ entityId: "a", backlogAt: date("2024-01-02") },
			{ entityId: "c", backlogAt: date("2024-01-01") },
		];

		expect(items.sort(compareUpNextItems).map((item) => item.entityId)).toEqual(["a", "b", "c"]);
	});
});

describe("compareRateTheseItems", () => {
	it("sorts by completedOn (or completeAt) desc, then entityId asc", () => {
		const items = [
			{ entityId: "b", completeAt: date("2024-01-01"), completedOn: null },
			{
				entityId: "a",
				completeAt: date("2024-01-01"),
				completedOn: date("2024-01-02"),
			},
			{ entityId: "c", completeAt: date("2024-01-01"), completedOn: null },
		];

		expect(items.sort(compareRateTheseItems).map((item) => item.entityId)).toEqual(["a", "b", "c"]);
	});
});
