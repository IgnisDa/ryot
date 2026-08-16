import { describe, expect, it } from "vitest";

import {
	malformedQueryResult,
	pendingQueryResult,
	readyQueryResult,
	transportErrorQueryResult,
} from "../../tests/client/query-result-fixture";
import {
	decodeShowSummary,
	decodeShowSummaryResult,
	showSummaryRow,
} from "../../tests/client/show/summary-fixture";
import {
	mapShowSummary,
	showEpisodeCountLabel,
	showEpisodeFact,
	showLifecycleLabel,
	showSeasonCountLabel,
	showSeasonFact,
	showSummaryError,
	showSummaryUnavailable,
} from "./summary-state";

describe("show summary state", () => {
	it("maps a pending query to the loading state", () => {
		expect(mapShowSummary(pendingQueryResult())).toEqual({ status: "loading" });
	});

	it("maps a malformed decode failure apart from a transport failure", () => {
		expect(mapShowSummary(malformedQueryResult()).status).toBe("malformed");
		expect(mapShowSummary(transportErrorQueryResult()).status).toBe("transport-error");
	});

	it("maps an absent entity to the missing unavailable reason", () => {
		const value = decodeShowSummaryResult({ show: [], requested: [] });

		expect(mapShowSummary(readyQueryResult(value))).toEqual({
			reason: "missing",
			status: "unavailable",
		});
	});

	it("maps a non-show entity to the unsupported unavailable reason", () => {
		const value = decodeShowSummaryResult({ show: [], requested: [{ schemaSlug: "book" }] });

		expect(mapShowSummary(readyQueryResult(value))).toEqual({
			reason: "unsupported",
			status: "unavailable",
		});
	});

	it("maps a decoded show to the ready state", () => {
		const value = decodeShowSummaryResult({
			show: [showSummaryRow],
			requested: [{ schemaSlug: "show" }],
		});

		expect(mapShowSummary(readyQueryResult(value))).toMatchObject({
			status: "ready",
			show: { id: "show-1", name: "Adolescence" },
		});
	});

	it("keeps error copy free of decoder and transport internals", () => {
		expect(showSummaryError({ status: "malformed" })).toEqual({
			title: "Unable to display this show",
			detail: "This show returned data that could not be displayed. Try again later.",
		});
		expect(showSummaryError({ status: "transport-error" }).detail).not.toContain("RyotQL");
		expect(showSummaryUnavailable("missing").title).toBe("Show unavailable");
		expect(showSummaryUnavailable("unsupported").title).toBe("Show unavailable");
	});

	it("omits counts that the provider did not record", () => {
		const sparse = decodeShowSummary({ totalSeasons: null, totalEpisodes: null });

		expect(showSeasonFact(sparse)).toBeUndefined();
		expect(showEpisodeFact(sparse)).toBeUndefined();
		expect(showSeasonCountLabel(sparse)).toBeUndefined();
		expect(showEpisodeCountLabel(sparse)).toBeUndefined();
	});

	it("pluralizes recorded season and episode counts", () => {
		const show = decodeShowSummary({ totalSeasons: 1, totalEpisodes: 4 });

		expect(showSeasonCountLabel(show)).toBe("1 season");
		expect(showEpisodeCountLabel(show)).toBe("4 episodes");
	});

	it("splits counts into a bare value and a pluralized fact label", () => {
		const single = decodeShowSummary({ totalSeasons: 1, totalEpisodes: 1 });
		const many = decodeShowSummary({ totalSeasons: 6, totalEpisodes: 71 });

		expect(showSeasonFact(single)).toEqual({ value: "1", label: "Season" });
		expect(showEpisodeFact(single)).toEqual({ value: "1", label: "Episode" });
		expect(showSeasonFact(many)).toEqual({ value: "6", label: "Seasons" });
		expect(showEpisodeFact(many)).toEqual({ value: "71", label: "Episodes" });
	});

	it("labels every episodic lifecycle state, caught up included", () => {
		expect(showLifecycleLabel("untracked")).toBe("Not tracked");
		expect(showLifecycleLabel("backlog")).toBe("In backlog");
		expect(showLifecycleLabel("in_progress")).toBe("In progress");
		expect(showLifecycleLabel("on_hold")).toBe("On hold");
		expect(showLifecycleLabel("dropped")).toBe("Dropped");
		expect(showLifecycleLabel("caught_up")).toBe("Caught up");
		expect(showLifecycleLabel("complete")).toBe("Complete");
	});
});
