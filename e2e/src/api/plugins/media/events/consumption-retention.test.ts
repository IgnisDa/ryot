import type { ReportingSelection } from "@ryot-app/contract/modules/analytics/reporting";
import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import {
	and,
	ascending,
	castText,
	column,
	defineRecipe,
	eq,
	jsonPath,
	literal,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/ryotql";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect, Result, Schema } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	deleteUserAndWait,
	executeRyotQLRecipe,
	exportAndDownloadBackup,
	findEntityIdByName,
	getEntity,
	listEventSchemas,
	listEventsForEntity,
	restoreBackup,
	waitForCreateEvents,
} from "~/fixtures/kernel";
import { readBackupSection } from "~/fixtures/kernel/backups";
import { clearEntityUserData, mergeEntityUserData } from "~/fixtures/kernel/entity-user-data";
import { requireEventSchemaBySlug } from "~/fixtures/kernel/event-schemas";
import { mediaReferenceForEntity } from "~/fixtures/plugins/media/activity-log";
import {
	mediaConsumptionMeasure,
	requireMediaConsumptionGroup,
	waitForMediaConsumptionReport,
} from "~/fixtures/plugins/media/consumption";
import { findMediaEntitySchema } from "~/fixtures/plugins/media/entity-schemas";
import { createBuiltinMediaLifecycleFixture } from "~/fixtures/plugins/media/events";
import {
	historyEventsFor,
	settledHistoryCorrection,
} from "~/fixtures/plugins/media/history-correction";
import { seedShow } from "~/fixtures/plugins/media/media";
import { assertCompleted, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { nowIso } from "~/support/time";

const reportNow = Date.parse("2026-01-05T12:00:00.000Z");

const allTime: ReportingSelection = {
	grouping: "day",
	comparison: "none",
	range: { kind: "all-time" },
};

const onCalendarDay = (date: string): ReportingSelection => ({
	grouping: "day",
	comparison: "none",
	range: { endDate: date, kind: "custom", startDate: date },
});

const waitForReport = (
	client: Parameters<typeof waitForMediaConsumptionReport>[0],
	reference: Parameters<typeof waitForMediaConsumptionReport>[1]["reference"],
	selection: ReportingSelection = allTime,
	entityId?: string,
) =>
	waitForMediaConsumptionReport(client, {
		reference,
		selection,
		now: reportNow,
		timeZone: TimeZone.make("UTC"),
		...(entityId === undefined ? {} : { entityId }),
	});

const restoredHistoryRevisionRecipe = defineRecipe(
	(input: { entityId: string; reference: PluginIdentityReference }) => {
		const scope = table("eventScope", "restoreScope");
		const checkpoint = table("event", "restoreCheckpoint");
		return {
			map: ({ scope: current, checkpoint: saved }) =>
				Result.succeed({ scope: current?.revision ?? 0, checkpoint: saved?.properties }),
			queries: {
				scope: selectedOptionalRow(scope, {
					orderBy: [ascending(column(scope, "id"))],
					selection: { revision: selectedField(column(scope, "revision"), Schema.Int) },
					where: and(
						schemaOwnerPredicate(scope, "eventSchemaPluginId", input.reference),
						eq(column(scope, "entityId"), literal(input.entityId)),
					),
				}),
				checkpoint: selectedOptionalRow(checkpoint, {
					orderBy: [ascending(column(checkpoint, "id"))],
					selection: {
						properties: selectedField(
							column(checkpoint, "properties"),
							Schema.Struct({
								phase: Schema.String,
								requestKey: Schema.String,
								sourceRevision: Schema.Int,
							}),
						),
					},
					where: and(
						schemaOwnerPredicate(checkpoint, "eventSchemaPluginId", input.reference),
						eq(column(checkpoint, "eventSchemaSlug"), literal("history-correction")),
						eq(
							castText(jsonPath(column(checkpoint, "properties"), "subjectEntityId")),
							literal(input.entityId),
						),
					),
				}),
			},
		};
	},
);

describe("Media consumption evidence retention", () => {
	it.live("merges independent same-date Book completions without deduping their frozen bases", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const source = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "book",
				properties: { pages: 100 },
			});
			const target = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "book",
				properties: { pages: 200 },
			});
			const reference = yield* mediaReferenceForEntity(client, source.entityId);
			const sourceRunA = `merge-source-${yield* randomUuid}`;
			const sourceRunB = `merge-target-${yield* randomUuid}`;
			const occurredAt = "2026-01-02T12:00:00.000Z";
			const sourceProperties = {
				sourceRun: sourceRunA,
				calendarDate: "2026-01-02",
				consumptionBasis: { total: 100, unit: "pages", property: "pages" },
			};
			const targetProperties = {
				dateUnknown: true,
				sourceRun: sourceRunB,
				consumptionBasis: { total: 200, unit: "pages", property: "pages" },
			};
			const created = yield* waitForCreateEvents(
				client,
				yield* client.call((c) =>
					c.events.create({
						payload: [
							{
								occurredAt,
								entityId: source.entityId,
								properties: sourceProperties,
								eventSchemaSlug: source.completeEventSchemaSlug,
							},
							{
								occurredAt,
								entityId: target.entityId,
								properties: targetProperties,
								eventSchemaSlug: target.completeEventSchemaSlug,
							},
						],
					}),
				),
			);
			expect(created.failure).toBeNull();
			expect(created.outcomes.map(({ status }) => status)).toEqual(["written", "written"]);
			yield* settledHistoryCorrection(client, userId);

			const before = yield* waitForReport(client, reference);
			expect(before.processing).toBe("ready");
			const beforeBook = requireMediaConsumptionGroup(before, "book");
			expect((yield* mediaConsumptionMeasure(beforeBook, "pages")).total).toBe(300);
			expect(beforeBook.titleCompletions).toBe(2);
			expect(before.unknownDate).toBe(1);

			const mergeRequest = {
				mergeFrom: EntityId.make(source.entityId),
				mergeInto: EntityId.make(target.entityId),
			};
			yield* mergeEntityUserData(client, mergeRequest, {
				submittedAt: nowIso(),
				idempotencyKey: yield* randomUuid,
			});
			yield* settledHistoryCorrection(client, userId);

			const after = yield* waitForReport(client, reference);
			expect(after.processing).toBe("ready");
			const targetBook = requireMediaConsumptionGroup(after, "book");
			expect((yield* mediaConsumptionMeasure(targetBook, "pages")).total).toBe(300);
			expect(targetBook.titleCompletions).toBe(2);
			expect(after.current.types).toEqual(before.current.types);

			const sourceFiltered = yield* waitForReport(client, reference, allTime, source.entityId);
			expect(sourceFiltered.processing).toBe("ready");
			expect(sourceFiltered.current.types).toEqual([]);
			const targetEvents = yield* historyEventsFor(client, target.entityId);
			expect(yield* historyEventsFor(client, source.entityId)).toEqual([]);
			expect(targetEvents.map(({ eventSchemaSlug }) => eventSchemaSlug).sort()).toEqual([
				"add-to-media-library",
				"add-to-media-library",
				"complete",
				"complete",
			]);
			expect(
				targetEvents.find(({ properties }) => properties["sourceRun"] === sourceRunA)?.properties,
			).toEqual(sourceProperties);
			expect(
				targetEvents.find(({ properties }) => properties["sourceRun"] === sourceRunB)?.properties,
			).toEqual(targetProperties);
		}),
	);

	it.live("clears a completed show tree without leaking projections into later consumption", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const show = yield* seedShow(client, {
				inLibrary: false,
				properties: { productionStatus: "Ended" },
				name: `Consumption clear ${yield* randomUuid}`,
				seasons: [
					{
						seasonNumber: 1,
						episodes: [
							{ episodeNumber: 1, properties: { runtime: 20 } },
							{ episodeNumber: 2, properties: { runtime: 30 } },
						],
					},
				],
			});
			const { schema: episodeSchema } = yield* findMediaEntitySchema(client, "show-episode");
			const complete = requireEventSchemaBySlug(
				yield* listEventSchemas(client, episodeSchema.reference),
				"complete",
			);
			const firstEpisode = requirePresent(show.episodes[0], "First episode is missing");
			const secondEpisode = requirePresent(show.episodes[1], "Second episode is missing");
			const episodes = [firstEpisode, secondEpisode];
			const completions = yield* waitForCreateEvents(
				client,
				yield* client.call((c) =>
					c.events.create({
						payload: episodes.map((episode, index) => ({
							properties: {},
							entityId: episode.id,
							eventSchemaSlug: complete.id,
							occurredAt: `2026-01-0${index + 1}T12:00:00.000Z`,
						})),
					}),
				),
			);
			expect(completions.failure).toBeNull();
			yield* settledHistoryCorrection(client, userId);

			const reference = yield* mediaReferenceForEntity(client, show.show.id);
			const before = yield* waitForReport(client, reference);
			expect(before.processing).toBe("ready");
			const parentBefore = requireMediaConsumptionGroup(before, "show");
			expect(parentBefore.titleCompletions).toBe(1);
			expect((yield* mediaConsumptionMeasure(parentBefore, "minutes")).total).toBe(0);
			expect(
				(yield* mediaConsumptionMeasure(
					requireMediaConsumptionGroup(before, "show-episode"),
					"minutes",
				)).total,
			).toBe(50);

			const clearReceipt = { submittedAt: nowIso(), idempotencyKey: yield* randomUuid };
			const cleared = yield* clearEntityUserData(client, show.show.id, clearReceipt);
			expect(cleared.deletedEventsCount).toBeGreaterThan(0);
			yield* settledHistoryCorrection(client, userId);
			const afterClear = yield* waitForReport(client, reference);
			expect(afterClear.processing).toBe("ready");
			expect(afterClear.current.types).toEqual([]);

			for (const entity of [show.show, ...show.seasons, ...show.episodes]) {
				expect((yield* getEntity(client, entity.id)).id).toBe(entity.id);
				expect(yield* listEventsForEntity(client, entity.id, undefined, 100)).toEqual([]);
			}
			expect((yield* getEntity(client, show.show.id)).properties["productionStatus"]).toBe("Ended");
			expect((yield* getEntity(client, firstEpisode.id)).properties["runtime"]).toBe(20);
			expect((yield* getEntity(client, secondEpisode.id)).properties["runtime"]).toBe(30);

			const replay = yield* clearEntityUserData(client, show.show.id, clearReceipt);
			expect(replay).toEqual(cleared);
			expect((yield* waitForReport(client, reference)).current.types).toEqual([]);

			const freshSourceRun = `after-clear-${yield* randomUuid}`;
			const freshCompletion = yield* waitForCreateEvents(
				client,
				yield* client.call((c) =>
					c.events.create({
						payload: [
							{
								entityId: firstEpisode.id,
								eventSchemaSlug: complete.id,
								occurredAt: "2026-01-03T12:00:00.000Z",
								properties: {
									sourceRun: freshSourceRun,
									calendarDate: "2026-01-03",
									consumptionBasis: { total: 20, unit: "minutes", property: "runtime" },
								},
							},
						],
					}),
				),
			);
			expect(freshCompletion.failure).toBeNull();
			yield* settledHistoryCorrection(client, userId);
			const freshReport = yield* waitForReport(client, reference);
			expect(freshReport.processing).toBe("ready");
			const episodeGroup = requireMediaConsumptionGroup(freshReport, "show-episode");
			expect((yield* mediaConsumptionMeasure(episodeGroup, "minutes")).total).toBe(20);
			expect(episodeGroup.episodeCompletions).toBe(1);
			expect(episodeGroup.titleCompletions).toBe(0);
			expect(freshReport.current.types.filter(({ mediaType }) => mediaType === "show")).toEqual([]);
		}),
	);

	it.live(
		"restores custom Book consumption into remapped IDs and rebuilds its canonical report",
		() =>
			Effect.gen(function* () {
				const source = yield* createAuthenticatedClient();
				const target = yield* createAuthenticatedClient();
				const { schema: sourceBookSchema } = yield* findMediaEntitySchema(source.client, "book");
				const bookName = `Custom consumption backup ${yield* randomUuid}`;
				const book = yield* createEntity(source.client, {
					name: bookName,
					properties: { pages: 100 },
					entitySchema: sourceBookSchema.reference,
				});
				const eventSchemas = yield* listEventSchemas(source.client, sourceBookSchema.reference);
				const progress = requireEventSchemaBySlug(eventSchemas, "progress");
				const complete = requireEventSchemaBySlug(eventSchemas, "complete");
				const sourceRunA = `restore-shared-${yield* randomUuid}`;
				const sourceRunB = `restore-unknown-${yield* randomUuid}`;
				const eventFacts = [
					{
						eventSchemaSlug: progress.id,
						occurredAt: "2026-01-01T12:00:00.000Z",
						properties: {
							progressPages: 40,
							sourceRun: sourceRunA,
							calendarDate: "2026-01-01",
							consumptionBasis: { total: 100, unit: "pages", property: "pages" },
						},
					},
					{
						eventSchemaSlug: complete.id,
						occurredAt: "2026-01-02T12:00:00.000Z",
						properties: {
							sourceRun: sourceRunA,
							calendarDate: "2026-01-02",
							consumptionBasis: { total: 100, unit: "pages", property: "pages" },
						},
					},
					{
						eventSchemaSlug: complete.id,
						occurredAt: "2026-01-03T12:00:00.000Z",
						properties: {
							timeSpent: 0,
							dateUnknown: true,
							sourceRun: sourceRunB,
							consumptionBasis: { total: 100, unit: "pages", property: "pages" },
						},
					},
				];
				const created = yield* waitForCreateEvents(
					source.client,
					yield* source.client.call((c) =>
						c.events.create({
							payload: eventFacts.map((fact) => ({ entityId: book.id, ...fact })),
						}),
					),
				);
				expect(created.failure).toBeNull();
				expect(created.outcomes.map(({ status }) => status)).toEqual([
					"written",
					"written",
					"written",
				]);
				yield* settledHistoryCorrection(source.client, source.userId);

				const sourceReference = yield* mediaReferenceForEntity(source.client, book.id);
				const sourceAllTime = yield* waitForReport(source.client, sourceReference);
				const sourceAllTimeBook = requireMediaConsumptionGroup(sourceAllTime, "book");
				expect(sourceAllTime.processing).toBe("ready");
				const sourceAllTimePages = yield* mediaConsumptionMeasure(sourceAllTimeBook, "pages");
				expect(sourceAllTimePages.total).toBe(200);
				expect(sourceAllTimePages.recorded).toBe(40);
				expect(sourceAllTimePages.estimated).toBe(160);
				expect(sourceAllTimeBook.titleCompletions).toBe(2);
				expect(sourceAllTime.unknownDate).toBe(1);
				const sourceJan2 = yield* waitForReport(
					source.client,
					sourceReference,
					onCalendarDay("2026-01-02"),
				);
				const sourceJan2Book = requireMediaConsumptionGroup(sourceJan2, "book");
				const sourceJan2Pages = yield* mediaConsumptionMeasure(sourceJan2Book, "pages");
				expect(sourceJan2Pages.total).toBe(60);
				expect(sourceJan2Pages.recorded).toBe(0);
				expect(sourceJan2Pages.estimated).toBe(60);
				expect(sourceJan2.unknownDate).toBe(1);

				const sourceEvents = yield* historyEventsFor(source.client, book.id);
				const sourceRevisions = yield* executeRyotQLRecipe(
					source.client,
					restoredHistoryRevisionRecipe({ entityId: book.id, reference: sourceReference }),
				);
				const sourceCorrection = requirePresent(
					sourceRevisions.checkpoint,
					"Source history correction checkpoint is missing",
				);
				const { bytes } = yield* exportAndDownloadBackup(source.client);
				const archivedEvents = yield* readBackupSection(bytes, "events.ndjson");
				const archivedBookEvents = archivedEvents.filter((event) => event["entityId"] === book.id);
				expect(archivedBookEvents).toHaveLength(sourceEvents.length);
				expect(
					archivedBookEvents
						.map(({ eventSchemaSlug }) => eventSchemaSlug)
						.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
				).toEqual(sourceEvents.map(({ eventSchemaSlug }) => eventSchemaSlug).sort());
				for (const fact of eventFacts) {
					expect(archivedEvents.map(({ properties }) => properties)).toContainEqual(
						fact.properties,
					);
				}
				expect(
					archivedEvents.every(
						(event) => !Object.hasOwn(event, "projection") && !Object.hasOwn(event, "contribution"),
					),
				).toBe(true);

				yield* deleteUserAndWait(source.userId);
				const restored = yield* restoreBackup(target.client, bytes);
				assertCompleted(restored.run, "Media consumption restore");
				const { schema: targetBookSchema } = yield* findMediaEntitySchema(target.client, "book");
				const restoredBookId = yield* findEntityIdByName(target.client, {
					name: bookName,
					entitySchema: targetBookSchema.reference,
				});
				expect(restoredBookId).not.toBe(book.id);
				expect((yield* getEntity(target.client, restoredBookId)).properties).toEqual({
					pages: 100,
				});

				const targetReference = yield* mediaReferenceForEntity(target.client, restoredBookId);
				const targetAllTime = yield* waitForReport(target.client, targetReference);
				const targetAllTimeBook = requireMediaConsumptionGroup(targetAllTime, "book");
				expect(targetAllTime.processing).toBe("ready");
				const revisions = yield* executeRyotQLRecipe(
					target.client,
					restoredHistoryRevisionRecipe({ entityId: restoredBookId, reference: targetReference }),
				);
				const sourceRevision = revisions.scope;
				expect(sourceRevision).toBe(0);
				const correction = requirePresent(
					revisions.checkpoint,
					"Restored history correction checkpoint is missing",
				);
				expect(correction).toMatchObject({ phase: "done", sourceRevision });
				expect(correction.requestKey).toMatch(/^event-input-repair-/);
				expect(correction.requestKey).not.toBe(sourceCorrection.requestKey);

				const restoredEvents = yield* historyEventsFor(target.client, restoredBookId);
				const normalizeEvents = (events: typeof sourceEvents) =>
					events.map(({ occurredAt, properties, eventSchemaSlug }) => ({
						occurredAt,
						properties,
						eventSchemaSlug,
					}));
				expect(normalizeEvents(restoredEvents)).toEqual(normalizeEvents(sourceEvents));
				expect(restoredEvents).toHaveLength(sourceEvents.length);
				const unknownDateFact = requirePresent(
					eventFacts[2],
					"Unknown-date completion fact is missing",
				);
				expect(restoredEvents.map(({ properties }) => properties)).toContainEqual(
					unknownDateFact.properties,
				);

				const targetAllTimePages = yield* mediaConsumptionMeasure(targetAllTimeBook, "pages");
				expect(targetAllTimePages).toEqual(sourceAllTimePages);
				expect(targetAllTimeBook.titleCompletions).toBe(2);
				expect(targetAllTime.unknownDate).toBe(1);
				expect(targetAllTime.current.types).toEqual(sourceAllTime.current.types);
				const targetJan2 = yield* waitForReport(
					target.client,
					targetReference,
					onCalendarDay("2026-01-02"),
				);
				const targetJan2Book = requireMediaConsumptionGroup(targetJan2, "book");
				const targetJan2Pages = yield* mediaConsumptionMeasure(targetJan2Book, "pages");
				expect(targetJan2Pages).toEqual(sourceJan2Pages);
				expect(targetJan2.unknownDate).toBe(1);
				expect(targetJan2.current.types).toEqual(sourceJan2.current.types);
			}),
	);
});
