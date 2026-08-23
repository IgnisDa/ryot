import { castDate, eventIsAfter, literal, table } from "@ryot-app/sandbox-sdk/ryotql";
import { describe, expect, it } from "vitest";

import {
	currentCycleChildEventsRecipe,
	replayCurrentCycleCoverage,
	showEpisodicKindConfig,
	type CurrentCycleChildEvent,
} from "./lifecycle-recipes";

const childEvent = (
	id: string,
	entityId: string,
	eventSchemaSlug: "progress" | "complete",
	consumedOn: string | null,
): CurrentCycleChildEvent => ({
	id,
	entityId,
	consumedOn,
	eventSchemaSlug,
	createdAt: `2026-01-01T00:00:0${id}.000Z`,
	occurredAt: `2026-01-01T00:00:0${id}.000Z`,
});

describe("media lifecycle recipes", () => {
	it("orders current-cycle child events by the complete ascending event tuple", () => {
		const recipe = currentCycleChildEventsRecipe({
			boundary: null,
			parentEntityId: "show-1",
			config: showEpisodicKindConfig,
		});
		const query = recipe.document.queries["events"];
		if (query?.output.type !== "rows") {
			throw new Error("Expected child event rows query");
		}

		expect(query.output.orderBy).toEqual([
			{
				direction: "asc",
				expr: { field: "occurredAt", tableAlias: "currentCycleEvent", type: "column" },
			},
			{
				direction: "asc",
				expr: { field: "createdAt", tableAlias: "currentCycleEvent", type: "column" },
			},
			{ direction: "asc", expr: { field: "id", tableAlias: "currentCycleEvent", type: "column" } },
		]);
	});

	it("casts fixed completion-boundary timestamps for chronological comparisons", () => {
		const boundary = {
			id: "parent-complete-1",
			createdAt: "2026-01-01T00:00:01.000Z",
			occurredAt: "2026-01-01T00:00:00.000Z",
		};
		const recipe = currentCycleChildEventsRecipe({
			boundary,
			parentEntityId: "show-1",
			config: showEpisodicKindConfig,
		});
		const query = recipe.document.queries["events"];
		if (query?.output.type !== "rows") {
			throw new Error("Expected child event rows query");
		}
		const where = query.where;
		if (where?.type !== "and") {
			throw new Error("Expected child event rows with an and predicate");
		}

		expect(where.predicates.at(-1)).toEqual(
			eventIsAfter(table("event", "currentCycleEvent"), {
				id: literal(boundary.id),
				createdAt: castDate(literal(boundary.createdAt)),
				occurredAt: castDate(literal(boundary.occurredAt)),
			}),
		);
	});

	it("does not treat duplicate completion as another coverage-closing event", () => {
		expect(
			replayCurrentCycleCoverage(
				["episode-1", "episode-2"],
				[
					childEvent("1", "episode-1", "complete", "Jellyfin"),
					childEvent("2", "episode-2", "complete", "Jellyfin"),
					childEvent("3", "episode-2", "complete", "Jellyfin"),
				],
			),
		).toEqual({
			agreedConsumedOn: "Jellyfin",
			coverageComplete: true,
			coverageClosingEvent: {
				id: "2",
				createdAt: "2026-01-01T00:00:02.000Z",
				occurredAt: "2026-01-01T00:00:02.000Z",
			},
		});
	});

	it("reopens coverage on progress and uses latest completions at the next closure", () => {
		const replay = replayCurrentCycleCoverage(
			["episode-1", "episode-2"],
			[
				childEvent("1", "episode-1", "complete", "Jellyfin"),
				childEvent("2", "episode-2", "complete", "Jellyfin"),
				childEvent("3", "episode-2", "complete", "Plex"),
				childEvent("4", "episode-1", "progress", null),
				childEvent("5", "episode-1", "complete", "Plex"),
			],
		);

		expect(replay).toEqual({
			agreedConsumedOn: "Plex",
			coverageComplete: true,
			coverageClosingEvent: {
				id: "5",
				createdAt: "2026-01-01T00:00:05.000Z",
				occurredAt: "2026-01-01T00:00:05.000Z",
			},
		});
	});

	it("never completes empty coverage and requires one agreed nonempty source", () => {
		expect(replayCurrentCycleCoverage([], [])).toEqual({
			agreedConsumedOn: null,
			coverageComplete: false,
			coverageClosingEvent: null,
		});
		expect(
			replayCurrentCycleCoverage(
				["episode-1", "episode-2"],
				[
					childEvent("1", "episode-1", "complete", ""),
					childEvent("2", "episode-2", "complete", ""),
				],
			).agreedConsumedOn,
		).toBeNull();
	});
});
