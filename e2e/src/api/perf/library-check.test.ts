import type { ContractPayload } from "@ryot-app/contract/client";
import { unknownToMessage } from "@ryot-app/contract/errors";
import { EntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import {
	fitnessAnalyticsTotalsRecipe,
	fitnessAnalyticsTrendRecipe,
	fitnessAnalyticsWorkoutsRecipe,
	fitnessWorkoutStartsByHourRecipe,
	historicalFitnessRankingRecipe,
} from "@ryot-app/fitness-plugin/analytics-recipes";
import { mediaActivityRecipe } from "@ryot-app/media-plugin/shared/activity-recipes";
import {
	mediaAnalyticsHoursRecipe,
	mediaAnalyticsRankingRecipe,
	mediaAnalyticsRecordsRecipe,
	mediaAnalyticsSummaryRecipe,
	mediaAnalyticsTrendRecipe,
} from "@ryot-app/media-plugin/shared/analytics-recipes";
import {
	latestCompletionSuggestionsRecipe,
	trendingLatestMediaRecipe,
} from "@ryot-app/media-plugin/shared/discovery-recipes";
import {
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
} from "@ryot-app/media-plugin/shared/lifecycle-expressions";
import {
	episodicByLifecycleStateRecipe,
	flatByLifecycleStateRecipe,
	libraryMediaCountRecipe,
} from "@ryot-app/media-plugin/shared/lifecycle-list-recipes";
import { upcomingRecipe } from "@ryot-app/media-plugin/shared/upcoming-recipes";
import type { Recipe } from "@ryot-app/ryotql";
import {
	calendarOccurrencesPageRecipe,
	calendarSourcesRecipe,
	calendarWindowBounds,
} from "@ryot-app/ryotql-recipes/calendar";
import { reportingArguments } from "@ryot-app/ryotql-recipes/reporting-parameters";
import { savedViewRecordsRecipe } from "@ryot-app/ryotql-recipes/saved-view-records";
import { decodeSavedViewIds } from "@ryot-app/ryotql-recipes/saved-views";
import { Clock, DateTime, Duration, Effect, FileSystem, Result, Schedule, Schema } from "effect";
import type { HttpClient } from "effect/http";

import type { Client } from "~/fixtures/kernel/auth";
import { createImpersonationSession } from "~/fixtures/kernel/auth-impersonation";
import { listEventsForEntity } from "~/fixtures/kernel/events";
import { executeRyotQL, executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { workoutReference } from "~/fixtures/plugins/fitness";
import {
	createBuiltinMediaLifecycleFixture,
	findMediaEntitySchema,
} from "~/fixtures/plugins/media";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const LIBRARY_CHECK_WRITES = process.env.LIBRARY_CHECK_WRITES === "1";
const RUN_LIBRARY_CHECK = process.env.RUN_LIBRARY_CHECK === "1";
const OUT = String(process.env.LIBRARY_CHECK_OUT);
const DATABASE_URL = String(process.env.E2E_DATABASE_URL);
const ROUNDS = (process.env.LIBRARY_CHECK_ROUNDS ?? "server").split(",");
const PAGES = (process.env.LIBRARY_CHECK_PAGES ?? "server").split(",").filter(Boolean);
const ONLY = process.env.LIBRARY_CHECK_ONLY?.split(",");
const TODAY = process.env.LIBRARY_CHECK_TODAY;
const STATEMENT_LIMIT_MS = 29_000;
const DAY_MS = 86_400_000;

type Reads = Readonly<Record<string, Read>>;
type Read = (client: Client) => Effect.Effect<void, unknown, HttpClient.HttpClient>;

const read =
	<Success, const Parameters extends AppSchema>(
		recipe: Recipe<Success, Parameters>,
		arguments_: NoInfer<Recipe.Arguments<Recipe<Success, Parameters>>>,
		options: Omit<ContractPayload<"ryotql", "execute">, "source" | "arguments"> = {},
	): Read =>
	(client) =>
		executeRyotQLRecipe(client, recipe, arguments_, options).pipe(Effect.asVoid);

const log = (row: unknown) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const line = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(row);
		yield* fs.writeFileString(OUT, `${line}\n`, { flag: "a" });
	}).pipe(Effect.orDie);

