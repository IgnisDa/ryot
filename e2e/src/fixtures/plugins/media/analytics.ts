import type { ContractPayload } from "@ryot-app/contract/client";
import type { ReportingSelection } from "@ryot-app/contract/modules/analytics/reporting";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { consumptionBasisFor } from "@ryot-app/media-plugin/shared/consumption";
import { randomUuid } from "@ryot-app/testing/random";
import { Clock, Effect } from "effect";

import { type Client, createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import { listEventSchemas, requireEventSchemaBySlug } from "~/fixtures/kernel/event-schemas";
import { waitForCreateEvents } from "~/fixtures/kernel/events";
import { deleteUserAndWait } from "~/fixtures/kernel/user-lifecycle";
import { assertCondition } from "~/support/assertions";

import { mediaReferenceForEntity } from "./activity-log";
import { waitForMediaConsumptionReport } from "./consumption";
import { findMediaEntitySchema } from "./entity-schemas";
import { settledHistoryCorrection } from "./history-correction";

const reportingSelection: ReportingSelection = {
	grouping: "day",
	comparison: "previous-period",
	range: { kind: "custom", endDate: "2026-09-07", startDate: "2026-09-01" },
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
		name: `Analytics ${slug} ${yield* randomUuid}`,
	});
	return { ...entity, eventSchemas: yield* listEventSchemas(client, schema.reference) };
});

export const createMediaAnalyticsFixture = Effect.fn("createMediaAnalyticsFixture")(function* () {
	const account = yield* createAuthenticatedClient();
	yield* Effect.addFinalizer(() =>
		deleteUserAndWait(account.userId, account.client.target).pipe(Effect.ignore),
	);
	const { client } = account;
	const timeZone = UTC;

	const { book, movie, anime } = yield* Effect.all(
		{
			movie: createAnalyticsMediaEntity(client, "movie", {}),
			book: createAnalyticsMediaEntity(client, "book", { pages: 100 }),
			anime: createAnalyticsMediaEntity(client, "anime", { episodes: 12 }),
		},
		{ concurrency: 3 },
	);
	const reference = yield* mediaReferenceForEntity(client, book.id);

	const bookBasis = consumptionBasisFor("book", { pages: 100 });
	const movieBasis = consumptionBasisFor("movie", {});
	const animeBasis = consumptionBasisFor("anime", { episodes: 12 });
	const bookRun = yield* randomUuid;
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
			properties: { timeSpent: 0, consumptionBasis: movieBasis, sourceRun: yield* randomUuid },
		},
		{
			entityId: movie.id,
			occurredAt: "2026-09-05T18:00:00.000Z",
			properties: { consumptionBasis: movieBasis, sourceRun: yield* randomUuid },
			eventSchemaSlug: requireEventSchemaBySlug(movie.eventSchemas, "complete").id,
		},
		{
			entityId: movie.id,
			occurredAt: "2026-09-06T18:00:00.000Z",
			eventSchemaSlug: requireEventSchemaBySlug(movie.eventSchemas, "complete").id,
			properties: { dateUnknown: true, consumptionBasis: movieBasis, sourceRun: yield* randomUuid },
		},
		{
			entityId: anime.id,
			occurredAt: "2026-09-02T19:00:00.000Z",
			eventSchemaSlug: requireEventSchemaBySlug(anime.eventSchemas, "item-complete").id,
			properties: {
				consumptionBasis: animeBasis,
				sourceRun: yield* randomUuid,
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
	const created = yield* client.call((c) => c.events.create({ payload: sourceEvents }));
	const written = yield* waitForCreateEvents(client, created);
	const sourceEventIds = written.outcomes.map((outcome) => {
		assertCondition(outcome.status === "written", "Expected every analytics source event to save");
		return outcome.eventId;
	});
	yield* settledHistoryCorrection(client, account.userId);
	const now = yield* Clock.currentTimeMillis;
	const report = yield* waitForMediaConsumptionReport(client, {
		now,
		timeZone,
		reference,
		selection: reportingSelection,
	});
	return {
		now,
		report,
		account,
		timeZone,
		reference,
		sourceEvents,
		sourceEventIds,
		reportingSelection,
		entities: { book, movie, anime },
	};
});
