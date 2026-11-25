import { describe, expect, it } from "bun:test";

import type { AuthoredPluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { Predicate } from "@ryot-app/contract/modules/ryotql/authored";
import { revisionDefinitions } from "@ryot-app/definitions/source";
import { RyotQLService } from "@ryot-app/kernel-backend/modules/ryotql/service";
import { table } from "@ryot-app/ryotql";
import { signalScheduleRecipe } from "@ryot-app/ryotql-recipes/signal-schedules";
import { assert } from "@ryot-app/testing/assert";
import { objectContaining } from "@ryot-app/testing/matchers";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Result } from "effect";

import { libraryLinkExists, libraryLinkSource } from "../shared/entity-selections";
import {
	insertEntities,
	insertRelationships,
	linkToLibrary,
	mediaDatabaseLayer,
	mediaPluginId,
	type MediaUser,
	storeLibrarySummary,
	utcDay,
} from "../tests/media-database";
import { mediaPlugin } from "./plugin";

const { signalSchedules }: AuthoredPluginManifest = mediaPlugin;

const schedule = (slug: string) => {
	const found = signalSchedules.find((candidate) => candidate.slug === slug);
	if (!found) {
		throw new Error(`Missing signal schedule ${slug}`);
	}
	return found;
};

const predicates = (slug: string): readonly Predicate[] => {
	const { where } = schedule(slug).query;
	return where?.type === "and" ? where.predicates : [];
};

const expectMonitoringLink = (slug: string, predicate: Predicate | undefined) => {
	const alias = predicate?.type === "exists" ? predicate.query.from.alias : "";
	expect(alias).not.toBe("");
	expect(predicate).toEqual(
		libraryLinkExists(
			table("entity", schedule(slug).subject.entityAlias),
			alias,
			"media-monitoring",
		),
	);
};

describe("media signal schedules", () => {
	it("declares release, stale-progress and episode-availability schedules", () => {
		expect(
			signalSchedules.map(({ slug, signal, precision, delayDays, freshness, entitlement }) => [
				slug,
				signal,
				precision,
				delayDays ?? null,
				entitlement ?? null,
				freshness?.maxAgeHours ?? null,
			]),
		).toEqual([
			["show-episode-releases", "media.released", "date", null, null, 72],
			["podcast-episode-releases", "media.released", "date", null, null, 72],
			["anime-airing-releases", "media.released", "instant", null, null, 72],
			["flat-releases", "media.released", "date", null, null, 72],
			["in-progress-stale", "media.progress-stale", "instant", 7, "pro", null],
			["on-hold-stale", "media.progress-stale", "instant", 14, "pro", null],
			["show-episodes-available", "media.episodes-available", "date", null, null, null],
			["podcast-episodes-available", "media.episodes-available", "date", null, null, null],
		]);
		expect(schedule("show-episode-releases").properties).toEqual({
			entityName: "entityName",
			seasonNumber: "seasonNumber",
			episodeNumber: "episodeNumber",
		});
		expect(schedule("flat-releases").properties).toEqual({ entityName: "entityName" });
	});

	it("bounds every schedule's global reads to the schemas it queries", () => {
		const materialized = revisionDefinitions("media-plugin", {
			...mediaPlugin,
			scripts: [],
		}).signalSchedules;
		expect(materialized.map(({ slug }) => slug)).toEqual(signalSchedules.map(({ slug }) => slug));
		for (const { slug, readSchemaSlugs } of materialized) {
			expect(readSchemaSlugs, slug).not.toBeNull();
		}
	});

	it.each([
		["show-episode-releases", "media-monitoring"],
		["podcast-episode-releases", "media-monitoring"],
		["anime-airing-releases", "media-monitoring"],
		["flat-releases", "media-monitoring"],
		["in-progress-stale", "in-media-library"],
		["on-hold-stale", "in-media-library"],
		["show-episodes-available", "in-media-library"],
		["podcast-episodes-available", "in-media-library"],
	])("drives %s from the user's %s links", (slug, link) => {
		const { query, subject } = schedule(slug);
		const source = libraryLinkSource(table("entity", subject.entityAlias), query.from.alias, link);
		expect(query.from).toEqual(source.from);
		expect(query.joins?.slice(0, source.joins.length)).toEqual([...source.joins]);
		expect(predicates(slug)).toContainEqual(source.where);
	});

	it.each(["show-episodes-available", "podcast-episodes-available"])(
		"limits %s to caught-up series without monitoring",
		(slug) => {
			const negated = predicates(slug).find((predicate) => predicate.type === "not");
			expectMonitoringLink(slug, negated?.type === "not" ? negated.predicate : undefined);
			expect(JSON.stringify(predicates(slug))).toContain('"caught_up"');
		},
	);

	it("skips season-zero specials when announcing show episodes", () => {
		const nested = predicates("show-episode-releases").flatMap((predicate) =>
			predicate.type === "and" ? predicate.predicates : [predicate],
		);
		expect(nested).toContainEqual<unknown>(
			objectContaining({
				operator: "gt",
				type: "comparison",
				right: { value: 0, type: "literal" },
			}),
		);
	});

	it.each([
		["in-progress-stale", "in_progress"],
		["on-hold-stale", "on_hold"],
	])("keys %s nudges by their unchanged lifecycle state and activity", (slug, state) => {
		expect(JSON.stringify(predicates(slug))).toContain(`"${state}"`);
		expect(schedule(slug).properties).toEqual({
			days: "days",
			entityName: "entityName",
			lifecycleState: "lifecycleState",
		});
	});
});

