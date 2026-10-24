import { expect, layer } from "@effect/vitest";
import { ReminderInvalid } from "@ryot-app/contract/modules/reminders/schemas";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { eq, inArray, sql } from "drizzle-orm";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { assert } from "vitest";

import { AutomationRunRepository } from "#modules/automations/run-repository";
import { AutomationTriggerRepository } from "#modules/automations/trigger-repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntityUserDataGraphRepository } from "#modules/entities/user-data/graph-repository";
import { MutationReceipts } from "#modules/mutations/receipts";
import { NotificationDeliveryRepository } from "#modules/notifications/delivery-repository";
import {
	installRevisionPackage,
	makeRevisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { reminderTestInput } from "#modules/reminders/reminders.test-support";
import { RemindersRepository } from "#modules/reminders/repository";
import { RemindersService } from "#modules/reminders/service";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer } from "#testing/effect";

import { EntityGraphCollector } from "./collector";
import { EntityRetentionRepository } from "./repository";

const testLayer = Layer.mergeAll(EntityGraphCollector.layer, RemindersService.layer).pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			EntityRetentionRepository.layer,
			EntitiesRepository.layer,
			EntityUserDataGraphRepository.layer,
			MutationReceipts.layer,
			RemindersRepository.layer,
			AutomationRunRepository.layer,
			AutomationTriggerRepository.layer,
			NotificationDeliveryRepository.layer,
		),
	),
	Layer.provideMerge(makeRevisionDatabaseLayer(2)),
	Layer.provideMerge(makeAppConfigLayer()),
);

const owner = UserId.make("owner");
const due = new Date("2026-01-01T00:00:00.000Z");
const populated = new Date("2026-01-02T00:00:00.000Z");
const future = new Date("2999-01-01T00:00:00.000Z");

const installGraphPlugin = Effect.fn(function* () {
	const slug = `graph-${crypto.randomUUID().slice(0, 8)}`;
	const plugin = revisionPackage(slug);
	const endpoints = {
		propertiesSchema: { fields: {} },
		sourceEntitySchemaSlug: `${slug}-entity`,
		targetEntitySchemaSlug: `${slug}-entity`,
	};
	const { pluginId } = yield* installRevisionPackage({
		...plugin,
		manifest: {
			...plugin.manifest,
			relationshipSchemas: [
				{ ...endpoints, name: "Part", slug: "part", retention: "composition" },
				{ ...endpoints, name: "Trend", slug: "trend", retention: "root" },
				{ ...endpoints, name: "Credit", slug: "credit" },
			],
		},
	});
	const [provider] = yield* (yield* DatabaseSession).run((db) =>
		db
			.select({ id: tables.sandboxProvider.id })
			.from(tables.sandboxProvider)
			.where(eq(tables.sandboxProvider.pluginId, pluginId)),
	);
	assert(provider);
	const entity = Effect.fn(function* (checkAfter = due) {
		const id = crypto.randomUUID();
		yield* (yield* DatabaseSession).run((db) =>
			db
				.insert(tables.entity)
				.values({
					id,
					name: id,
					checkAfter,
					externalId: id,
					providerId: provider.id,
					relatedPopulatedAt: populated,
					entitySchemaPluginId: pluginId,
					entitySchemaSlug: `${slug}-entity`,
				}),
		);
		return id;
	});
	const link = Effect.fn(function* (
		relationshipSchemaSlug: "part" | "trend" | "credit",
		sourceEntityId: string,
		targetEntityId: string,
		userId: null | UserId = null,
	) {
		yield* (yield* DatabaseSession).run((db) =>
			db
				.insert(tables.relationship)
				.values({
					userId,
					sourceEntityId,
					targetEntityId,
					relationshipSchemaSlug,
					relationshipSchemaPluginId: pluginId,
				}),
		);
	});
	return { link, entity };
});

