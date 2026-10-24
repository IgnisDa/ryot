import type { ContractPayload } from "@ryot-app/contract/client";
import type { ReportingSelection } from "@ryot-app/contract/modules/analytics/reporting";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { consumptionBasisFor } from "@ryot-app/media-plugin/shared/consumption";
import {
	consumptionRows,
	consumptionScope,
	consumptionValue,
	mediaConsumptionReportRecipe,
} from "@ryot-app/media-plugin/shared/consumption-recipes";
import { PLUGIN_PACKAGE_ID } from "@ryot-app/media-plugin/shared/plugin-identity";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	inArray,
	isNotNull,
	join,
	literal,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Cause, Clock, Effect, Exit, Result, Schema } from "effect";

import { getUserSettings, updateUserSettingsPreferences } from "~/fixtures/kernel/account";
import { type Client, createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import { listEventSchemas, requireEventSchemaBySlug } from "~/fixtures/kernel/event-schemas";
import { waitForCreateEvents } from "~/fixtures/kernel/events";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { deleteUserAndWait } from "~/fixtures/kernel/user-lifecycle";
import { assertCondition, requirePresent } from "~/support/assertions";

import { mediaReferenceForEntity } from "./activity-log";
import { waitForMediaConsumptionReport } from "./consumption";
import { findMediaEntitySchema } from "./entity-schemas";
import { settledHistoryCorrection } from "./history-correction";

const reportingSelection: ReportingSelection = {
	grouping: "day",
	comparison: "previous-period",
	range: { kind: "custom", endDate: "2026-09-07", startDate: "2026-09-01" },
};

const diagnosticReference = {
	kind: "package",
	scope: "system",
	packageId: PLUGIN_PACKAGE_ID,
} satisfies Parameters<typeof mediaConsumptionReportRecipe>[0]["reference"];

const mediaAnalyticsWorkSnapshotRecipe = defineRecipe(() => {
	const work = table("backgroundWork", "mediaAnalyticsSnapshotWork");
	const stream = table("eventStream", "mediaAnalyticsSnapshotStream");
	const streamWork = table("eventStreamWork", "mediaAnalyticsSnapshotStreamWork");
	const event = table("event", "mediaAnalyticsSnapshotSource");
	return {
		map: (snapshot) => Result.succeed(snapshot),
		queries: {
			work: selectedRows(work, {
				limit: 100,
				orderBy: [ascending(column(work, "createdAt")), ascending(column(work, "id"))],
				where: and(
					schemaOwnerPredicate(work, "pluginId", diagnosticReference),
					inArray(column(work, "status"), ["queued", "running", "failed"].map(literal)),
				),
				selection: {
					id: selectedField(column(work, "id"), Schema.String),
					scope: selectedField(column(work, "scope"), Schema.String),
					status: selectedField(column(work, "status"), Schema.String),
					error: selectedField(column(work, "error"), Schema.NullOr(Schema.String)),
				},
			}),
			streams: selectedRows(stream, {
				limit: 100,
				orderBy: [ascending(column(stream, "id"))],
				where: schemaOwnerPredicate(stream, "eventSchemaPluginId", diagnosticReference),
				joins: [join("left", streamWork, eq(column(streamWork, "id"), column(stream, "id")))],
				selection: {
					id: selectedField(column(stream, "id"), Schema.String),
					revision: selectedField(column(stream, "revision"), Schema.Int),
					entityId: selectedField(column(stream, "entityId"), Schema.String),
					eventSchemaSlug: selectedField(column(stream, "eventSchemaSlug"), Schema.String),
					completedRevision: selectedField(
						column(streamWork, "completedRevision"),
						Schema.NullOr(Schema.Int),
					),
				},
			}),
			sources: selectedRows(event, {
				limit: 100,
				orderBy: [ascending(column(event, "id"))],
				where: and(
					consumptionRows(event),
					consumptionScope(event, { reference: diagnosticReference }),
				),
				selection: {
					id: selectedField(column(event, "id"), Schema.String),
					entityId: selectedField(column(event, "entityId"), Schema.String),
					eventSchemaSlug: selectedField(column(event, "eventSchemaSlug"), Schema.String),
					hasContribution: selectedField(isNotNull(consumptionValue(event)), Schema.Boolean),
					hasProjection: selectedField(isNotNull(column(event, "projection")), Schema.Boolean),
					projectionStatus: selectedField(
						column(event, "projectionStatus"),
						Schema.NullOr(Schema.String),
					),
				},
			}),
		},
	};
});

const logMediaAnalyticsFailureSnapshot = Effect.fn("logMediaAnalyticsFailureSnapshot")(function* (
	client: Client,
	fixtureId: string,
) {
	const now = yield* Clock.currentTimeMillis;
	const coverage = yield* Effect.exit(
		executeRyotQLRecipe(
			client,
			mediaConsumptionReportRecipe({
				now,
				selection: reportingSelection,
				timeZone: TimeZone.make("UTC"),
				reference: diagnosticReference,
			}),
		).pipe(
			Effect.map((report) => ({
				processing: report.processing,
				pageInfo: report.current.pageInfo,
				groups: report.current.items.map(({ failed, pending, mediaType }) => ({
					failed,
					pending,
					mediaType,
				})),
			})),
		),
	);
	const work = yield* Effect.exit(executeRyotQLRecipe(client, mediaAnalyticsWorkSnapshotRecipe()));
	yield* Effect.log(
		"Media analytics pre-cleanup failure snapshot",
		stableStringify({
			fixtureId,
			capturedAt: now,
			userId: client.userId,
			apiUrl: client.target.apiUrl,
			work: Exit.isSuccess(work) ? work.value : { diagnosticFailure: Cause.pretty(work.cause) },
			coverage: Exit.isSuccess(coverage)
				? coverage.value
				: { diagnosticFailure: Cause.pretty(coverage.cause) },
		}),
	);
});

const expectedSourceValues = {
	activeDays: 3,
	unknownDate: 1,
	distinctTitles: 2,
	titleCompletions: 3,
	activeObservations: 5,
	reviews: { rated: 2, reviews: 2, averageRating: 40 },
	consistency: [
		{ events: 3, day: "2026-09-02" },
		{ events: 1, day: "2026-09-04" },
		{ events: 1, day: "2026-09-05" },
	],
	canonical: [
		{
			unknownDate: 0,
			mediaType: "anime",
			episodesMissing: 0,
			titleCompletions: 0,
			episodesRecorded: 1,
			episodesEstimated: 0,
			episodeCompletions: 0,
			activeObservations: 1,
		},
		{
			unknownDate: 0,
			pagesMissing: 0,
			mediaType: "book",
			pagesRecorded: 40,
			pagesEstimated: 60,
			titleCompletions: 1,
			activeObservations: 2,
		},
		{
			unknownDate: 1,
			minutesMissing: 1,
			mediaType: "movie",
			minutesRecorded: 0,
			titleCompletions: 2,
			minutesEstimated: 0,
			activeObservations: 2,
		},
	],
};

const createAnalyticsMediaEntity = Effect.fn("createAnalyticsMediaEntity")(function* (
	client: Client,
	slug: string,
	properties: ContractPayload<"entities", "create">["properties"],
) {
	const { schema } = yield* findMediaEntitySchema(client, slug);
	const entity = yield* createEntity(client, {
		properties,
		entitySchema: schema.reference,
		name: `Analytics ${slug} ${crypto.randomUUID()}`,
	});
	return { ...entity, eventSchemas: yield* listEventSchemas(client, schema.reference) };
});

export const createMediaAnalyticsFixture = Effect.fn("createMediaAnalyticsFixture")(function* () {
	const fixtureId = crypto.randomUUID();
	const startedAt = yield* Clock.currentTimeMillis;
	const logStage = Effect.fnUntraced(function* (stage: string) {
		yield* Effect.log("Media analytics fixture diagnostic", {
			stage,
			fixtureId,
			elapsedMs: (yield* Clock.currentTimeMillis) - startedAt,
		});
	});
	yield* logStage("account:start");
	const account = yield* createAuthenticatedClient();
	yield* logStage("account:ready");
	yield* Effect.log("Media analytics fixture identity", {
		fixtureId,
		userId: account.userId,
		apiUrl: account.client.target.apiUrl,
	});
	yield* Effect.addFinalizer((exit) =>
		(Exit.isFailure(exit)
			? logMediaAnalyticsFailureSnapshot(account.client, fixtureId).pipe(
					Effect.catchCause((cause) =>
						Effect.log("Media analytics failure snapshot could not be captured", {
							cause,
							fixtureId,
						}),
					),
				)
			: Effect.void
		).pipe(
			Effect.ensuring(deleteUserAndWait(account.userId, account.client.target).pipe(Effect.ignore)),
		),
	);
	const { client } = account;
	const timeZone = TimeZone.make("UTC");
	yield* updateUserSettingsPreferences(client, { reportingTimeZone: timeZone });
	assertCondition(
		(yield* getUserSettings(client)).preferences.reportingTimeZone === timeZone,
		"Expected the Media analytics fixture account to use UTC reporting time",
	);

	yield* logStage("entities:start");
	const { book, movie, anime } = yield* Effect.all(
		{
			movie: createAnalyticsMediaEntity(client, "movie", {}),
			book: createAnalyticsMediaEntity(client, "book", { pages: 100 }),
			anime: createAnalyticsMediaEntity(client, "anime", { episodes: 12 }),
		},
		{ concurrency: 3 },
	);
	yield* logStage("entities:ready");
	yield* Effect.log("Media analytics fixture entities", {
		fixtureId,
		book: book.id,
		movie: movie.id,
		anime: anime.id,
	});
	const reference = yield* mediaReferenceForEntity(client, book.id);
	for (const entity of [movie, anime]) {
		assertCondition(
			(yield* mediaReferenceForEntity(client, entity.id)).pluginId === reference.pluginId,
			"Expected every analytics item to belong to the same installed Media plugin",
		);
	}

	const bookBasis = consumptionBasisFor("book", { pages: 100 });
	const movieBasis = consumptionBasisFor("movie", {});
	const animeBasis = consumptionBasisFor("anime", { episodes: 12 });
	const bookRun = crypto.randomUUID();
	const sourceEvents = [
		{
			entityId: book.id,
			occurredAt: "2026-09-02T12:00:00.000Z",
			eventSchemaSlug: requireEventSchemaBySlug(book.eventSchemas, "progress").id,
			properties: {
				progressPages: 40,
				sourceRun: bookRun,
				calendarDate: "2026-09-02",
				consumptionBasis: bookBasis,
			},
		},
		{
			entityId: book.id,
			occurredAt: "2026-09-04T12:00:00.000Z",
			eventSchemaSlug: requireEventSchemaBySlug(book.eventSchemas, "complete").id,
			properties: { sourceRun: bookRun, calendarDate: "2026-09-04", consumptionBasis: bookBasis },
		},
		{
			entityId: movie.id,
			occurredAt: "2026-09-02T18:00:00.000Z",
			eventSchemaSlug: requireEventSchemaBySlug(movie.eventSchemas, "complete").id,
			properties: { timeSpent: 0, consumptionBasis: movieBasis, sourceRun: crypto.randomUUID() },
		},
		{
			entityId: movie.id,
			occurredAt: "2026-09-05T18:00:00.000Z",
			eventSchemaSlug: requireEventSchemaBySlug(movie.eventSchemas, "complete").id,
			properties: { consumptionBasis: movieBasis, sourceRun: crypto.randomUUID() },
		},
		{
			entityId: movie.id,
			occurredAt: "2026-09-06T18:00:00.000Z",
			eventSchemaSlug: requireEventSchemaBySlug(movie.eventSchemas, "complete").id,
			properties: {
				dateUnknown: true,
				consumptionBasis: movieBasis,
				sourceRun: crypto.randomUUID(),
			},
		},
		{
			entityId: anime.id,
			occurredAt: "2026-09-02T19:00:00.000Z",
			eventSchemaSlug: requireEventSchemaBySlug(anime.eventSchemas, "item-complete").id,
			properties: {
				consumptionBasis: animeBasis,
				sourceRun: crypto.randomUUID(),
				consumedItem: { position: 7, unit: "episodes" },
			},
		},
		{
			entityId: book.id,
			properties: { rating: 0 },
			occurredAt: "2026-09-03T12:00:00.000Z",
			eventSchemaSlug: requireEventSchemaBySlug(book.eventSchemas, "review").id,
		},
		{
			entityId: movie.id,
			properties: { rating: 80 },
			occurredAt: "2026-09-05T12:00:00.000Z",
			eventSchemaSlug: requireEventSchemaBySlug(movie.eventSchemas, "review").id,
		},
	] satisfies ContractPayload<"events", "create">;
	yield* logStage("source-write:start");
	const created = yield* client.call((c) => c.events.create({ payload: sourceEvents }));
	yield* logStage("source-write:responded");
	yield* Effect.log("Media analytics fixture source operation", {
		fixtureId,
		operation: "count" in created ? { count: created.count } : created,
	});
	const written = yield* waitForCreateEvents(client, created);
	yield* logStage("source-write:completed");
	assertCondition(written.failure === null, "Expected the analytics source batch to succeed");
	assertCondition(
		written.outcomes.length === sourceEvents.length,
		"Missing analytics write outcomes",
	);
	const sourceEventIds = written.outcomes.map((outcome) => {
		assertCondition(outcome.status === "written", "Expected every analytics source event to save");
		return outcome.eventId;
	});
	yield* logStage("history-correction:start");
	yield* settledHistoryCorrection(client, account.userId);
	yield* logStage("history-correction:settled");
	const now = yield* Clock.currentTimeMillis;
	yield* logStage("consumption-report:start");
	const report = yield* waitForMediaConsumptionReport(client, {
		now,
		timeZone,
		reference,
		selection: reportingSelection,
	});
	yield* logStage("consumption-report:ready");
	assertCondition(report.current.items.length === 3, "Expected exactly three Media report groups");
	assertCondition(!report.current.pageInfo.hasMore, "Expected complete Media fixture totals");
	for (const expected of expectedSourceValues.canonical) {
		const row = requirePresent(
			report.current.items.find(({ mediaType }) => mediaType === expected.mediaType),
			`Missing analytics totals for ${expected.mediaType}`,
		);
		assertCondition(
			Object.entries(expected).every(([key, value]) => Reflect.get(row, key) === value),
			`Unexpected canonical analytics totals for ${expected.mediaType}`,
		);
	}
	return {
		now,
		report,
		account,
		timeZone,
		reference,
		sourceEvents,
		sourceEventIds,
		reportingSelection,
		expectedSourceValues,
		entities: { book, movie, anime },
	};
});