const materialized = revisionDefinitions(mediaPluginId, {
	...mediaPlugin,
	scripts: [],
}).signalSchedules;

const evaluate = (slug: string, user: MediaUser) =>
	Effect.gen(function* () {
		const definition = materialized.find((candidate) => candidate.slug === slug);
		assert(definition);
		const recipe = Result.getOrThrow(signalScheduleRecipe({ schedule: definition }));
		const service = yield* RyotQLService;
		const response = yield* service.executeForUser(user, null, "kernel", {
			source: { kind: "inline", document: recipe.document },
			arguments: { end: utcDay(3).toISOString(), start: utcDay(-3).toISOString() },
		});
		const { signalScheduleDue, signalScheduleNext } = Result.getOrThrow(recipe.decode(response));
		return { next: signalScheduleNext, due: signalScheduleDue.items };
	});

const episodes = (
	parent: string,
	kind: "show" | "podcast",
	items: ReadonlyArray<{ readonly id: string; readonly days: number; readonly season?: number }>,
) =>
	Effect.gen(function* () {
		const seasons = [...new Set(items.map(({ season }) => season ?? 1))];
		yield* insertEntities([
			{ id: parent, slug: kind },
			...(kind === "show"
				? seasons.map((season) => ({
						slug: "show-season",
						id: `${parent}-s${season}`,
						properties: { seasonNumber: season },
					}))
				: []),
			...items.map(({ id, days }, index) => ({
				id,
				slug: `${kind}-episode`,
				publishDate: utcDay(days),
				properties: { episodeNumber: index + 1 },
			})),
		]);
		yield* insertRelationships(
			kind === "show"
				? [
						...seasons.map((season) => ({
							source: parent,
							slug: "show-to-show-season",
							target: `${parent}-s${season}`,
						})),
						...items.map(({ id, season }) => ({
							target: id,
							slug: "show-season-to-show-episode",
							source: `${parent}-s${season ?? 1}`,
						})),
					]
				: items.map(({ id }) => ({
						target: id,
						source: parent,
						slug: "podcast-to-podcast-episode",
					})),
		);
	});

const name = (entityName: string) => ({ entityName });

const seedSchedules = Effect.gen(function* () {
	yield* episodes("watched-show", "show", [
		{ days: -1, id: "watched-show-e1" },
		{ days: 5, id: "watched-show-e2" },
		{ days: 1, season: 0, id: "watched-show-special" },
	]);
	yield* episodes("quiet-show", "show", [{ days: 1, id: "quiet-show-e1" }]);
	yield* episodes("foreign-show", "show", [{ days: 1, id: "foreign-show-e1" }]);
	yield* episodes("watched-podcast", "podcast", [{ days: 2, id: "watched-podcast-e1" }]);
	yield* insertEntities([
		{
			slug: "anime",
			id: "watched-anime",
			publishDate: utcDay(-30),
			properties: {
				airingSchedule: [
					{ episode: 1, airingAt: utcDay(-30).toISOString() },
					{ episode: 2, airingAt: utcDay(1.5).toISOString() },
					{ episode: 3, airingAt: utcDay(8).toISOString() },
				],
			},
		},
		{ slug: "movie", id: "watched-movie", publishDate: utcDay(2) },
		{ slug: "movie", id: "foreign-movie", publishDate: utcDay(2) },
		{ slug: "movie", id: "stalled-movie" },
		{ slug: "book", id: "held-book" },
		{ slug: "movie", id: "foreign-stalled-movie" },
	]);
	const monitored = ["watched-show", "watched-podcast", "watched-anime", "watched-movie"];
	yield* linkToLibrary("owner", "in-media-library", [
		...monitored,
		"quiet-show",
		"stalled-movie",
		"held-book",
	]);
	yield* linkToLibrary("owner", "media-monitoring", monitored);
	yield* linkToLibrary("other", "in-media-library", [
		"foreign-show",
		"foreign-movie",
		"foreign-stalled-movie",
	]);
	yield* linkToLibrary("other", "media-monitoring", ["foreign-show", "foreign-movie"]);
	yield* storeLibrarySummary("owner", "quiet-show", {
		lifecycleState: "caught_up",
		nextAiringAt: utcDay(1).toISOString(),
	});
	yield* storeLibrarySummary("owner", "watched-show", {
		lifecycleState: "caught_up",
		nextAiringAt: utcDay(1).toISOString(),
	});
	yield* storeLibrarySummary("owner", "stalled-movie", {
		lifecycleState: "in_progress",
		lastActivityAt: utcDay(-1).toISOString(),
	});
	yield* storeLibrarySummary("owner", "held-book", {
		lifecycleState: "on_hold",
		lastActivityAt: utcDay(-2).toISOString(),
	});
	yield* storeLibrarySummary("other", "foreign-stalled-movie", {
		lifecycleState: "in_progress",
		lastActivityAt: utcDay(-1).toISOString(),
	});
});

