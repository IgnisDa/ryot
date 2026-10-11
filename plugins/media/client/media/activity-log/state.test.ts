import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import { describe, expect, it } from "vitest";

import { mediaActivityLogContextRecipe } from "../../../shared/activity-log-recipes";
import { MediaActivityLogInput } from "../../../shared/media-activity-operations";
import { contextTarget } from "../../../tests/client/activity-log/fixtures";
import { rowsResult } from "../../../tests/client/query-result-fixture";
import {
	activityCopyLabels,
	type ActivityDraft,
	activityDraftErrors,
	activityEntryDraft,
	activityIntents,
	activityLogInput,
	activityRuntimeHint,
	activityStatusNote,
	backfillSummary,
	defaultSeasonNumber,
	initialActivityDraft,
	localDay,
	type MediaActivityLogger,
	parseTimeSpent,
	percentFromUnit,
	resolveActivityWhen,
	selectedEpisode,
	unitFromPercent,
} from "./state";

const copy = { verb: "watch", noun: "movie", gerund: "watching", participle: "watched" };

const flat: MediaActivityLogger = {
	copy,
	family: "flat",
	progressUnit: { field: "runtime", plural: "minutes", singular: "minute" },
};
const positional: MediaActivityLogger = {
	copy,
	family: "positional",
	progressUnit: { field: "episodes", plural: "episodes", singular: "episode" },
};
const show: MediaActivityLogger = { copy, family: "show" };
const podcast: MediaActivityLogger = { copy, family: "podcast" };

const context = (overrides: Record<string, unknown> = {}) =>
	Result.getOrThrow(
		mediaActivityLogContextRecipe({ entityId: "entity-1", reference: { kind: "self" } }).decode({
			data: {
				recentConsumedOn: { items: [], type: "aggregate", pageInfo: { limit: 5, hasMore: false } },
				entityConsumedOn: { items: [], type: "aggregate", pageInfo: { limit: 10, hasMore: false } },
				target: rowsResult([contextTarget(overrides)], {
					limit: 1,
					hasMore: false,
					nextCursor: null,
				}),
			},
		}),
	);

const loaded = (overrides: Record<string, unknown> = {}) => {
	const value = context(overrides);
	if (value === null) {
		throw new Error("Expected a context");
	}
	return value;
};

const TODAY = "2026-10-20";
const submittedAt = (hour: number) => new Date(2026, 9, 20, hour, 15).toISOString();
const noon = (day: number) => new Date(2026, 9, day, 12).toISOString();

const draft = (overrides: Partial<ActivityDraft> = {}): ActivityDraft => ({
	...initialActivityDraft(flat, loaded(), TODAY),
	...overrides,
});

const order = (logger: MediaActivityLogger) => activityIntents(logger).map(({ label }) => label);

describe("intents", () => {
	it("orders intents per family and defaults to the first", () => {
		expect(order(flat)).toEqual(["Finished", "Progress", "Status"]);
		expect(order(positional)).toEqual(["Progress", "Finished", "Status"]);
		expect(order(show)).toEqual(["Episode", "Status"]);
		expect(order(podcast)).toEqual(["Episode", "Status"]);
		expect(initialActivityDraft(flat, loaded(), TODAY).intent).toBe("finished");
		expect(initialActivityDraft(positional, loaded(), TODAY).intent).toBe("progress");
		expect(initialActivityDraft(show, loaded(), TODAY).intent).toBe("episode");
	});

	it("defaults progress from the entity's current state", () => {
		expect(initialActivityDraft(flat, loaded(), TODAY)).toMatchObject({
			percent: "30",
			progressMode: "started",
		});
		expect(initialActivityDraft(flat, loaded({ progressPercent: 42.4 }), TODAY)).toMatchObject({
			percent: "42",
			progressMode: "amount",
		});
		expect(initialActivityDraft(positional, loaded(), TODAY).position).toBe(1);
		expect(
			initialActivityDraft(positional, loaded({ position: 12, episodes: 28 }), TODAY).position,
		).toBe(13);
		expect(
			initialActivityDraft(positional, loaded({ position: 28, episodes: 28 }), TODAY).position,
		).toBe(28);
	});
});