const admin = <S extends Schema.Top>(schema: S, text: string) =>
	Effect.acquireUseRelease(
		Effect.sync(() => new Bun.SQL(DATABASE_URL, { max: 1 })),
		(connection) =>
			Effect.tryPromise({ catch: unknownToMessage, try: () => connection.unsafe(text) }),
		(connection) => Effect.promise(() => connection.close()),
	).pipe(
		Effect.retry({ times: 60, schedule: Schedule.spaced("2 seconds") }),
		Effect.orDie,
		Effect.flatMap((rows) => Schema.decodeUnknownEffect(schema)(rows).pipe(Effect.orDie)),
	);

const AnyRows = Schema.Array(Schema.Unknown);
const UserRows = Schema.Array(Schema.Struct({ size: Schema.Finite, user_id: Schema.String }));
const JitRows = Schema.Array(
	Schema.Struct({
		calls: Schema.Finite,
		jit_ms: Schema.Finite,
		exec_ms: Schema.Finite,
		functions: Schema.Finite,
	}),
);

const mark = (label: string) => admin(AnyRows, `select 'LIBRARYCHECK ${label}'`);
const setJit = (mode: string) =>
	mode === "server"
		? Effect.void
		: Effect.gen(function* () {
				yield* admin(AnyRows, `alter system set jit = ${mode}`);
				yield* admin(AnyRows, "select pg_reload_conf()");
				yield* Effect.sleep(Duration.millis(500));
			});

const largestUser = (query: string) => admin(UserRows, query).pipe(Effect.map((rows) => rows[0]));

const dayOf = (at: number) => DateTime.formatIso(DateTime.makeUnsafe(at)).slice(0, 10);
const midnightAfter = (now: number, days: number) =>
	DateTime.formatIso(DateTime.makeUnsafe(Math.floor(now / DAY_MS + days) * DAY_MS));