layer(mediaDatabaseLayer("media_signal_schedules"))((test) => {
	test.effect("finds each schedule's due and next occurrences among the user's own titles", () =>
		Effect.gen(function* () {
			yield* seedSchedules;
			const results = yield* Effect.forEach(materialized, ({ slug }) =>
				Effect.map(
					Effect.all([evaluate(slug, "owner"), evaluate(slug, "other")]),
					([owner, other]) => [slug, { owner, other }] as const,
				),
			);
			expect(Object.fromEntries(results)).toEqual({
				"podcast-episodes-available": {
					owner: { due: [], next: null },
					other: { due: [], next: null },
				},
				"show-episodes-available": {
					other: { due: [], next: null },
					owner: {
						next: null,
						due: [
							{
								subjectId: "quiet-show",
								properties: name("quiet-show"),
								occurrence: `quiet-show:${utcDay(1).toISOString()}`,
							},
						],
					},
				},
				"podcast-episode-releases": {
					other: { due: [], next: null },
					owner: {
						next: null,
						due: [
							{
								subjectId: "watched-podcast",
								occurrence: "watched-podcast-e1",
								properties: { ...name("watched-podcast"), episodeNumber: 1 },
							},
						],
					},
				},
				"anime-airing-releases": {
					other: { due: [], next: null },
					owner: {
						next: utcDay(8).toISOString(),
						due: [
							{
								subjectId: "watched-anime",
								occurrence: "watched-anime:2",
								properties: { ...name("watched-anime"), episodeNumber: 2 },
							},
						],
					},
				},
				"on-hold-stale": {
					other: { due: [], next: null },
					owner: {
						next: null,
						due: [
							{
								subjectId: "held-book",
								occurrence: `held-book:on_hold:${utcDay(-2).toISOString()}`,
								properties: { ...name("held-book"), days: 14, lifecycleState: "on_hold" },
							},
						],
					},
				},
				"flat-releases": {
					owner: {
						next: null,
						due: [
							{
								subjectId: "watched-movie",
								occurrence: "watched-movie",
								properties: name("watched-movie"),
							},
						],
					},
					other: {
						next: null,
						due: [
							{
								subjectId: "foreign-movie",
								occurrence: "foreign-movie",
								properties: name("foreign-movie"),
							},
						],
					},
				},
				"show-episode-releases": {
					other: {
						next: null,
						due: [
							{
								subjectId: "foreign-show",
								occurrence: "foreign-show-e1",
								properties: { ...name("foreign-show"), seasonNumber: 1, episodeNumber: 1 },
							},
						],
					},
					owner: {
						next: utcDay(5).toISOString(),
						due: [
							{
								subjectId: "watched-show",
								occurrence: "watched-show-e1",
								properties: { ...name("watched-show"), seasonNumber: 1, episodeNumber: 1 },
							},
						],
					},
				},
				"in-progress-stale": {
					owner: {
						next: null,
						due: [
							{
								subjectId: "stalled-movie",
								occurrence: `stalled-movie:in_progress:${utcDay(-1).toISOString()}`,
								properties: { ...name("stalled-movie"), days: 7, lifecycleState: "in_progress" },
							},
						],
					},
					other: {
						next: null,
						due: [
							{
								subjectId: "foreign-stalled-movie",
								occurrence: `foreign-stalled-movie:in_progress:${utcDay(-1).toISOString()}`,
								properties: {
									...name("foreign-stalled-movie"),
									days: 7,
									lifecycleState: "in_progress",
								},
							},
						],
					},
				},
			});
		}),
	);
});
