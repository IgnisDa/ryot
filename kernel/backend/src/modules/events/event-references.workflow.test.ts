import { expect } from "bun:test";

import { BunCrypto } from "@effect/platform-bun";
import { EventBadRequest } from "@ryot-app/contract/modules/events/schemas";
import type { AuthoredAppSchema } from "@ryot-app/contract/modules/plugins/manifest-text";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { eq, inArray, sql } from "drizzle-orm";
import { Deferred, Effect, Fiber, Layer } from "effect";

import {
	commitEventChanges,
	createEvents,
	eventDelete,
	eventUpdate,
} from "#modules/changes/change-sets.test-support";
import { ChangeSets } from "#modules/changes/service";
import { Folds } from "#modules/derived-values/service";
import { unfoldedFolds } from "#modules/derived-values/test-support";
import { EntitiesRepository } from "#modules/entities/repository";
import { command } from "#modules/relationships/lifecycle.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import {
	commitChanges,
	eventGroupFixture,
	eventGroupWorkflowLayer,
} from "./event-groups.test-support";
import { EventMutations } from "./mutations";

const noteSchema: AuthoredAppSchema = {
	fields: {
		text: { type: "string", description: "Text", label: { key: "test.text" } },
		about: {
			type: "string",
			label: { key: "test.about" },
			reference: { kind: "event-id" },
			description: "Referenced occurrence",
		},
	},
};

const referenceSchemas = [
	{
		slug: "occurrence",
		name: { key: "test.occurrence" },
		propertiesSchema: {
			fields: { amount: { type: "number", description: "", label: { key: "test.amount" } } },
		},
	},
	{ slug: "note", name: { key: "test.note" }, propertiesSchema: noteSchema },
] as const satisfies ReadonlyArray<{
	slug: string;
	name: { key: string };
	propertiesSchema: AuthoredAppSchema;
}>;

const subjectSchemaSlug = EntitySchemaSlug.make("subject");

const referenceFixture = Effect.fnUntraced(function* (
	declarations?: Parameters<typeof eventGroupFixture>[1],
) {
	const fixture = yield* eventGroupFixture(referenceSchemas, declarations);
	const nextCommand = Effect.map(randomUuid, (id) => ({
		...fixture.command,
		...command(id),
		writeContext: fixture.command.writeContext,
	}));
	const create = Effect.fnUntraced(function* (
		slug: "note" | "occurrence",
		properties: Record<string, unknown>,
		entityId: EntityId = fixture.subjectId,
	) {
		return yield* createEvents({
			userId: fixture.userId,
			command: yield* nextCommand,
			payload: [{ entityId, properties, eventSchemaSlug: EventSchemaSlug.make(slug) }],
		});
	});
	const createId = Effect.fnUntraced(function* (
		slug: "note" | "occurrence",
		properties: Record<string, unknown>,
	) {
		const [outcome] = (yield* create(slug, properties)).outcomes;
		assert(outcome?.status === "written");
		return outcome.eventId;
	});
	const database = yield* DatabaseSession;
	const references = (eventIds: ReadonlyArray<EventId>) =>
		database.run((db) =>
			db
				.select({
					property: tables.eventReference.property,
					referencedEventId: tables.eventReference.referencedEventId,
					referencingEventId: tables.eventReference.referencingEventId,
				})
				.from(tables.eventReference)
				.where(inArray(tables.eventReference.referencingEventId, [...eventIds])),
		);
	const stored = Effect.fnUntraced(function* (eventId: EventId) {
		const [row] = yield* database.run((db) =>
			db
				.select({ revision: tables.event.revision, properties: tables.event.properties })
				.from(tables.event)
				.where(eq(tables.event.id, eventId)),
		);
		return row;
	});
	const insertSubject = Effect.fnUntraced(function* (slug: "session" | "subject") {
		const [entity] = yield* (yield* EntitiesRepository).insertEntities([
			{
				scope: "user",
				name: "Other",
				properties: {},
				populatedAt: null,
				userId: fixture.userId,
				id: EntityId.make(yield* randomUuid),
				entitySchemaSlug: EntitySchemaSlug.make(slug),
				entitySchemaPluginId: fixture.installed.pluginId,
			},
		]);
		assert(entity);
		return entity.id;
	});
	return { ...fixture, create, stored, createId, references, nextCommand, insertSubject };
});