const mediaReads = Effect.fn("mediaReads")(function* (client: Client) {
	const { pluginId } = yield* findMediaEntitySchema(client, "show");
	const reference = { pluginId, kind: "local" as const };
	const now = TODAY ? Date.parse(TODAY) : yield* Clock.currentTimeMillis;
	const today = dayOf(now);
	const midnight = (days: number) => midnightAfter(now, days);

	const home: Reads = {
		count: read(libraryMediaCountRecipe(reference), {}),
		suggestions: read(
			latestCompletionSuggestionsRecipe({ reference }),
			{},
			{ pages: { source: { limit: 20 } } },
		),
		upcoming: read(
			upcomingRecipe({ reference }),
			{ daysAhead: 7, onePerTitle: true },
			{ pages: { anime: { limit: 20 } } },
		),
		"backlog-flat": read(
			flatByLifecycleStateRecipe({ reference }),
			{ states: ["backlog"] },
			{ pages: { items: { limit: 20 } } },
		),
		"continue-flat": read(
			flatByLifecycleStateRecipe({ reference }),
			{ states: ["in_progress"] },
			{ pages: { items: { limit: 20 } } },
		),
		trending: read(
			trendingLatestMediaRecipe({ reference }),
			{ entitySchemaSlugs: ["movie", "show"] },
			{ pages: { trending: { limit: 20 } } },
		),
		activity: read(
			mediaActivityRecipe(reference),
			reportingArguments({
				grouping: "auto",
				comparison: "none",
				range: { days: 365, kind: "rolling" },
			}),
		),
		"backlog-show": read(
			episodicByLifecycleStateRecipe({ reference, config: showEpisodicKindConfig }),
			{ states: ["backlog"] },
			{ pages: { items: { limit: 20 } } },
		),
		"continue-show": read(
			episodicByLifecycleStateRecipe({ reference, config: showEpisodicKindConfig }),
			{ states: ["in_progress"] },
			{ pages: { items: { limit: 20 } } },
		),
		"backlog-podcast": read(
			episodicByLifecycleStateRecipe({ reference, config: podcastEpisodicKindConfig }),
			{ states: ["backlog"] },
			{ pages: { items: { limit: 20 } } },
		),
		"continue-podcast": read(
			episodicByLifecycleStateRecipe({ reference, config: podcastEpisodicKindConfig }),
			{ states: ["in_progress"] },
			{ pages: { items: { limit: 20 } } },
		),
	};
	const analytics: Reads = {
		"analytics-trend-all": read(
			mediaAnalyticsTrendRecipe({ reference }),
			reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
		),
		"analytics-hours-all": read(
			mediaAnalyticsHoursRecipe({ reference }),
			reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
		),
		"analytics-summary-all": read(
			mediaAnalyticsSummaryRecipe({ reference }),
			reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
		),
		"analytics-ranking-all": read(
			mediaAnalyticsRankingRecipe({ reference }),
			reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
		),
		"analytics-records-all": read(
			mediaAnalyticsRecordsRecipe({ reference }),
			reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
		),
		"analytics-summary-year": read(mediaAnalyticsSummaryRecipe({ reference }), {
			...reportingArguments({
				grouping: "auto",
				comparison: "previous-period",
				range: { days: 365, kind: "rolling" },
			}),
		}),
	};
	const month = today.slice(0, 7);
	const window = { month, localEnd: midnight(32), localStart: `${month}-01T00:00:00.000Z` };
	const sources = yield* executeRyotQLRecipe(client, calendarSourcesRecipe, {});
	const calendar: Reads = Object.fromEntries(
		sources.map((source) => [
			`calendar-${source.slug}`,
			read(Result.getOrThrow(calendarOccurrencesPageRecipe({ source })), {
				windowEnd: calendarWindowBounds(source.precision, window).end,
				windowStart: calendarWindowBounds(source.precision, window).start,
			}),
		]),
	);
	const views = yield* executeRyotQLRecipe(
		client,
		savedViewRecordsRecipe,
		{ includeHidden: true },
		{ pages: { savedViews: { limit: 100 } } },
	);
	const browsing: Record<string, Read> = {};
	for (const view of views.items) {
		const decoded = Schema.decodeUnknownResult(EntityBrowserSavedViewSettings)(view.settings);
		if (!view.name.startsWith("All ") || view.dataSources === null || Result.isFailure(decoded)) {
			continue;
		}
		const settings = decoded.success;
		const name = `view-${view.name.toLowerCase().replaceAll(" ", "-")}`;
		const source = {
			reference: view.reference,
			kind: "savedView" as const,
			query: settings.sourceName,
		};
		browsing[name] = (pageClient) => executeRyotQL(pageClient, { source }).pipe(Effect.asVoid);
		browsing[`${name}-search`] = (pageClient) =>
			executeRyotQL(pageClient, {
				source,
				arguments: { [settings.controls?.search ?? "search"]: "the" },
			}).pipe(Effect.asVoid);
		browsing[`${name}-three-pages`] = (pageClient) =>
			Effect.gen(function* () {
				let after: string | undefined;
				const ids = new Set<string>();
				for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
					const response = yield* executeRyotQL(pageClient, {
						pages: { ids: { after } },
						source: { ...source, query: "ids" },
					});
					const page = yield* Effect.fromResult(decodeSavedViewIds(response));
					for (const id of page.items) {
						expect(ids.has(id)).toBe(false);
						ids.add(id);
					}
					if (!page.pageInfo.hasMore) {
						break;
					}
					after = requirePresent(page.pageInfo.nextCursor, "Expected next-page cursor");
				}
			});
		browsing[`${name}-count`] = (pageClient) =>
			executeRyotQL(pageClient, { source: { ...source, query: "count" } }).pipe(Effect.asVoid);
	}
	return { home, reads: { ...home, ...analytics, ...calendar, ...browsing } };
});

