import { EntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import {
	fitnessAnalyticsTotalsRecipe,
	fitnessAnalyticsTrendRecipe,
	fitnessAnalyticsWorkoutsRecipe,
	fitnessWorkoutStartsByHourRecipe,
	historicalFitnessRankingRecipe,
} from "@ryot-app/fitness-plugin/analytics-recipes";
import { LocaleTag } from "@ryot-app/i18n/locale";
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
import { movieRecipes } from "@ryot-app/media-plugin/shared/movie-recipes";
import { showRecipes } from "@ryot-app/media-plugin/shared/show-recipes";
import { upcomingRecipe } from "@ryot-app/media-plugin/shared/upcoming-recipes";
import {
	calendarOccurrencesPageRecipe,
	calendarSourcesRecipe,
	calendarWindowBounds,
} from "@ryot-app/ryotql-recipes/calendar";
import { pluginClientCatalogRecipe } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { reportingArguments } from "@ryot-app/ryotql-recipes/reporting-parameters";
import { savedViewRecordsRecipe } from "@ryot-app/ryotql-recipes/saved-view-records";
import { decodeSavedViewIds } from "@ryot-app/ryotql-recipes/saved-views";
import { Clock, DateTime, Duration, Effect, Result, Schema } from "effect";
import type { HttpClient } from "effect/http";

import type { Client } from "~/fixtures/kernel/auth";
import { listEventsForEntity } from "~/fixtures/kernel/events";
import { executeRyotQL, executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { fitnessRecipes, workoutReference } from "~/fixtures/plugins/fitness";
import {
	createBuiltinMediaLifecycleFixture,
	findMediaEntitySchema,
	mediaRecipes,
} from "~/fixtures/plugins/media";
import { requirePresent } from "~/support/assertions";
import type { E2eServices } from "~/support/e2e-runtime";
import { describe, expect, it } from "~/support/effect-test";
import {
	appendReport,
	countingResponseBytes,
	failureTag,
	impersonate,
	percentile,
	perfDatabase,
	statementCalls,
} from "~/support/perf";

const LIBRARY_CHECK_WRITES = process.env.LIBRARY_CHECK_WRITES === "1";
const RUN_LIBRARY_CHECK = process.env.RUN_LIBRARY_CHECK === "1";
const OUT = String(process.env.LIBRARY_CHECK_OUT);
const WARMUP = Number(process.env.LIBRARY_CHECK_WARMUP ?? "3");
const SAMPLES = Number(process.env.LIBRARY_CHECK_SAMPLES ?? "10");
const PAGE_LOADS = Number(process.env.LIBRARY_CHECK_PAGE_LOADS ?? "1");
const ONLY = process.env.LIBRARY_CHECK_ONLY?.split(",");
const TODAY = process.env.LIBRARY_CHECK_TODAY;
const DAY_MS = 86_400_000;

type Reads = Readonly<Record<string, Read>>;
type Read = (client: Client) => Effect.Effect<void, unknown, HttpClient.HttpClient>;

const read =
	(execute: (client: Client) => Effect.Effect<unknown, unknown, HttpClient.HttpClient>): Read =>
	(client) =>
		execute(client).pipe(Effect.asVoid);

const UserRows = Schema.Array(Schema.Struct({ size: Schema.Finite, user_id: Schema.String }));
const EntityRows = Schema.Array(Schema.Struct({ id: Schema.String }));

type PerfDatabase = Effect.Success<typeof perfDatabase>;

const dayOf = (at: number) => DateTime.formatIso(DateTime.makeUnsafe(at)).slice(0, 10);
const midnightAfter = (now: number, days: number) =>
	DateTime.formatIso(DateTime.makeUnsafe(Math.floor(now / DAY_MS + days) * DAY_MS));

const detailTarget = (db: PerfDatabase, userId: string, schemaSlug: string) =>
	db
		.query(
			EntityRows,
			`select media.id from relationship membership
			join entity library on library.id = membership.target_entity_id
			join entity media on media.id = membership.source_entity_id
			where library.user_id = $1 and library.entity_schema_slug = 'media-library'
				and membership.relationship_schema_slug = 'in-media-library' and media.entity_schema_slug = $2
			order by (select count(*) from relationship credit where credit.target_entity_id = media.id) desc, media.id
			limit 1`,
			[userId, schemaSlug],
		)
		.pipe(Effect.map((rows) => rows[0]?.id));

const detailReads = (
	label: string,
	entityId: string | undefined,
	reads: (entityId: string) => Readonly<Record<string, Read>>,
): Reads =>
	entityId === undefined
		? {}
		: Object.fromEntries(
				Object.entries(reads(entityId)).map(([part, run]) => [`detail-${label}-${part}`, run]),
			);

const mediaReads = Effect.fn("mediaReads")(function* (
	client: Client,
	db: PerfDatabase,
	userId: string,
) {
	const { pluginId } = yield* findMediaEntitySchema(client, "show");
	const reference = { pluginId, kind: "local" as const };
	const now = TODAY ? Date.parse(TODAY) : yield* Clock.currentTimeMillis;
	const today = dayOf(now);
	const midnight = (days: number) => midnightAfter(now, days);

	const home: Reads = {
		count: read((pageClient) =>
			mediaRecipes.execute(pageClient, libraryMediaCountRecipe(reference), {}),
		),
		suggestions: read((pageClient) =>
			mediaRecipes.execute(
				pageClient,
				latestCompletionSuggestionsRecipe({ reference }),
				{},
				{ pages: { items: { limit: 20 } } },
			),
		),
		upcoming: read((pageClient) =>
			mediaRecipes.execute(
				pageClient,
				upcomingRecipe({ reference }),
				{ daysAhead: 7, onePerTitle: true },
				{ pages: { anime: { limit: 20 } } },
			),
		),
		"backlog-flat": read((pageClient) =>
			mediaRecipes.execute(
				pageClient,
				flatByLifecycleStateRecipe({ reference }),
				{ states: ["backlog"] },
				{ pages: { items: { limit: 20 } } },
			),
		),
		"continue-flat": read((pageClient) =>
			mediaRecipes.execute(
				pageClient,
				flatByLifecycleStateRecipe({ reference }),
				{ states: ["in_progress"] },
				{ pages: { items: { limit: 20 } } },
			),
		),
		trending: read((pageClient) =>
			mediaRecipes.execute(
				pageClient,
				trendingLatestMediaRecipe({ reference }),
				{ entitySchemaSlugs: ["movie", "show"] },
				{ pages: { trending: { limit: 20 } } },
			),
		),
		"backlog-show": read((pageClient) =>
			mediaRecipes.execute(
				pageClient,
				episodicByLifecycleStateRecipe({ reference, config: showEpisodicKindConfig }),
				{ states: ["backlog"] },
				{ pages: { items: { limit: 20 } } },
			),
		),
		activity: read((pageClient) =>
			mediaRecipes.execute(
				pageClient,
				mediaActivityRecipe(reference),
				reportingArguments({
					grouping: "auto",
					comparison: "none",
					range: { days: 365, kind: "rolling" },
				}),
			),
		),
		"continue-show": read((pageClient) =>
			mediaRecipes.execute(
				pageClient,
				episodicByLifecycleStateRecipe({ reference, config: showEpisodicKindConfig }),
				{ states: ["in_progress"] },
				{ pages: { items: { limit: 20 } } },
			),
		),
		"backlog-podcast": read((pageClient) =>
			mediaRecipes.execute(
				pageClient,
				episodicByLifecycleStateRecipe({ reference, config: podcastEpisodicKindConfig }),
				{ states: ["backlog"] },
				{ pages: { items: { limit: 20 } } },
			),
		),
		"continue-podcast": read((pageClient) =>
			mediaRecipes.execute(
				pageClient,
				episodicByLifecycleStateRecipe({ reference, config: podcastEpisodicKindConfig }),
				{ states: ["in_progress"] },
				{ pages: { items: { limit: 20 } } },
			),
		),
	};
	const analytics: Reads = {
		"analytics-trend-all": read((pageClient) =>
			mediaRecipes.execute(
				pageClient,
				mediaAnalyticsTrendRecipe({ reference }),
				reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
			),
		),
		"analytics-hours-all": read((pageClient) =>
			mediaRecipes.execute(
				pageClient,
				mediaAnalyticsHoursRecipe({ reference }),
				reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
			),
		),
		"analytics-summary-all": read((pageClient) =>
			mediaRecipes.execute(
				pageClient,
				mediaAnalyticsSummaryRecipe({ reference }),
				reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
			),
		),
		"analytics-ranking-all": read((pageClient) =>
			mediaRecipes.execute(
				pageClient,
				mediaAnalyticsRankingRecipe({ reference }),
				reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
			),
		),
		"analytics-records-all": read((pageClient) =>
			mediaRecipes.execute(
				pageClient,
				mediaAnalyticsRecordsRecipe({ reference }),
				reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
			),
		),
		"analytics-summary-year": read((pageClient) =>
			mediaRecipes.execute(pageClient, mediaAnalyticsSummaryRecipe({ reference }), {
				...reportingArguments({
					grouping: "auto",
					comparison: "previous-period",
					range: { days: 365, kind: "rolling" },
				}),
			}),
		),
	};
	const month = today.slice(0, 7);
	const window = { month, localEnd: midnight(32), localStart: `${month}-01T00:00:00.000Z` };
	const sources = yield* executeRyotQLRecipe(client, calendarSourcesRecipe, {});
	const calendar: Reads = Object.fromEntries(
		sources.map((source) => [
			`calendar-${source.slug}`,
			read((pageClient) =>
				executeRyotQLRecipe(
					pageClient,
					Result.getOrThrow(calendarOccurrencesPageRecipe({ source })),
					{
						windowEnd: calendarWindowBounds(source.precision, window).end,
						windowStart: calendarWindowBounds(source.precision, window).start,
					},
				),
			),
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
		if (
			view.reference.kind !== "plugin" ||
			!view.reference.slug.startsWith("all-") ||
			view.dataSources === null ||
			Result.isFailure(decoded)
		) {
			continue;
		}
		const settings = decoded.success;
		const name = `view-${view.reference.slug}`;
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
	const shell: Reads = {
		"plugin-catalog": read((pageClient) =>
			executeRyotQLRecipe(pageClient, pluginClientCatalogRecipe, {}),
		),
		"plugin-messages": read((pageClient) =>
			pageClient.call((c) => c.plugins.messages({ params: { locale: LocaleTag.make("en") } })),
		),
	};
	const detail: Reads = {
		...detailReads("movie", yield* detailTarget(db, userId, "movie"), (entityId) => ({
			people: read((pageClient) =>
				mediaRecipes.execute(pageClient, movieRecipes.peopleRecipe({ reference }), { entityId }),
			),
			summary: read((pageClient) =>
				mediaRecipes.execute(pageClient, movieRecipes.summaryRecipe({ reference }), { entityId }),
			),
			overview: read((pageClient) =>
				mediaRecipes.execute(pageClient, movieRecipes.overviewRecipe({ reference }), { entityId }),
			),
			activity: read((pageClient) =>
				mediaRecipes.execute(pageClient, movieRecipes.activityRecipe({ reference }), { entityId }),
			),
		})),
		...detailReads("show", yield* detailTarget(db, userId, "show"), (entityId) => ({
			people: read((pageClient) =>
				mediaRecipes.execute(pageClient, showRecipes.peopleRecipe({ reference }), { entityId }),
			),
			summary: read((pageClient) =>
				mediaRecipes.execute(pageClient, showRecipes.summaryRecipe({ reference }), { entityId }),
			),
			overview: read((pageClient) =>
				mediaRecipes.execute(pageClient, showRecipes.overviewRecipe({ reference }), { entityId }),
			),
			activity: read((pageClient) =>
				mediaRecipes.execute(pageClient, showRecipes.activityRecipe({ reference }), { entityId }),
			),
		})),
	};
	return { home, reads: { ...shell, ...home, ...detail, ...analytics, ...calendar, ...browsing } };
});

const fitnessReads = Effect.fn("fitnessReads")(function* (client: Client) {
	const reference = yield* workoutReference(client);

	const reads: Reads = {
		"fitness-hours": read((pageClient) =>
			fitnessRecipes.execute(
				pageClient,
				fitnessWorkoutStartsByHourRecipe({ reference }),
				reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
			),
		),
		"fitness-totals-all": read((pageClient) =>
			fitnessRecipes.execute(
				pageClient,
				fitnessAnalyticsTotalsRecipe({ reference }),
				reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
			),
		),
		"fitness-workouts": read((pageClient) =>
			fitnessRecipes.execute(
				pageClient,
				fitnessAnalyticsWorkoutsRecipe({ reference }),
				reportingArguments({ grouping: "auto", comparison: "none", range: { kind: "all-time" } }),
			),
		),
		"fitness-trend": read((pageClient) =>
			fitnessRecipes.execute(pageClient, fitnessAnalyticsTrendRecipe({ reference }), {
				...reportingArguments({
					grouping: "auto",
					comparison: "none",
					range: { kind: "all-time" },
				}),
				metric: "workouts",
			}),
		),
		"fitness-rank-targets": read((pageClient) =>
			fitnessRecipes.execute(pageClient, historicalFitnessRankingRecipe({ reference }), {
				...reportingArguments({
					grouping: "auto",
					comparison: "none",
					range: { kind: "all-time" },
				}),
				kind: "targets",
			}),
		),
		"fitness-rank-exercises": read((pageClient) =>
			fitnessRecipes.execute(pageClient, historicalFitnessRankingRecipe({ reference }), {
				...reportingArguments({
					grouping: "auto",
					comparison: "none",
					range: { kind: "all-time" },
				}),
				kind: "exercises",
			}),
		),
	};
	return reads;
});

const attempt = (run: Read, client: Client) =>
	run(client).pipe(
		Effect.as("ok"),
		Effect.timeoutOrElse({
			duration: Duration.minutes(3),
			orElse: () => Effect.succeed("timeout"),
		}),
		Effect.catchCause((cause) => Effect.succeed(failureTag(cause))),
	);

/** Times `run` warm: `WARMUP` unmeasured runs, then `SAMPLES` runs, each after the database is quiet. */
const measure = Effect.fn("measure")(function* (
	db: PerfDatabase,
	label: string,
	run: Read,
	session: { client: Client; readonly renew: Effect.Effect<Client, unknown, E2eServices> },
) {
	const once = Effect.gen(function* () {
		const outcome = yield* attempt(run, session.client);
		if (!outcome.startsWith("AuthUnauthorized")) {
			return outcome;
		}
		session.client = yield* session.renew;
		return yield* attempt(run, session.client);
	});
	for (let index = 0; index < WARMUP; index++) {
		const outcome = yield* once;
		if (outcome !== "ok") {
			yield* appendReport(OUT, { n: 0, label, outcome });
			return;
		}
	}
	const samples: Array<{ ms: number; bytes: number; calls: number; execMs: number }> = [];
	const before = yield* db.statements;
	let outcome = "ok";
	while (samples.length < SAMPLES && outcome === "ok") {
		yield* db.quiet;
		const start = statementCalls(yield* db.statements);
		const startedAt = performance.now();
		const counted = yield* countingResponseBytes(once);
		const ms = performance.now() - startedAt;
		const end = statementCalls(yield* db.statements);
		outcome = counted.value;
		samples.push({
			ms,
			bytes: counted.bytes,
			calls: end.calls - start.calls,
			execMs: end.execMs - start.execMs,
		});
	}
	const slowest = yield* db.slowest(before, yield* db.statements, samples.length);
	yield* appendReport(OUT, {
		label,
		outcome,
		slowest,
		n: samples.length,
		bytes: Math.max(...samples.map((sample) => sample.bytes)),
		statementsMax: Math.max(...samples.map((sample) => sample.calls)),
		statementsP50: percentile(
			samples.map((sample) => sample.calls),
			0.5,
		),
		rttP50: Math.round(
			percentile(
				samples.map((sample) => sample.ms),
				0.5,
			),
		),
		rttP95: Math.round(
			percentile(
				samples.map((sample) => sample.ms),
				0.95,
			),
		),
		execMsP50: Math.round(
			percentile(
				samples.map((sample) => sample.execMs),
				0.5,
			),
		),
	});
});

const LIBRARY_OWNER = `
	select e.user_id, count(*)::int as size
	from relationship r
	join entity e on e.id = r.target_entity_id
	join "user" u on u.id = e.user_id
	where e.entity_schema_slug = 'media-library'
		and r.relationship_schema_slug = 'in-media-library' and u.disabled_at is null
	group by 1 order by 2 desc limit 1`;

const LIFTER = `
	select e.user_id, count(*)::int as size
	from entity e
	join "user" u on u.id = e.user_id
	where e.entity_schema_slug = 'workout' and u.disabled_at is null
	group by 1 order by 2 desc limit 1`;

describe.skipIf(!RUN_LIBRARY_CHECK)("library check", () => {
	it.live("times real reads on a restored library", () =>
		Effect.gen(function* () {
			const db = yield* perfDatabase;
			const library = requirePresent(
				(yield* db.query(UserRows, LIBRARY_OWNER))[0],
				"the restored database has no library",
			);
			const lifter = (yield* db.query(UserRows, LIFTER))[0];
			yield* appendReport(OUT, { members: library.size, workouts: lifter?.size ?? 0 });

			const { home, reads } = yield* mediaReads(
				yield* impersonate(library.user_id),
				db,
				library.user_id,
			);
			const groups: readonly { readonly reads: Reads; readonly userId: string }[] = [
				{ reads, userId: library.user_id },
				...(lifter === undefined
					? []
					: [
							{
								userId: lifter.user_id,
								reads: yield* fitnessReads(yield* impersonate(lifter.user_id)),
							},
						]),
			];

			for (const group of groups) {
				const session = {
					renew: impersonate(group.userId),
					client: yield* impersonate(group.userId),
				};
				for (const [label, run] of Object.entries(group.reads)) {
					if (ONLY?.includes(label) !== false) {
						yield* measure(db, label, run, session);
					}
				}
			}

			for (let page = 0; page < PAGE_LOADS; page++) {
				const client = yield* impersonate(library.user_id);
				yield* db.quiet;
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
				yield* appendReport(OUT, { page, outcomes, ms: Math.round(performance.now() - start) });
			}
			if (LIBRARY_CHECK_WRITES) {
				const client = yield* impersonate(library.user_id);
				for (let round = 0; round < 5; round++) {
					const movie = yield* createBuiltinMediaLifecycleFixture(client, {
						entitySchemaSlug: "movie",
					});
					const timed = <A, E, R>(label: string, action: Effect.Effect<A, E, R>) =>
						Effect.gen(function* () {
							const startedAt = yield* Clock.currentTimeMillis;
							const result = yield* action;
							yield* appendReport(OUT, {
								round,
								write: label,
								ms: (yield* Clock.currentTimeMillis) - startedAt,
							});
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
