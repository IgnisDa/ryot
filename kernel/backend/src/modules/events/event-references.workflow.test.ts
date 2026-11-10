import { expect } from "bun:test";

import { BunCrypto } from "@effect/platform-bun";
import { EventBadRequest } from "@ryot-app/contract/modules/events/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { eq, inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { Folds } from "#modules/derived-values/service";
import { unfoldedFolds } from "#modules/derived-values/test-support";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EntityUserDataService } from "#modules/entities/user-data/service";
import { command } from "#modules/relationships/lifecycle.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import {
	createGroupEvents,
	eventGroupFixture,
	eventGroupWorkflowLayer,
} from "./event-groups.test-support";
import { EventMutations } from "./mutations";
import { EventsService } from "./service";

const noteSchema: AppSchema = {
	fields: {
		text: { label: "Text", type: "string", description: "Text" },
		about: {
			type: "string",
			label: "About",
			reference: { kind: "event-id" },
			description: "Referenced occurrence",
		},
	},
};

const referenceSchemas = [
	{
		name: "Occurrence",
		slug: "occurrence",
		propertiesSchema: { fields: { amount: { type: "number", label: "Amount", description: "" } } },
	},
	{ slug: "note", name: "Note", propertiesSchema: noteSchema },
] as const satisfies ReadonlyArray<{ slug: string; name: string; propertiesSchema: AppSchema }>;

const subjectSchemaSlug = EntitySchemaSlug.make("subject");

const referenceFixture = Effect.fnUntraced(function* () {
	const fixture = yield* eventGroupFixture(referenceSchemas);
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
		return yield* createGroupEvents({
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
	return { ...fixture, create, stored, createId, references, nextCommand };
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

				const events = yield* EventsService;
				const update = (set: Record<string, string>, remove: ReadonlyArray<string>) =>
					Effect.flatMap(fixture.nextCommand, (writeCommand) =>
						events.edit(
							{ eventId: note, patch: { properties: { set, remove: [...remove] } } },
							fixture.userId,
							writeCommand,
						),
					);
				yield* update({ about: second }, []);
				expect(yield* fixture.references([note])).toEqual([
					{ property: "about", referencingEventId: note, referencedEventId: second },
				]);
				assertExitFails(
					yield* Effect.exit(update({ about: foreign }, [])),
					new EventBadRequest({
						reason: {
							code: "invalid-properties",
							message: "Event property 'about' references an event that does not exist",
						},
					}),
				);
				yield* update({}, ["about"]);
				expect(yield* fixture.references([note])).toEqual([]);
				yield* update({ about: second }, []);
				yield* Effect.flatMap(fixture.nextCommand, (writeCommand) =>
					events.delete({ eventId: note, userId: fixture.userId }, writeCommand),
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
				const events = yield* EventsService;
				yield* events.delete(
					{ eventId: occurrence, userId: fixture.userId },
					yield* fixture.nextCommand,
				);
				expect(yield* fixture.stored(note)).toEqual({
					properties: { text: "Kept" },
					revision: before.revision + 1,
				});
				expect(yield* fixture.references([note])).toEqual([]);

				const batched = yield* fixture.createId("occurrence", { amount: 2 });
				const batchedNote = yield* fixture.createId("note", { text: "Gone", about: batched });
				expect(
					(yield* events.deleteBatch(
						[batched, batchedNote],
						fixture.userId,
						yield* fixture.nextCommand,
					)).count,
				).toBe(2);
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
						within: (work, apply) =>
							Effect.gen(function* () {
								const result = yield* work;
								yield* apply({
									command: foldCommand,
									userId: fixture.userId,
									changes: [{ kind: "delete", eventId: occurrence, itemIdentity: "fold-delete" }],
								}).pipe(Effect.orDie);
								return result;
							}),
					}),
				);
				yield* mutations.transaction(Effect.void);
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
				const entities = yield* EntitiesRepository;
				const [other] = yield* entities.insertEntities([
					{
						scope: "user",
						name: "Other",
						properties: {},
						populatedAt: null,
						userId: fixture.userId,
						entitySchemaSlug: subjectSchemaSlug,
						id: EntityId.make(yield* randomUuid),
						entitySchemaPluginId: fixture.installed.pluginId,
					},
				]);
				assert(other);
				const createOn = Effect.fnUntraced(function* (properties: Record<string, unknown>) {
					const [outcome] = (yield* fixture.create("occurrence", properties, other.id)).outcomes;
					assert(outcome?.status === "written");
					return outcome.eventId;
				});

				const cleared = yield* createOn({ amount: 1 });
				const clearedNote = yield* fixture.createId("note", { about: cleared });
				yield* (yield* EntityUserDataService).clearEntityUserDataForCommand(
					fixture.userId,
					{ entityId: other.id, entitySchemaSlug: subjectSchemaSlug },
					yield* fixture.nextCommand,
				);
				expect((yield* fixture.stored(clearedNote))?.properties).toEqual({});

				const cascaded = yield* createOn({ amount: 2 });
				const cascadedNote = yield* fixture.createId("note", { about: cascaded });
				expect(
					(yield* (yield* EntitiesService).deleteByIds([other.id], yield* fixture.nextCommand))
						.deletedCount,
				).toBe(1);
				expect((yield* fixture.stored(cascadedNote))?.properties).toEqual({});
				expect(yield* fixture.references([clearedNote, cascadedNote])).toEqual([]);
			}),
		testTimeout,
	);
});