const fitnessReads = Effect.fn("fitnessReads")(function* (client: Client) {
	const reference = yield* workoutReference(client);

	const reads: Reads = {
		"fitness-hours": read(
			fitnessWorkoutStartsByHourRecipe({ reference }),
			reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
		),
		"fitness-totals-all": read(
			fitnessAnalyticsTotalsRecipe({ reference }),
			reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
		),
		"fitness-workouts": read(
			fitnessAnalyticsWorkoutsRecipe({ reference }),
			reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
		),
		"fitness-trend": read(fitnessAnalyticsTrendRecipe({ reference }), {
			...reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
			metric: "workouts",
		}),
		"fitness-rank-targets": read(historicalFitnessRankingRecipe({ reference }), {
			...reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
			kind: "targets",
		}),
		"fitness-rank-exercises": read(historicalFitnessRankingRecipe({ reference }), {
			...reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
			kind: "exercises",
		}),
	};
	return reads;
});

const session = (userId: string) =>
	createImpersonationSession(userId).pipe(
		Effect.map(({ client }) => client),
		Effect.retry({ times: 20, schedule: Schedule.spaced("3 seconds") }),
	);

const attempt = (run: Read, client: Client) =>
	run(client).pipe(
		Effect.as("ok"),
		Effect.timeoutOrElse({
			duration: Duration.minutes(3),
			orElse: () => Effect.succeed("timeout"),
		}),
		Effect.catchCause((cause) => Effect.succeed(`error ${String(cause).slice(0, 120)}`)),
	);