layer(Layer.provideMerge(eventGroupWorkflowLayer, BunCrypto.layerSecureRandom))((test) => {
	test.effect(
		"indexes references with event writes and rejects unavailable targets",
		() =>
			Effect.gen(function* () {
				const fixture = yield* referenceFixture();
				const first = yield* fixture.createId("occurrence", { amount: 1 });
				const second = yield* fixture.createId("occurrence", { amount: 2 });
				const note = yield* fixture.createId("note", { about: first, text: "Thoughts" });
				expect(yield* fixture.references([note])).toEqual([
					{ property: "about", referencedEventId: first, referencingEventId: note },
				]);

				const missing = yield* fixture.create("note", { about: "event-that-does-not-exist" });
				expect(missing.failure?.reason).toEqual({ code: "invalid-properties" });

				const foreignUser = yield* randomUuid;
				const foreign = EventId.make(yield* randomUuid);
				const database = yield* DatabaseSession;
				yield* database.run((db) =>
					db
						.insert(tables.user)
						.values({ id: foreignUser, name: "Other user", email: `${foreignUser}@example.test` }),
				);
				yield* database.run((db) =>
					db
						.insert(tables.event)
						.values({
							id: foreign,
							userId: foreignUser,
							entityId: fixture.subjectId,
							eventSchemaSlug: "occurrence",
							occurredAt: new Date("2026-01-01T00:00:00.000Z"),
						}),
				);
				const rejected = yield* fixture.create("note", { about: foreign });
				expect(rejected.failure?.reason).toEqual({ code: "invalid-properties" });

				const update = (set: Record<string, string>, remove: ReadonlyArray<string>) =>
					Effect.flatMap(fixture.nextCommand, (writeCommand) =>
						commitEventChanges(fixture.userId, writeCommand, [
							eventUpdate({ eventId: note, patch: { properties: { set, remove: [...remove] } } }),
						]),
					);
				yield* update({ about: second }, []);
				expect(yield* fixture.references([note])).toEqual([
					{ property: "about", referencingEventId: note, referencedEventId: second },
				]);
				assertExitFails(
					yield* Effect.exit(update({ about: foreign }, [])),
					new EventBadRequest({ reason: { code: "invalid-properties" } }),
				);
				yield* update({}, ["about"]);
				expect(yield* fixture.references([note])).toEqual([]);
				yield* update({ about: second }, []);
				yield* Effect.flatMap(fixture.nextCommand, (writeCommand) =>
					commitEventChanges(fixture.userId, writeCommand, [eventDelete(note)]),
				);
				expect(yield* fixture.references([note])).toEqual([]);
			}),
		testTimeout,
	);

	test.effect(
		"clears references when the referenced event is deleted directly or in a batch",
		() =>
			Effect.gen(function* () {
				const fixture = yield* referenceFixture();
				const occurrence = yield* fixture.createId("occurrence", { amount: 1 });
				const note = yield* fixture.createId("note", { text: "Kept", about: occurrence });
				const before = yield* fixture.stored(note);
				assert(before);
				yield* commitEventChanges(fixture.userId, yield* fixture.nextCommand, [
					eventDelete(occurrence),
				]);
				expect(yield* fixture.stored(note)).toEqual({
					properties: { text: "Kept" },
					revision: before.revision + 1,
				});
				expect(yield* fixture.references([note])).toEqual([]);

				const batched = yield* fixture.createId("occurrence", { amount: 2 });
				const batchedNote = yield* fixture.createId("note", { text: "Gone", about: batched });
				expect(
					yield* commitEventChanges(fixture.userId, yield* fixture.nextCommand, [
						eventDelete(batched),
						eventDelete(batchedNote),
					]),
				).toHaveLength(2);
				expect(yield* fixture.stored(batchedNote)).toBeUndefined();
			}),
		testTimeout,
	);

	test.effect(
		"clears references to events a fold deletes in the same transaction",
		() =>
			Effect.gen(function* () {
				const fixture = yield* referenceFixture();
				const occurrence = yield* fixture.createId("occurrence", { amount: 1 });
				const note = yield* fixture.createId("note", { text: "Derived", about: occurrence });
				const foldCommand = yield* fixture.nextCommand;
				const mutations = yield* EventMutations.make.pipe(
					Effect.provideService(Folds, {
						...unfoldedFolds,
						settle: (transaction, apply) =>
							apply(transaction, {
								command: foldCommand,
								userId: fixture.userId,
								changes: [{ kind: "delete", eventId: occurrence, itemIdentity: "fold-delete" }],
							}).pipe(Effect.orDie),
					}),
				);
				yield* mutations.transaction(() => Effect.void);
				expect((yield* fixture.stored(note))?.properties).toEqual({ text: "Derived" });
				expect(yield* fixture.stored(occurrence)).toBeUndefined();
			}),
		testTimeout,
	);

	test.effect(
		"clears references from other entities when an entity cascade or data clear deletes events",
		() =>
			Effect.gen(function* () {
				const fixture = yield* referenceFixture();
				const other = yield* fixture.insertSubject("subject");
				const createOn = Effect.fnUntraced(function* (properties: Record<string, unknown>) {
					const [outcome] = (yield* fixture.create("occurrence", properties, other)).outcomes;
					assert(outcome?.status === "written");
					return outcome.eventId;
				});

				const cleared = yield* createOn({ amount: 1 });
				const clearedNote = yield* fixture.createId("note", { about: cleared });
				yield* commitChanges({
					command: yield* fixture.nextCommand,
					input: {
						entities: { clears: [{ entityId: other, entitySchemaSlug: subjectSchemaSlug }] },
					},
				});
				expect((yield* fixture.stored(clearedNote))?.properties).toEqual({});

				const cascaded = yield* createOn({ amount: 2 });
				const cascadedNote = yield* fixture.createId("note", { about: cascaded });
				const deleted = yield* (yield* ChangeSets).commit(
					{
						userId: fixture.userId,
						entities: {
							deletes: [
								{
									entityId: other,
									entitySchema: {
										slug: subjectSchemaSlug,
										owner: definitionOwner(fixture.installed.pluginId),
									},
								},
							],
						},
					},
					yield* fixture.nextCommand,
				);
				expect(deleted.deleted).toEqual([other]);
				expect((yield* fixture.stored(cascadedNote))?.properties).toEqual({});
				expect(yield* fixture.references([clearedNote, cascadedNote])).toEqual([]);
			}),
		testTimeout,
	);
	test.effect(
		"applies a delete and a later update of its referrer in one batch",
		() =>
			Effect.gen(function* () {
				const fixture = yield* referenceFixture();
				const occurrence = yield* fixture.createId("occurrence", { amount: 1 });
				const note = yield* fixture.createId("note", { text: "Draft", about: occurrence });
				const foldCommand = yield* fixture.nextCommand;
				const mutations = yield* EventMutations.make.pipe(
					Effect.provideService(Folds, {
						...unfoldedFolds,
						settle: (transaction, apply) =>
							apply(transaction, {
								command: foldCommand,
								userId: fixture.userId,
								changes: [
									{ kind: "delete", eventId: occurrence, itemIdentity: "fold-delete" },
									{
										kind: "update",
										itemIdentity: "fold-update",
										item: {
											eventId: note,
											patch: { properties: { remove: [], set: { text: "Edited" } } },
										},
									},
								],
							}).pipe(Effect.orDie),
					}),
				);
				yield* mutations.transaction(() => Effect.void);
				expect((yield* fixture.stored(note))?.properties).toEqual({ text: "Edited" });
				expect(yield* fixture.references([note])).toEqual([]);
				expect(yield* fixture.stored(occurrence)).toBeUndefined();
			}),
		testTimeout,
	);

	test.effect(
		"merges an event that references transient evidence the merge resets",
		() =>
			Effect.gen(function* () {
				const fixture = yield* referenceFixture({
					userState: {
						deniedOperations: [],
						evidence: [
							{
								transient: true,
								subjectProperty: "subjectId",
								eventSchema: {
									owner: { kind: "self" },
									slug: EventSchemaSlug.make("trace"),
									entitySchemaSlug: EntitySchemaSlug.make("session"),
								},
							},
						],
					},
					sessionEventSchemas: [
						{
							slug: "trace",
							name: { key: "test.trace" },
							propertiesSchema: {
								fields: {
									subjectId: {
										type: "string",
										description: "Subject",
										label: { key: "test.subject" },
										reference: { kind: "entity-id" },
									},
								},
							},
						},
					],
				});
				const holder = yield* fixture.insertSubject("session");
				const destination = yield* fixture.insertSubject("subject");
				const traced = yield* createEvents({
					userId: fixture.userId,
					command: yield* fixture.nextCommand,
					payload: [
						{
							entityId: holder,
							properties: { subjectId: fixture.subjectId },
							eventSchemaSlug: EventSchemaSlug.make("trace"),
						},
					],
				});
				const [trace] = traced.outcomes;
				assert(trace?.status === "written");
				const note = yield* fixture.createId("note", { text: "Moved", about: trace.eventId });
				yield* commitChanges({
					command: yield* fixture.nextCommand,
					input: {
						entities: {
							merges: [
								{
									mergeInto: destination,
									mergeFrom: fixture.subjectId,
									entitySchemaSlug: subjectSchemaSlug,
								},
							],
						},
					},
				});
				expect(yield* fixture.stored(trace.eventId)).toBeUndefined();
				expect((yield* fixture.stored(note))?.properties).toEqual({ text: "Moved" });
				expect(yield* fixture.references([note])).toEqual([]);
			}),
		testTimeout,
	);

	test.effect(
		"locks a referrer's entity before deleting the event it references",
		() =>
			Effect.gen(function* () {
				const fixture = yield* referenceFixture();
				const other = yield* fixture.insertSubject("subject");
				const [created] = (yield* fixture.create("occurrence", { amount: 1 }, other)).outcomes;
				assert(created?.status === "written");
				const occurrence = created.eventId;
				const note = yield* fixture.createId("note", { text: "Kept", about: occurrence });
				const database = yield* DatabaseSession;
				const locked = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				const referrer = yield* Effect.forkScoped(
					database.transaction(
						Effect.gen(function* () {
							yield* database.run((db) =>
								db.execute(
									sql`select id from entity where id = ${fixture.subjectId} for no key update`,
								),
							);
							yield* Deferred.succeed(locked, undefined);
							yield* Deferred.await(release);
						}),
					),
				);
				yield* Deferred.await(locked);
				const deletion = yield* Effect.forkScoped(
					Effect.flatMap(fixture.nextCommand, (deleteCommand) =>
						commitEventChanges(fixture.userId, deleteCommand, [eventDelete(occurrence)]),
					),
				);
				yield* database
					.run((db) =>
						db.execute<{ waiting: boolean }>(
							sql`select exists(select 1 from pg_locks
								where locktype = 'tuple' and relation = 'entity'::regclass) as waiting`,
							"objects",
						),
					)
					.pipe(Effect.repeat({ until: ([row]) => row?.waiting === true }));
				expect(
					yield* database.run((db) =>
						db.execute<{ id: string }>(
							sql`select id from event where id = ${occurrence} for key share nowait`,
							"objects",
						),
					),
				).toEqual([{ id: occurrence }]);
				yield* Deferred.succeed(release, undefined);
				yield* Fiber.join(referrer);
				yield* Fiber.join(deletion);
				expect((yield* fixture.stored(note))?.properties).toEqual({ text: "Kept" });
			}).pipe(Effect.scoped),
		testTimeout,
	);
});
