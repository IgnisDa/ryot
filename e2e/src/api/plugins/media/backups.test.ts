import { EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { anyOf, objectContaining } from "@ryot-app/testing/matchers";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import {
	exportAndDownloadBackup,
	readBackupSection,
	restoreBackup,
} from "~/fixtures/kernel/backups";
import { getEntity, getGlobalEntityByProvenance } from "~/fixtures/kernel/entities";
import { listEventsForEntity, waitForEventProjections } from "~/fixtures/kernel/events";
import { pollUntil } from "~/fixtures/kernel/polling";
import { deleteUserAndWait } from "~/fixtures/kernel/user-lifecycle";
import { createBuiltinMediaLifecycleFixture } from "~/fixtures/plugins/media/events";
import { waitForLibrarySummary } from "~/fixtures/plugins/media/library-summary";
import { getMediaLibraryEntityId, insertLibraryMembership } from "~/fixtures/plugins/media/media";
import { assertCompleted, requirePresent } from "~/support/assertions";
import { expect, it } from "~/support/effect-test";

it.live("restores a deleted automatic completion as deleted and keeps a remaining one single", () =>
	Effect.gen(function* () {
		const source = yield* createAuthenticatedClient();
		const target = yield* createAuthenticatedClient();
		const seed = () =>
			Effect.gen(function* () {
				const fixture = yield* createBuiltinMediaLifecycleFixture(source.client, {
					entitySchemaSlug: "movie",
				});
				yield* source.client.call((c) =>
					c.events.create({
						payload: [
							{
								entityId: fixture.entityId,
								properties: { progressPercent: 100 },
								occurredAt: "2026-01-01T12:00:00.000Z",
								eventSchemaSlug: fixture.progressEventSchemaSlug,
							},
						],
					}),
				);
				return yield* getEntity(source.client, fixture.entityId);
			});
		const kept = yield* seed();
		const deleted = yield* seed();
		const completion = requirePresent(
			(yield* listEventsForEntity(source.client, deleted.id, undefined, 100)).find(
				({ eventSchemaSlug }) => eventSchemaSlug === "complete",
			),
			"Missing automatic completion",
		);
		yield* source.client.call((c) => c.events.delete({ params: { eventId: completion.id } }));
		const { bytes } = yield* exportAndDownloadBackup(source.client);
		yield* deleteUserAndWait(source.userId);
		assertCompleted((yield* restoreBackup(target.client, bytes)).run, "Media fold value restore");
		const restoredEvents = (entity: typeof kept) =>
			Effect.gen(function* () {
				const restored = yield* getGlobalEntityByProvenance(target.client, {
					entitySchemaSlug: entity.entitySchemaSlug,
					providerId: requirePresent(entity.providerId, "Missing Media provider"),
					externalId: requirePresent(entity.externalId, "Missing Media external ID"),
				});
				return yield* listEventsForEntity(target.client, restored.id, undefined, 100);
			});
		const completionsOf = (events: Effect.Success<ReturnType<typeof restoredEvents>>) =>
			events.filter(({ eventSchemaSlug }) => eventSchemaSlug === "complete");
		// The restored completion takes its source's new ID as its key once the rebuild folds it.
		yield* pollUntil(
			"restored completion rekeyed",
			Effect.map(restoredEvents(kept), (events) => {
				const progress = events.find(({ eventSchemaSlug }) => eventSchemaSlug === "progress");
				return completionsOf(events).some(
					({ properties }) => properties["completionKey"] === `progress:${progress?.id}`,
				)
					? true
					: null;
			}),
		);
		yield* waitForEventProjections(target.client);
		expect(completionsOf(yield* restoredEvents(kept))).toHaveLength(1);
		expect(completionsOf(yield* restoredEvents(deleted))).toEqual([]);
	}),
);

it.live("retains Media consumption basis, calendar dates, undated progress and source runs", () =>
	Effect.gen(function* () {
		const source = yield* createAuthenticatedClient();
		const target = yield* createAuthenticatedClient();
		const fixture = yield* createBuiltinMediaLifecycleFixture(source.client, {
			entitySchemaSlug: "movie",
			properties: { runtime: 120 },
		});
		const entity = yield* getEntity(source.client, fixture.entityId);
		const facts: ReadonlyArray<Record<string, JsonValue>> = [
			{
				timeSpent: 17,
				progressPercent: 25,
				calendarDate: "2026-02-03",
				sourceRun: `dated-${yield* randomUuid}`,
				consumptionBasis: { total: 90, unit: "minutes", property: "runtime" },
			},
			{
				dateUnknown: true,
				progressPercent: 50,
				sourceRun: `undated-${yield* randomUuid}`,
				consumptionBasis: { unit: "minutes", property: "runtime" },
			},
		];
		const occurredAt = ["2026-02-03T04:05:06.000Z", "2026-02-04T00:00:00.000Z"];
		const result = yield* source.client.call((c) =>
			c.events.create({
				payload: facts.map((properties, index) => ({
					properties,
					entityId: fixture.entityId,
					eventSchemaSlug: fixture.progressEventSchemaSlug,
					occurredAt: requirePresent(occurredAt[index], "Missing source event timestamp"),
				})),
			}),
		);
		expect(result.failure).toBeNull();
		expect(result.outcomes.map(({ status }) => status)).toEqual(["written", "written"]);
		yield* waitForEventProjections(source.client);
		const sourceEvents = yield* listEventsForEntity(
			source.client,
			fixture.entityId,
			undefined,
			100,
		);
		expect(sourceEvents.map(({ eventSchemaSlug }) => eventSchemaSlug).sort()).toEqual([
			EventSchemaSlug.make("add-to-media-library"),
			EventSchemaSlug.make("progress"),
			EventSchemaSlug.make("progress"),
		]);
		const sourceProgressEvents = sourceEvents.filter(
			({ eventSchemaSlug }) => eventSchemaSlug === fixture.progressEventSchemaSlug,
		);
		expect(sourceProgressEvents.map(({ properties }) => properties)).toEqual(facts.toReversed());
		expect(sourceProgressEvents.map((event) => event.occurredAt)).toEqual(occurredAt.toReversed());
		const sourceLibraryId = yield* getMediaLibraryEntityId(source.client);
		const targetLibraryId = yield* getMediaLibraryEntityId(target.client);
		expect(targetLibraryId).not.toBe(sourceLibraryId);
		const sourceLibraryEvents = yield* listEventsForEntity(
			source.client,
			sourceLibraryId,
			undefined,
			100,
		);
		expect(sourceLibraryEvents).toEqual([]);
		const { bytes } = yield* exportAndDownloadBackup(source.client);
		const archivedEvents = yield* readBackupSection(bytes, "events.ndjson");
		expect(archivedEvents).toHaveLength(sourceEvents.length);
		for (const event of sourceEvents) {
			expect(archivedEvents).toContainEqual<unknown>(
				objectContaining({ ...event, sessionEntityId: event.sessionEntityId ?? null }),
			);
		}
		yield* deleteUserAndWait(source.userId);
		assertCompleted((yield* restoreBackup(target.client, bytes)).run, "Media consumption restore");
		const restoredEntity = yield* getGlobalEntityByProvenance(target.client, {
			entitySchemaSlug: entity.entitySchemaSlug,
			providerId: requirePresent(entity.providerId, "Missing Media provider"),
			externalId: requirePresent(entity.externalId, "Missing Media external ID"),
		});
		const restoredEvents = yield* listEventsForEntity(
			target.client,
			restoredEntity.id,
			undefined,
			100,
		);
		expect(restoredEvents).toEqual<unknown>(
			sourceEvents.map(({ properties, occurredAt: at, eventSchemaSlug, sessionEntityId }) => ({
				properties,
				occurredAt: at,
				eventSchemaSlug,
				sessionEntityId,
				id: anyOf(String),
			})),
		);
		const restoredLibraryId = yield* getMediaLibraryEntityId(target.client);
		expect(restoredLibraryId).toBe(targetLibraryId);
		const restoredLibraryEvents = yield* listEventsForEntity(
			target.client,
			restoredLibraryId,
			undefined,
			100,
		);
		expect(restoredLibraryEvents).toEqual([]);
		expect((yield* getEntity(target.client, restoredEntity.id)).properties["runtime"]).toBe(120);
	}),
);

it.live("rebuilds a restored library membership without consumption or review history", () =>
	Effect.gen(function* () {
		const source = yield* createAuthenticatedClient();
		const target = yield* createAuthenticatedClient();
		const fixture = yield* createBuiltinMediaLifecycleFixture(source.client, {
			entitySchemaSlug: "movie",
		});
		const entity = yield* getEntity(source.client, fixture.entityId);
		yield* insertLibraryMembership(source.client, { mediaEntityId: entity.id });
		expect((yield* waitForLibrarySummary(source.client, entity.id)).state).toBe("untracked");
		expect(
			(yield* listEventsForEntity(source.client, entity.id, undefined, 100)).map(
				(event) => event.eventSchemaSlug,
			),
		).toEqual([EventSchemaSlug.make("add-to-media-library")]);
		const { bytes } = yield* exportAndDownloadBackup(source.client);
		yield* deleteUserAndWait(source.userId);
		assertCompleted(
			(yield* restoreBackup(target.client, bytes)).run,
			"Empty library membership restore",
		);
		const restored = yield* getGlobalEntityByProvenance(target.client, {
			entitySchemaSlug: entity.entitySchemaSlug,
			providerId: requirePresent(entity.providerId, "Missing Media provider"),
			externalId: requirePresent(entity.externalId, "Missing Media external ID"),
		});
		expect((yield* waitForLibrarySummary(target.client, restored.id)).state).toBe("untracked");
		expect(
			(yield* listEventsForEntity(target.client, restored.id, undefined, 100)).map(
				(event) => event.eventSchemaSlug,
			),
		).toEqual([EventSchemaSlug.make("add-to-media-library")]);
	}),
);