describe("picked dates", () => {
	it("uses the submission instant for today so a morning pick is never in the future", () => {
		const at = submittedAt(9);
		expect(
			resolveActivityWhen({ kind: "date", startedDay: TODAY, finishedDay: TODAY }, at),
		).toEqual({ kind: "date", startedOn: at, finishedOn: at });
	});

	it("uses local noon for past days and clamps a start to its finish", () => {
		const at = submittedAt(9);
		expect(
			resolveActivityWhen(
				{ kind: "date", startedDay: "2026-10-17", finishedDay: "2026-10-19" },
				at,
			),
		).toEqual({ kind: "date", startedOn: noon(17), finishedOn: noon(19) });
		expect(
			resolveActivityWhen(
				{ kind: "date", startedDay: "2026-10-19", finishedDay: "2026-10-19" },
				at,
			),
		).toEqual({ kind: "date", startedOn: noon(19), finishedOn: noon(19) });
		expect(resolveActivityWhen({ kind: "date", finishedDay: "2026-10-19" }, at)).toEqual({
			kind: "date",
			finishedOn: noon(19),
		});
	});

	it("passes now and unknown through", () => {
		expect(resolveActivityWhen({ kind: "now" }, submittedAt(9))).toEqual({ kind: "now" });
		expect(resolveActivityWhen({ kind: "unknown" }, submittedAt(9))).toEqual({ kind: "unknown" });
	});

	it("builds an input the operation accepts at any time of day, and rejects later days", () => {
		const accepted = (hour: number, finishedDay: string, startedDay?: string) =>
			Schema.decodeResult(MediaActivityLogInput)(
				activityLogInput(
					{
						kind: "complete",
						entityId: "entity-1",
						when: {
							finishedDay,
							kind: "date",
							...(startedDay === undefined ? {} : { startedDay }),
						},
					},
					{ submissionId: "submission-1", submittedAt: submittedAt(hour) },
				),
			)._tag === "Success";
		expect(accepted(0, TODAY, TODAY)).toBe(true);
		expect(accepted(9, TODAY, TODAY)).toBe(true);
		expect(accepted(23, TODAY, "2026-10-01")).toBe(true);
		expect(accepted(9, "2026-10-19", "2026-10-19")).toBe(true);
		expect(
			Schema.decodeResult(MediaActivityLogInput)({
				submittedAt: submittedAt(9),
				submissionId: "submission-1",
				entry: {
					kind: "complete",
					entityId: "entity-1",
					when: { kind: "date", finishedOn: noon(20) },
				},
			})._tag,
		).toBe("Failure");
	});

	it("formats the local day of a timestamp", () => {
		expect(localDay(new Date(2026, 9, 5, 23, 59).getTime())).toBe("2026-10-05");
	});
});

const errors = (value: ActivityDraft, logger: MediaActivityLogger = flat, extra = {}) =>
	activityDraftErrors({ logger, draft: value, today: TODAY, context: loaded(extra) });

describe("validation", () => {
	it("accepts the defaults", () => {
		expect(errors(draft())).toEqual({});
	});

	it("requires a real, non-future finish day and an ordered start", () => {
		expect(errors(draft({ when: "date", finishedDay: "" })).when).toBeDefined();
		expect(errors(draft({ when: "date", finishedDay: "2026-02-31" })).when).toBeDefined();
		expect(errors(draft({ when: "date", finishedDay: "2026-10-21" })).when).toBe(
			"That day is in the future.",
		);
		expect(
			errors(draft({ when: "date", startedDay: "2026-10-11", finishedDay: "2026-10-10" })).when,
		).toBeDefined();
		expect(
			errors(draft({ when: "date", startedDay: "nope", finishedDay: "2026-10-10" })).when,
		).toBeDefined();
		expect(
			errors(draft({ when: "date", startedDay: "2026-10-10", finishedDay: "2026-10-10" })),
		).toEqual({});
		expect(errors(draft({ when: "date", finishedDay: "" }), flat).when).toBeDefined();
		expect(errors(draft({ when: "unknown", finishedDay: "" }))).toEqual({});
	});

	it("ignores a stale start on the episode intent", () => {
		expect(
			errors(
				draft({ when: "date", intent: "episode", startedDay: "nope", finishedDay: "2026-10-10" }),
				show,
			),
		).toEqual({});
	});

	it("bounds percent, position, time and source", () => {
		const progress = draft({ intent: "progress", progressMode: "amount" });
		expect(errors({ ...progress, percent: "0" }).percent).toBeDefined();
		expect(errors({ ...progress, percent: "101" }).percent).toBeDefined();
		expect(errors({ ...progress, percent: "x" }).percent).toBeDefined();
		expect(errors({ ...progress, percent: "100" })).toEqual({});
		expect(errors({ ...progress, percent: "x", progressMode: "started" })).toEqual({});
		const position = draft({ intent: "progress" });
		expect(errors({ ...position, position: 0 }, positional).position).toBeDefined();
		expect(errors({ ...position, position: undefined }, positional).position).toBeDefined();
		expect(errors({ ...position, position: 29 }, positional, { episodes: 28 }).position).toContain(
			"1 to 28",
		);
		expect(errors({ ...position, position: 28 }, positional, { episodes: 28 })).toEqual({});
		expect(errors({ ...position, position: 500 }, positional)).toEqual({});
		expect(errors(draft({ hours: "1.5" })).time).toBeDefined();
		expect(errors(draft({ minutes: "-5" })).time).toBeDefined();
		expect(errors(draft({ consumedOn: "x".repeat(101) })).consumedOn).toBeDefined();
		expect(errors(draft({ intent: "status", consumedOn: "x".repeat(101) }))).toEqual({});
	});

	it("parses h + m into minutes and treats empty or zero as omitted", () => {
		expect(parseTimeSpent("2", "30")).toBe(150);
		expect(parseTimeSpent("", "45")).toBe(45);
		expect(parseTimeSpent("", "")).toBeUndefined();
		expect(parseTimeSpent("0", "0")).toBeUndefined();
		expect(parseTimeSpent("a", "")).toBeNull();
	});
});