const stored = Effect.fn(function* (ids: ReadonlyArray<string>) {
	const rows = yield* (yield* DatabaseSession).run((db) =>
		db
			.select({
				id: tables.entity.id,
				checkAfter: tables.entity.checkAfter,
				relatedPopulatedAt: tables.entity.relatedPopulatedAt,
			})
			.from(tables.entity)
			.where(inArray(tables.entity.id, [...ids])),
	);
	return new Map(rows.map((row) => [row.id, row]));
});

const collect = Effect.flatMap(EntityGraphCollector, (collector) => collector.runBatch(500));

layer(testLayer)((test) => {
	test.effect("a reminder creation that holds the target lock wins against graph collection", () =>
		Effect.gen(function* () {
			const input = yield* reminderTestInput();
			const graph = yield* installGraphPlugin();
			const target = EntityId.make(yield* graph.entity());
			const entities = yield* EntitiesRepository;
			const locked = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const service = yield* RemindersService.make.pipe(
				Effect.provideService(EntitiesRepository, {
					...entities,
					lockUserDataReferences: (ids) =>
						Effect.gen(function* () {
							yield* entities.lockUserDataReferences(ids);
							yield* Deferred.succeed(locked, undefined);
							yield* Deferred.await(release);
						}),
				}),
			);
			const creating = yield* service
				.create(input.user, { ...input.body, entityId: target })
				.pipe(Effect.forkChild);
			yield* Deferred.await(locked);
			yield* collect;
			expect((yield* stored([target])).has(target)).toBe(true);
			yield* Deferred.succeed(release, undefined);
			const created = yield* Fiber.join(creating);
			yield* collect;
			expect((yield* stored([target])).has(target)).toBe(true);
			expect(
				yield* (yield* RemindersRepository).findForUser(input.user.id, created.id),
			).toMatchObject({ entityId: target, state: "scheduled" });
		}),
	);
	test.effect(
		"collection that locks first makes a racing reminder creation fail without a dangling schedule",
		() =>
			Effect.gen(function* () {
				const input = yield* reminderTestInput();
				const graph = yield* installGraphPlugin();
				const target = EntityId.make(yield* graph.entity());
				const retention = yield* EntityRetentionRepository;
				const locked = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				const attempted = yield* Deferred.make<void>();
				const collector = yield* EntityGraphCollector.make.pipe(
					Effect.provideService(EntityRetentionRepository, {
						...retention,
						lockMembers: (ids) =>
							Effect.gen(function* () {
								const members = yield* retention.lockMembers(ids);
								yield* Deferred.succeed(locked, undefined);
								yield* Deferred.await(release);
								return members;
							}),
					}),
				);
				const collecting = yield* collector.runBatch(500).pipe(Effect.forkChild);
				yield* Deferred.await(locked);
				const entities = yield* EntitiesRepository;
				const service = yield* RemindersService.make.pipe(
					Effect.provideService(EntitiesRepository, {
						...entities,
						lockUserDataReferences: (ids) =>
							Effect.gen(function* () {
								yield* Deferred.succeed(attempted, undefined);
								yield* entities.lockUserDataReferences(ids);
							}),
					}),
				);
				const creating = yield* service
					.create(input.user, { ...input.body, entityId: target })
					.pipe(Effect.exit, Effect.forkChild);
				yield* Deferred.await(attempted);
				yield* Deferred.succeed(release, undefined);
				yield* Fiber.join(collecting);
				assertExitFails(
					yield* Fiber.join(creating),
					new ReminderInvalid({ reason: "invalid-scope" }),
				);
				expect((yield* stored([target])).has(target)).toBe(false);
				expect(
					yield* (yield* RemindersRepository).listForEntities({
						entityIds: [target],
						userId: input.user.id,
					}),
				).toEqual([]);
			}),
	);
	test.effect("retains reminder-only targets and parent scopes, but not terminal history", () =>
		Effect.gen(function* () {
			const graph = yield* installGraphPlugin();
			const scheduled = yield* graph.entity();
			const needsScheduling = yield* graph.entity();
			const parent = yield* graph.entity();
			const settled = yield* graph.entity();
			const cancelled = yield* graph.entity();
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db.insert(tables.reminder).values([
					{
						userId: owner,
						dueAt: future,
						timezone: "UTC",
						state: "scheduled",
						message: "Pending",
						entityId: scheduled,
						reconcileAt: future,
						entityTitle: "Target",
						parentEntityId: parent,
						id: crypto.randomUUID(),
						accountGeneration: "test-account-generation",
					},
					{
						userId: owner,
						message: "Imported",
						entityTitle: "Target",
						id: crypto.randomUUID(),
						entityId: needsScheduling,
						state: "needs-scheduling",
						accountGeneration: "test-account-generation",
						originalSchedule: {
							dueAt: null,
							timezone: null,
							mayHaveSent: false,
							date: "2026-01-01",
						},
					},
					{
						userId: owner,
						settledAt: due,
						state: "settled",
						entityId: settled,
						outcome: "accepted",
						message: "Completed",
						entityTitle: "Target",
						id: crypto.randomUUID(),
						accountGeneration: "test-account-generation",
					},
					{
						userId: owner,
						settledAt: due,
						state: "cancelled",
						entityId: cancelled,
						message: "Cancelled",
						entityTitle: "Target",
						id: crypto.randomUUID(),
						accountGeneration: "test-account-generation",
					},
				]),
			);
			yield* collect;
			expect(
				new Set((yield* stored([scheduled, needsScheduling, parent, settled, cancelled])).keys()),
			).toEqual(new Set([parent, scheduled, needsScheduling]));
			const history = yield* session.run((db) =>
				db
					.select({ title: tables.reminder.entityTitle, entityId: tables.reminder.entityId })
					.from(tables.reminder)
					.where(inArray(tables.reminder.state, ["settled", "cancelled"])),
			);
			expect(history).toEqual([
				{ entityId: null, title: "Target" },
				{ entityId: null, title: "Target" },
			]);
		}),
	);
	test.effect("collects due unreferenced entities with their dependent rows", () =>
		Effect.gen(function* () {
			const graph = yield* installGraphPlugin();
			const orphan = yield* graph.entity();
			const recent = yield* graph.entity(future);
			yield* (yield* DatabaseSession).run((db) =>
				db
					.insert(tables.entityTranslation)
					.values({ language: "es", entityId: orphan, sourceContentGeneration: 1 }),
			);

			yield* collect;

			const rows = yield* stored([orphan, recent]);
			expect([...rows.keys()]).toEqual([recent]);
			const translations = yield* (yield* DatabaseSession).run((db) =>
				db
					.select()
					.from(tables.entityTranslation)
					.where(eq(tables.entityTranslation.entityId, orphan)),
			);
			expect(translations).toEqual([]);
		}),
	);

	test.effect("defers entities kept by user relationships, events and root relationships", () =>
		Effect.gen(function* () {
			const graph = yield* installGraphPlugin();
			const library = yield* graph.entity();
			const watched = yield* graph.entity();
			const trending = yield* graph.entity();
			const other = yield* graph.entity(future);
			yield* graph.link("credit", library, other, owner);
			yield* graph.link("trend", trending, trending);
			yield* (yield* DatabaseSession).run((db) =>
				db
					.insert(tables.event)
					.values({ userId: owner, occurredAt: due, entityId: watched, eventSchemaSlug: "seen" }),
			);

			yield* collect;

			const rows = yield* stored([library, watched, trending]);
			expect(rows.size).toBe(3);
			for (const row of rows.values()) {
				expect(row.checkAfter.getTime()).toBeGreaterThan(populated.getTime());
			}
		}),
	);

	test.effect("keeps or collects a composition unit as a whole", () =>
		Effect.gen(function* () {
			const graph = yield* installGraphPlugin();
			const keptShow = yield* graph.entity();
			const keptSeason = yield* graph.entity();
			const keptEpisode = yield* graph.entity();
			const lostShow = yield* graph.entity();
			const lostSeason = yield* graph.entity();
			yield* graph.link("part", keptShow, keptSeason);
			yield* graph.link("part", keptSeason, keptEpisode);
			yield* graph.link("part", lostShow, lostSeason);
			yield* (yield* DatabaseSession).run((db) =>
				db
					.insert(tables.event)
					.values({
						userId: owner,
						occurredAt: due,
						entityId: keptEpisode,
						eventSchemaSlug: "seen",
					}),
			);

			yield* collect;

			const rows = yield* stored([keptShow, keptSeason, keptEpisode, lostShow, lostSeason]);
			expect(new Set(rows.keys())).toEqual(new Set([keptShow, keptSeason, keptEpisode]));
		}),
	);

	test.effect("retains one reference hop from a live entity and refreshes trimmed neighbors", () =>
		Effect.gen(function* () {
			const graph = yield* installGraphPlugin();
			const show = yield* graph.entity();
			const person = yield* graph.entity();
			const otherShow = yield* graph.entity();
			const otherSeason = yield* graph.entity();
			yield* graph.link("credit", show, show, owner);
			yield* graph.link("credit", person, show);
			yield* graph.link("credit", person, otherShow);
			yield* graph.link("part", otherShow, otherSeason);

			yield* collect;

			const rows = yield* stored([show, person, otherShow, otherSeason]);
			expect(new Set(rows.keys())).toEqual(new Set([show, person]));
			expect(rows.get(show)?.relatedPopulatedAt).toEqual(populated);
			expect(rows.get(person)?.relatedPopulatedAt).toBeNull();
		}),
	);

	test.effect("typed entity references in user-owned data keep entities", () =>
		Effect.gen(function* () {
			const graph = yield* installGraphPlugin();
			const referenced = yield* graph.entity();
			const slug = `reference-schema-${crypto.randomUUID()}`;
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db
					.insert(tables.definitionEntitySchema)
					.values({
						slug,
						icon: "box",
						position: 0,
						name: "Reference",
						pluginRevisionId: null,
						mergeIdentityProperties: [],
						propertiesSchema: {
							fields: {
								subjects: {
									type: "array",
									label: "Subjects",
									description: "Subjects",
									items: {
										type: "string",
										label: "Subject",
										description: "Subject",
										reference: { kind: "entity-id" },
									},
								},
							},
						},
					}),
			);
			yield* session.run((db) =>
				db
					.insert(tables.entity)
					.values({
						name: "Note",
						userId: owner,
						entitySchemaSlug: slug,
						properties: { subjects: [referenced] },
					}),
			);

			yield* collect;

			expect((yield* stored([referenced])).has(referenced)).toBe(true);
		}),
	);

	test.effect("waits while a backup is running", () =>
		Effect.gen(function* () {
			const graph = yield* installGraphPlugin();
			const orphan = yield* graph.entity();
			const session = yield* DatabaseSession;
			const [backup] = yield* session.run((db) =>
				db
					.insert(tables.backupRun)
					.values({ userId: owner, kind: "export", status: "running" })
					.returning({ id: tables.backupRun.id }),
			);
			assert(backup);

			yield* collect;
			expect((yield* stored([orphan])).has(orphan)).toBe(true);

			yield* session.run((db) =>
				db
					.update(tables.backupRun)
					.set({ status: "completed" })
					.where(eq(tables.backupRun.id, backup.id)),
			);
			yield* collect;
			expect((yield* stored([orphan])).has(orphan)).toBe(false);
		}),
	);

	test.effect("skips an entity a writer holds, then collects it later", () =>
		Effect.gen(function* () {
			const graph = yield* installGraphPlugin();
			const orphan = yield* graph.entity();
			const session = yield* DatabaseSession;
			const locked = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const writer = yield* Effect.forkScoped(
				session.transaction(
					Effect.gen(function* () {
						yield* session.run((db) =>
							db.execute(sql`select id from ${tables.entity} where id = ${orphan} for key share`),
						);
						yield* Deferred.succeed(locked, undefined);
						yield* Deferred.await(release);
					}),
				),
			);
			yield* Deferred.await(locked);

			yield* collect;
			expect((yield* stored([orphan])).has(orphan)).toBe(true);

			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(writer);
			yield* collect;
			expect((yield* stored([orphan])).has(orphan)).toBe(false);
		}),
	);
});
