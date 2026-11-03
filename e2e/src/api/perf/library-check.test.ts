import { resolveReportingSelection } from "@ryot-app/contract/modules/analytics/reporting";
import { EntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
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
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { entitySchemaBrowseRecipe } from "@ryot-app/ryotql-recipes/browse";
import {
	calendarOccurrencesPageRecipe,
	calendarSourcesRecipe,
} from "@ryot-app/ryotql-recipes/calendar";
import { savedViewRecordsRecipe } from "@ryot-app/ryotql-recipes/saved-view-records";
import {
	entityBrowserControls,
	entityBrowserCountRecipe,
	entityBrowserRecipe,
} from "@ryot-app/ryotql-recipes/saved-views";
import { Clock, DateTime, Duration, Effect, FileSystem, Result, Schedule, Schema } from "effect";
import type { HttpClient } from "effect/http";

import type { Client } from "~/fixtures/kernel/auth";
import { createImpersonationSession } from "~/fixtures/kernel/auth-impersonation";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { workoutReference } from "~/fixtures/plugins/fitness";
import { findMediaEntitySchema } from "~/fixtures/plugins/media";
import { requirePresent } from "~/support/assertions";
import { describe, it } from "~/support/effect-test";

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
	<Success>(recipe: () => PreparedRecipe<Success>): Read =>
	(client) =>
		Effect.suspend(() => executeRyotQLRecipe(client, recipe())).pipe(Effect.asVoid);

const log = (row: unknown) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const line = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(row);
		yield* fs.writeFileString(OUT, `${line}\n`, { flag: "a" });
	}).pipe(Effect.orDie);