const entry = (
	value: Partial<ActivityDraft>,
	logger: MediaActivityLogger = flat,
	episodeEntityIds: readonly string[] = [],
) => activityEntryDraft({ logger, episodeEntityIds, draft: draft(value), entityId: "entity-1" });

describe("entries", () => {
	it("builds Finished with trimmed source and time", () => {
		expect(entry({})).toEqual({ kind: "complete", entityId: "entity-1", when: { kind: "now" } });
		expect(entry({ hours: "1", minutes: "5", when: "unknown", consumedOn: "  Plex " })).toEqual({
			timeSpent: 65,
			kind: "complete",
			consumedOn: "Plex",
			entityId: "entity-1",
			when: { kind: "unknown" },
		});
		expect(
			entry({ when: "date", startedDay: "2026-10-17", finishedDay: "2026-10-19" }),
		).toMatchObject({
			when: { kind: "date", startedDay: "2026-10-17", finishedDay: "2026-10-19" },
		});
		expect(entry({ when: "date", startedDay: "", finishedDay: "2026-10-19" })).toMatchObject({
			when: { kind: "date", finishedDay: "2026-10-19" },
		});
	});

	it("builds flat progress with and without a percent", () => {
		expect(entry({ intent: "progress", progressMode: "started" })).toEqual({
			kind: "progress",
			entityId: "entity-1",
		});
		expect(entry({ percent: "42.5", intent: "progress", progressMode: "amount" })).toEqual({
			kind: "progress",
			entityId: "entity-1",
			progressPercent: 42.5,
		});
	});

	it("builds positional progress with a position and no percent", () => {
		expect(
			entry({ position: 13, intent: "progress", consumedOn: "Crunchyroll" }, positional),
		).toEqual({ position: 13, kind: "progress", entityId: "entity-1", consumedOn: "Crunchyroll" });
	});

	it("builds status and episodes", () => {
		expect(entry({ intent: "status", status: "dropped", consumedOn: "ignored" })).toEqual({
			kind: "status",
			status: "dropped",
			entityId: "entity-1",
		});
		expect(
			entry(
				{ when: "date", intent: "episode", startedDay: "2026-10-01", finishedDay: "2026-10-19" },
				show,
				["e3", "e4"],
			),
		).toEqual({
			kind: "episodes",
			parentEntityId: "entity-1",
			episodeEntityIds: ["e3", "e4"],
			when: { kind: "date", finishedDay: "2026-10-19" },
		});
	});

	it("stamps submission fields and resolves dates once", () => {
		const input = activityLogInput(entry({ when: "date", startedDay: TODAY, finishedDay: TODAY }), {
			submittedAt: submittedAt(9),
			submissionId: "submission-1",
		});
		expect(input).toEqual({
			submittedAt: submittedAt(9),
			submissionId: "submission-1",
			entry: {
				kind: "complete",
				entityId: "entity-1",
				when: { kind: "date", startedOn: submittedAt(9), finishedOn: submittedAt(9) },
			},
		});
	});
});

const labels = (value: ActivityDraft, logger: MediaActivityLogger = flat, count = 1) =>
	activityCopyLabels({
		logger,
		name: "Heat",
		draft: value,
		episodeCount: count,
		episodeCode: "S2·E5",
	});