describe.skipIf(!RUN_LIBRARY_CHECK)("library check", () => {
	it.live("times real reads on a restored library", () =>
		Effect.gen(function* () {
			yield* admin(AnyRows, "create extension if not exists pg_stat_statements");
			const library = requirePresent(
				yield* largestUser(`
				select e.user_id, count(*)::int as size
				from relationship r
				join entity e on e.id = r.target_entity_id
				join "user" u on u.id = e.user_id
				where e.entity_schema_slug = 'media-library'
					and r.relationship_schema_slug = 'in-media-library' and u.disabled_at is null
				group by 1 order by 2 desc limit 1`),
				"the restored database has no library",
			);
			const lifter = yield* largestUser(`
				select e.user_id, count(*)::int as size
				from entity e
				join "user" u on u.id = e.user_id
				where e.entity_schema_slug = 'workout' and u.disabled_at is null
				group by 1 order by 2 desc limit 1`);
			yield* log({ members: library.size, workouts: lifter?.size ?? 0 });

			const { home, reads } = yield* mediaReads(yield* session(library.user_id));
			const groups: readonly { readonly reads: Reads; readonly userId: string }[] = [
				{ reads, userId: library.user_id },
				...(lifter === undefined
					? []
					: [
							{
								userId: lifter.user_id,
								reads: yield* fitnessReads(yield* session(lifter.user_id)),
							},
						]),
			];

			const limited = new Set<string>();
			for (const [round, mode] of ROUNDS.entries()) {
				yield* setJit(mode);
				for (const group of groups) {
					let client = yield* session(group.userId);
					for (const [label, run] of Object.entries(group.reads)) {
						if (limited.has(`${mode}:${label}`) || ONLY?.includes(label) === false) {
							continue;
						}
						yield* admin(AnyRows, "select pg_stat_statements_reset()");
						yield* mark(`${label} start`);
						let start = performance.now();
						let outcome = yield* attempt(run, client);
						if (outcome.includes("AuthUnauthorized")) {
							client = yield* session(group.userId);
							start = performance.now();
							outcome = yield* attempt(run, client);
						}
						const ms = Math.round(performance.now() - start);
						yield* mark(`${label} end`);
						if (outcome !== "ok" && ms >= STATEMENT_LIMIT_MS) {
							limited.add(`${mode}:${label}`);
						}
						const [jit] = yield* admin(
							JitRows,
							`select coalesce(sum(calls), 0)::int as calls,
								round(coalesce(sum(jit_generation_time + jit_inlining_time + jit_optimization_time + jit_emission_time), 0))::int as jit_ms,
								round(coalesce(sum(total_exec_time), 0))::int as exec_ms,
								coalesce(sum(jit_functions), 0)::int as functions
							from pg_stat_statements
							where query not like '%pg_stat_statements%' and query not like '%pg_reload%'
								and query not like '%LIBRARYCHECK%'`,
						);
						yield* log({ ms, mode, label, round, outcome, ...jit });
					}
				}
			}

			for (const [index, mode] of PAGES.entries()) {
				yield* setJit(mode);
				const client = yield* session(library.user_id);
				const startedAt = DateTime.formatIso(yield* DateTime.now);
				const start = performance.now();
				const outcomes = yield* Effect.forEach(
					Object.entries(home),
					([label, run]) =>
						attempt(run, client).pipe(
							Effect.map((outcome) => ({
								label,
								outcome,
								ms: Math.round(performance.now() - start),
							})),
						),
					{ concurrency: "unbounded" },
				);
				yield* log({
					mode,
					outcomes,
					startedAt,
					page: index,
					ms: Math.round(performance.now() - start),
				});
				yield* Effect.sleep(Duration.seconds(15));
			}
			if (LIBRARY_CHECK_WRITES) {
				const client = yield* session(library.user_id);
				for (let round = 0; round < 5; round++) {
					const movie = yield* createBuiltinMediaLifecycleFixture(client, {
						entitySchemaSlug: "movie",
					});
					const timed = <A, E, R>(label: string, action: Effect.Effect<A, E, R>) =>
						Effect.gen(function* () {
							const startedAt = yield* Clock.currentTimeMillis;
							const result = yield* action;
							yield* log({ round, write: label, ms: (yield* Clock.currentTimeMillis) - startedAt });
							return result;
						});
					yield* timed(
						"progress-complete",
						client.call((c) =>
							c.events.create({
								payload: [
									{
										entityId: movie.entityId,
										properties: { progressPercent: 100 },
										occurredAt: "2026-01-01T12:00:00.000Z",
										eventSchemaSlug: movie.progressEventSchemaSlug,
									},
								],
							}),
						),
					);
					let history = yield* listEventsForEntity(client, movie.entityId, undefined, 100);
					expect(history.filter((event) => event.eventSchemaSlug === "complete")).toHaveLength(1);
					const progress = requirePresent(
						history.find((event) => event.eventSchemaSlug === "progress"),
						"Expected progress",
					);
					yield* timed(
						"edit-history",
						client.call((c) =>
							c.events.update({
								params: { eventId: progress.id },
								payload: { occurredAt: "2026-01-02T12:00:00.000Z" },
							}),
						),
					);
					history = yield* listEventsForEntity(client, movie.entityId, undefined, 100);
					const completions = history.filter((event) => event.eventSchemaSlug === "complete");
					expect(completions).toHaveLength(1);
					const completion = requirePresent(completions[0], "Expected completion");
					expect(completion.occurredAt).toBe("2026-01-02T12:00:00.000Z");
					yield* timed(
						"delete-completion",
						client.call((c) => c.events.delete({ params: { eventId: completion.id } })),
					);
					yield* timed(
						"edit-suppressed-history",
						client.call((c) =>
							c.events.update({
								params: { eventId: progress.id },
								payload: { properties: { remove: [], set: { progressPercent: 100 } } },
							}),
						),
					);
					expect(
						(yield* listEventsForEntity(client, movie.entityId, undefined, 100)).filter(
							(event) => event.eventSchemaSlug === "complete",
						),
					).toHaveLength(0);
				}
			}
		}),
	);
});