const admin = <S extends Schema.Top>(schema: S, text: string) =>
	Effect.acquireUseRelease(
		Effect.sync(() => new Bun.SQL(DATABASE_URL, { max: 1 })),
		(connection) => Effect.tryPromise(() => connection.unsafe(text)),
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
	const timeZone = yield* Schema.decodeEffect(TimeZone)("UTC").pipe(Effect.orDie);
	const reporting = resolveReportingSelection(
		{ grouping: "auto", comparison: "none", range: { kind: "all-time" } },
		{ now, timeZone },
	);
	const year = resolveReportingSelection(
		{ grouping: "auto", comparison: "previous-period", range: { days: 365, kind: "rolling" } },
		{ now, timeZone },
	);
	const home: Reads = {
		count: read(() => libraryMediaCountRecipe(reference)),
		suggestions: read(() => latestCompletionSuggestionsRecipe({ reference, limit: 20 })),
		"backlog-flat": read(() =>
			flatByLifecycleStateRecipe({ reference, limit: 20, states: ["backlog"] }),
		),
		"continue-flat": read(() =>
			flatByLifecycleStateRecipe({ reference, limit: 20, states: ["in_progress"] }),
		),
		activity: read(() =>
			mediaActivityRecipe({ timeZone, reference, until: midnight(1), from: midnight(-364) }),
		),
		trending: read(() =>
			trendingLatestMediaRecipe({ reference, limit: 20, entitySchemaSlugs: ["movie", "show"] }),
		),
		"backlog-show": read(() =>
			episodicByLifecycleStateRecipe({
				reference,
				limit: 20,
				states: ["backlog"],
				config: showEpisodicKindConfig,
			}),
		),
		"continue-show": read(() =>
			episodicByLifecycleStateRecipe({
				reference,
				limit: 20,
				states: ["in_progress"],
				config: showEpisodicKindConfig,
			}),
		),
		"backlog-podcast": read(() =>
			episodicByLifecycleStateRecipe({
				reference,
				limit: 20,
				states: ["backlog"],
				config: podcastEpisodicKindConfig,
			}),
		),
		"continue-podcast": read(() =>
			episodicByLifecycleStateRecipe({
				reference,
				limit: 20,
				states: ["in_progress"],
				config: podcastEpisodicKindConfig,
			}),
		),
		upcoming: read(() =>
			upcomingRecipe({
				reference,
				limit: 20,
				fromDate: today,
				onePerTitle: true,
				fromInstant: midnight(0),
				untilInstant: midnight(8),
				untilDate: midnight(7).slice(0, 10),
			}),
		),
	};
	const analytics: Reads = {
		"analytics-trend-all": read(() => mediaAnalyticsTrendRecipe({ reference, reporting })),
		"analytics-hours-all": read(() => mediaAnalyticsHoursRecipe({ reference, reporting })),
		"analytics-summary-all": read(() => mediaAnalyticsSummaryRecipe({ reference, reporting })),
		"analytics-ranking-all": read(() => mediaAnalyticsRankingRecipe({ reference, reporting })),
		"analytics-records-all": read(() => mediaAnalyticsRecordsRecipe({ reference, reporting })),
		"analytics-summary-year": read(() =>
			mediaAnalyticsSummaryRecipe({ reference, reporting: year }),
		),
	};
	const month = today.slice(0, 7);
	const window = { month, localEnd: midnight(32), localStart: `${month}-01T00:00:00.000Z` };
	const sources = yield* executeRyotQLRecipe(client, calendarSourcesRecipe());
	const calendar: Reads = Object.fromEntries(
		sources.map((source) => [
			`calendar-${source.slug}`,
			read(() => Result.getOrThrow(calendarOccurrencesPageRecipe({ source, window }))),
		]),
	);
	const views = yield* executeRyotQLRecipe(
		client,
		savedViewRecordsRecipe({ limit: 100, includeHidden: true }),
	);
	const browsing: Record<string, Read> = {};
	for (const view of views.items) {
		const decoded = Schema.decodeUnknownResult(EntityBrowserSavedViewSettings)(view.settings);
		if (!view.name.startsWith("All ") || view.dataSources === null || Result.isFailure(decoded)) {
			continue;
		}
		const settings = decoded.success;
		const queryDocument = view.dataSources;
		const [first, ...rest] = settings.subject.schemas.map(({ slug, owner }) => ({
			slug,
			pluginId: owner.kind === "plugin" ? owner.pluginId : null,
		}));
		if (first === undefined) {
			continue;
		}
		const browse = yield* executeRyotQLRecipe(
			client,
			entitySchemaBrowseRecipe({ schemas: [first, ...rest] }),
		);
		const name = `view-${view.name.toLowerCase().replaceAll(" ", "-")}`;
		browsing[name] = read(() =>
			Result.getOrThrow(entityBrowserRecipe({ browse, settings, queryDocument })),
		);
		browsing[`${name}-count`] = read(() =>
			Result.getOrThrow(entityBrowserCountRecipe(queryDocument, settings, { browse })),
		);
		for (const { key, defaultDirection } of entityBrowserControls(browse).sortChoices) {
			const sortChoice = `${key}-${defaultDirection}`;
			browsing[`${name}-sort-${key}`] = read(() =>
				Result.getOrThrow(entityBrowserRecipe({ browse, settings, sortChoice, queryDocument })),
			);
		}
	}
	return { home, reads: { ...home, ...analytics, ...calendar, ...browsing } };
});

const fitnessReads = Effect.fn("fitnessReads")(function* (client: Client) {
	const reference = yield* workoutReference(client);
	const timeZone = yield* Schema.decodeEffect(TimeZone)("UTC").pipe(Effect.orDie);
	const reporting = resolveReportingSelection(
		{ grouping: "auto", comparison: "none", range: { kind: "all-time" } },
		{ timeZone, now: yield* Clock.currentTimeMillis },
	);
	const reads: Reads = {
		"fitness-hours": read(() => fitnessWorkoutStartsByHourRecipe({ reference, reporting })),
		"fitness-totals-all": read(() => fitnessAnalyticsTotalsRecipe({ reference, reporting })),
		"fitness-workouts": read(() => fitnessAnalyticsWorkoutsRecipe({ reference, reporting })),
		"fitness-trend": read(() =>
			fitnessAnalyticsTrendRecipe({ reference, reporting, metric: "workouts" }),
		),
		"fitness-rank-targets": read(() =>
			historicalFitnessRankingRecipe({ reference, reporting, kind: "targets" }),
		),
		"fitness-rank-exercises": read(() =>
			historicalFitnessRankingRecipe({ reference, reporting, kind: "exercises" }),
		),
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
				where r.relationship_schema_slug = 'in-media-library' and u.disabled_at is null
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
		}),
	);
});