describe("episodes and copy", () => {
	it("defaults the season to the next-up season, else the first regular one", () => {
		const seasons = [
			{ id: "s0", seasonNumber: 0, name: "Specials" },
			{ id: "s1", seasonNumber: 1, name: "Season 1" },
			{ id: "s2", seasonNumber: 2, name: "Season 2" },
		];
		const nextUp = { id: "e", name: "E", seasonNumber: 2, episodeNumber: 5 };
		expect(defaultSeasonNumber({ nextUp, seasons })).toBe(2);
		expect(defaultSeasonNumber({ seasons, nextUp: null })).toBe(1);
		expect(defaultSeasonNumber({ nextUp: null, seasons: seasons.slice(0, 1) })).toBe(0);
		expect(defaultSeasonNumber({ seasons: [], nextUp: null })).toBeUndefined();
	});

	it("selects the explicit choice, then next-up for its season, then the first listed", () => {
		const choices = [
			{ id: "a", name: "A", seasonNumber: 1, episodeNumber: 1, state: "complete" as const },
			{ id: "b", name: "B", seasonNumber: 1, episodeNumber: 2, state: "untracked" as const },
		];
		const nextUp = { id: "b", name: "B", seasonNumber: 1, episodeNumber: 2 };
		const pick = (selectedId: string | undefined, season: number | null, up = nextUp) =>
			selectedEpisode({ choices, nextUp: up, selectedId, seasonNumber: season })?.id;
		expect(pick("a", 1)).toBe("a");
		expect(pick(undefined, 1)).toBe("b");
		expect(pick(undefined, 2)).toBe("a");
		expect(
			selectedEpisode({ nextUp, choices: [], seasonNumber: 1, selectedId: undefined }),
		).toMatchObject({ id: "b", seasonNumber: 1, state: "untracked" });
	});

	it("summarises earlier episodes with codes and a remainder", () => {
		const earlier = [3, 4, 5, 6, 7].map((episodeNumber) => ({ episodeNumber, seasonNumber: 2 }));
		expect(backfillSummary(show, earlier)).toEqual({
			label: "Also mark 5 earlier unwatched episodes",
			detail: "S2·E3, S2·E4, S2·E5 and 2 more · specials never included",
		});
		expect(backfillSummary(podcast, earlier.slice(0, 1))).toEqual({
			detail: "Episode 3 · specials never included",
			label: "Also mark 1 earlier unwatched episode",
		});
	});

	it("labels submit and success per intent", () => {
		expect(labels(draft())).toEqual({
			offerReview: true,
			submit: "Mark as watched",
			success: "Heat marked as watched.",
		});
		expect(labels(draft({ when: "unknown" })).success).toBe(
			"Heat marked as watched (date unknown).",
		);
		expect(labels(draft({ intent: "progress", progressMode: "started" }))).toMatchObject({
			submit: "Start watching",
			success: "Marked as watching.",
		});
		expect(
			labels(draft({ percent: "40", intent: "progress", progressMode: "amount" })),
		).toMatchObject({ submit: "Save progress", success: "Progress saved at 40%." });
		expect(labels(draft({ position: 13, intent: "progress" }), positional).success).toBe(
			"Now watched through episode 13.",
		);
		expect(labels(draft({ intent: "episode" }), show)).toMatchObject({
			submit: "Mark S2·E5 watched",
			success: "S2·E5 marked watched.",
		});
		expect(labels(draft({ intent: "episode" }), show, 4)).toMatchObject({
			submit: "Mark 4 episodes watched",
			success: "4 episodes marked watched.",
		});
		expect(labels(draft({ intent: "status", status: "on_hold" }))).toMatchObject({
			submit: "Put on hold",
			success: "Put on hold.",
		});
	});

	it("explains what a status keeps", () => {
		expect(activityStatusNote(flat, loaded({ progressPercent: 42 }))).toBe(
			"Keeps your progress at 42%.",
		);
		expect(activityStatusNote(flat, loaded())).toBeUndefined();
		expect(activityStatusNote(positional, loaded({ position: 113 }))).toBe(
			"Keeps your place at episode 113.",
		);
		expect(activityStatusNote(show, loaded())).toBe(
			"Episodes you have already marked stay as they are.",
		);
	});

	it("converts between percent and a unit amount", () => {
		expect(percentFromUnit("85", 170)).toBe("50");
		expect(percentFromUnit("0", 170)).toBeUndefined();
		expect(percentFromUnit("500", 170)).toBe("100");
		expect(unitFromPercent("50", 170)).toBe("85");
		expect(unitFromPercent("x", 170)).toBe("");
	});

	it("hints the runtime only when known", () => {
		expect(activityRuntimeHint(170)).toBe("Leave empty to use the runtime (2h 50m).");
		expect(activityRuntimeHint(null)).toBe("Leave empty if you don't know.");
	});
});
