import { describe, expect, it } from "vitest";

import type { ShowEpisodeOrder } from "../../shared/show-episode-order";
import {
	orderByExternalIds,
	resolveShowEpisodeOrder,
	showOrderEpisodePage,
} from "./episode-order-state";

const dvdOrder: ShowEpisodeOrder = {
	groups: [],
	type: "dvd",
	name: "DVD Order",
	description: null,
	externalId: "order-dvd",
};

describe("show episode order state", () => {
	it("resolves a stored order the show still offers", () => {
		expect(resolveShowEpisodeOrder([dvdOrder], "order-dvd")).toEqual({
			stale: false,
			order: dvdOrder,
		});
	});

	it("falls back to aired order without a stored id, and marks an unknown one stale", () => {
		expect(resolveShowEpisodeOrder([dvdOrder], null)).toEqual({ order: null, stale: false });
		expect(resolveShowEpisodeOrder([dvdOrder], "order-gone")).toEqual({ order: null, stale: true });
	});

	it("pages a group's ids by offset until they run out", () => {
		const ids = ["a", "b", "c", "d", "e"];

		expect(showOrderEpisodePage(ids, null, 2)).toEqual({
			nextCursor: "2",
			externalIds: ["a", "b"],
		});
		expect(showOrderEpisodePage(ids, "2", 2)).toEqual({ nextCursor: "4", externalIds: ["c", "d"] });
		expect(showOrderEpisodePage(ids, "4", 2)).toEqual({ nextCursor: null, externalIds: ["e"] });
		expect(showOrderEpisodePage(["a", "b"], null, 2)).toEqual({
			nextCursor: null,
			externalIds: ["a", "b"],
		});
		expect(showOrderEpisodePage([], null, 2)).toBeNull();
	});

	it("orders rows by their id's first position in the group", () => {
		const rows = [{ externalId: "s1e1" }, { externalId: "s1e2" }, { externalId: "s2e1" }];

		expect(orderByExternalIds(rows, ["s2e1", "s1e2", "missing", "s1e1", "s2e1"])).toEqual([
			{ externalId: "s2e1" },
			{ externalId: "s1e2" },
			{ externalId: "s1e1" },
		]);
	});
});
