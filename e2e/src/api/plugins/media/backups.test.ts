import type { JsonValue } from "@ryot-app/contract/schema/json";
import { anyOf, arrayContaining, objectContaining } from "@ryot-app/testing/matchers";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import {
	exportAndDownloadBackup,
	readBackupSection,
	restoreBackup,
} from "~/fixtures/kernel/backups";
import { getEntity, getGlobalEntityByProvenance } from "~/fixtures/kernel/entities";
import { listEventsForEntity, waitForCreateEvents } from "~/fixtures/kernel/events";
import { deleteUserAndWait } from "~/fixtures/kernel/user-lifecycle";
import { createBuiltinMediaLifecycleFixture } from "~/fixtures/plugins/media/events";
import { settledHistoryCorrection } from "~/fixtures/plugins/media/history-correction";
import { getMediaLibraryEntityId } from "~/fixtures/plugins/media/media";
import { assertCompleted, requirePresent } from "~/support/assertions";
import { expect, it } from "~/support/effect-test";

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
		const result = yield* waitForCreateEvents(
			source.client,
			yield* source.client.call((c) =>
				c.events.create({
					payload: facts.map((properties, index) => ({
						properties,
						entityId: fixture.entityId,
						eventSchemaSlug: fixture.progressEventSchemaSlug,
						occurredAt: requirePresent(occurredAt[index], "Missing source event timestamp"),
					})),
				}),
			),
		);
		expect(result.failure).toBeNull();
		expect(result.outcomes.map(({ status }) => status)).toEqual(["written", "written"]);
		yield* settledHistoryCorrection(source.client, source.userId);
		const sourceEvents = yield* listEventsForEntity(
			source.client,
			fixture.entityId,
			undefined,
			100,
		);
		expect(sourceEvents.map(({ eventSchemaSlug }) => eventSchemaSlug).sort()).toEqual([
			"add-to-media-library",
			"progress",
			"progress",
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
		expect(sourceLibraryEvents.map(({ eventSchemaSlug }) => eventSchemaSlug).sort()).toEqual([
			"completion-occurrence",
			"completion-occurrence",
			"history-correction",
		]);
		const correction = requirePresent(
			sourceLibraryEvents.find(({ eventSchemaSlug }) => eventSchemaSlug === "history-correction"),
			"Source history correction is missing",
		);
		expect(correction.properties).toMatchObject({
			phase: "done",
			subjectEntityId: fixture.entityId,
		});
		const occurrenceFacts = facts.map((fact, index) => ({
			silent: true,
			frozen: false,
			rule: "progress",
			status: "inactive",
			runKey: anyOf(String),
			entityId: fixture.entityId,
			total: index === 0 ? 90 : 0,
			subjectEntityId: fixture.entityId,
			sourceEventId: requirePresent(
				sourceProgressEvents.find(
					({ properties }) => properties["sourceRun"] === fact["sourceRun"],
				),
				"Source progress event is missing",
			).id,
		}));
		expect(
			sourceLibraryEvents
				.filter(({ eventSchemaSlug }) => eventSchemaSlug === "completion-occurrence")
				.map(({ properties }) => properties),
		).toEqual(arrayContaining(occurrenceFacts));
		const { bytes } = yield* exportAndDownloadBackup(source.client);
		const archivedEvents = yield* readBackupSection(bytes, "events.ndjson");
		expect(archivedEvents).toHaveLength(sourceEvents.length + sourceLibraryEvents.length);
		for (const { events, entityId } of [
			{ events: sourceEvents, entityId: fixture.entityId },
			{ entityId: sourceLibraryId, events: sourceLibraryEvents },
		]) {
			for (const event of events) {
				expect(archivedEvents).toContainEqual(
					objectContaining({ ...event, entityId, sessionEntityId: event.sessionEntityId ?? null }),
				);
			}
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
		expect(restoredEvents).toEqual(
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
		expect(restoredLibraryEvents.map(({ eventSchemaSlug }) => eventSchemaSlug).sort()).toEqual([
			"completion-occurrence",
			"completion-occurrence",
			"history-correction",
		]);
		for (const [index, fact] of facts.entries()) {
			const restoredProgress = requirePresent(
				restoredEvents.find(({ properties }) => properties["sourceRun"] === fact["sourceRun"]),
				"Restored progress event is missing",
			);
			expect(
				restoredLibraryEvents.find(
					({ properties }) => properties["sourceEventId"] === restoredProgress.id,
				)?.properties,
			).toEqual({
				...requirePresent(occurrenceFacts[index], "Source occurrence is missing"),
				runKey: anyOf(String),
				entityId: restoredEntity.id,
				subjectEntityId: restoredEntity.id,
				sourceEventId: restoredProgress.id,
			});
		}
		expect((yield* getEntity(target.client, restoredEntity.id)).properties["runtime"]).toBe(120);
	}),
);
