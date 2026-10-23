import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { UserCommand } from "@ryot-app/contract/modules/mutations/user-command";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntityId, EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer, Ref, Schema } from "effect";

import { PolicyBatchWorkflowLive } from "#modules/automations/lifecycle/policy-batch";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventMutations } from "#modules/events/mutations";
import { MutationReceipts } from "#modules/mutations/receipts";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import {
	command,
	relationshipDatabaseLayer,
	userId,
} from "#modules/relationships/lifecycle.test-support";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { workflowEngineTestLayer } from "#testing/effect";

import { UserCommandWorkflow, UserCommandWorkflowDefinitionsLive } from "./workflow";

type StagedWrites = {
	readonly entities: number;
	readonly relationships: number;
	readonly events: number;
};
class AtomicWriteObservation extends Context.Service<
	AtomicWriteObservation,
	{ readonly staged: Effect.Effect<StagedWrites | null> }
>()("test/AtomicWriteObservation") {}

const testLayer = (failAfterEvents: boolean) => {
	const live = EventMutations.layer.pipe(
		Layer.provideMerge(EventSchemaReader.layer),
		Layer.provideMerge(relationshipDatabaseLayer()),
	);
	const mutations = Layer.unwrap(
		Effect.gen(function* () {
			const staged = yield* Ref.make<StagedWrites | null>(null);
			return Layer.merge(
				Layer.effect(
					EventMutations,
					Effect.gen(function* () {
						const original = yield* EventMutations;
						const session = yield* DatabaseSession;
						return EventMutations.of({
							...original,
							persist: Effect.fn("AtomicCommandTest.persist")(function* (
								input: Parameters<EventMutations["Service"]["persist"]>[0],
							) {
								const result = yield* original.persist(input);
								if (!failAfterEvents) {
									return result;
								}
								const rootId = input.prepared.items[0]?.draft.entityId;
								assert(rootId);
								const entities = yield* session.run((db) =>
									db.select().from(tables.entity).where(eq(tables.entity.id, rootId)),
								);
								const relationships = yield* session.run((db) =>
									db
										.select()
										.from(tables.relationship)
										.where(eq(tables.relationship.sourceEntityId, rootId)),
								);
								const events = yield* session.run((db) =>
									db.select().from(tables.event).where(eq(tables.event.entityId, rootId)),
								);
								yield* Ref.set(staged, {
									events: events.length,
									entities: entities.length,
									relationships: relationships.length,
								});
								return yield* new DbError({ message: "Injected atomic commit failure" });
							}),
						});
					}),
				),
				Layer.succeed(AtomicWriteObservation, { staged: Ref.get(staged) }),
			);
		}),
	).pipe(Layer.provideMerge(live));
	return Layer.merge(UserCommandWorkflowDefinitionsLive, PolicyBatchWorkflowLive).pipe(
		Layer.provideMerge(mutations),
		Layer.provideMerge(workflowEngineTestLayer),
	);
};

const fixture = Effect.fn("AtomicCommandTest.fixture")(function* () {
	const installed = yield* installRevisionPackage(
		revisionPackage("atomic", "fixture", "record"),
		userId,
	);
	const session = yield* DatabaseSession;
	const runtime = yield* PluginRuntimeResolver;
	const provider = yield* runtime.findProviderAvailableToUserByReference(userId, {
		slug: "atomic-provider",
		owner: definitionOwner(installed.pluginId),
	});
	assert(provider);
	const script = yield* runtime.resolveUserDetailsScript(userId, provider.id);
	const accountGeneration = yield* (yield* MutationReceipts.make).currentAccount(userId);
	const subject = { userId, accountGeneration, type: "user" as const };
	const pin = yield* (yield* SandboxRepository.make).getScriptPin(script.id, undefined, subject);
	assert(pin?.pluginRevision);
	const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
	const [target] = yield* (yield* EntitiesRepository).insertEntities([
		{
			userId,
			scope: "user",
			properties: {},
			populatedAt: null,
			name: "Existing target",
			id: EntityId.make(crypto.randomUUID()),
			entitySchemaPluginId: installed.pluginId,
			entitySchemaSlug: EntitySchemaSlug.make("record"),
		},
	]);
	assert(target);
	const input = yield* Schema.decodeEffect(UserCommand)({
		entity: {
			name: "Atomic root",
			entitySchemaSlug: "record",
			target: { kind: "create" },
			properties: { name: "Root" },
		},
		events: {
			changes: [],
			creates: [
				{
					itemIdentity: "event",
					entity: { kind: "root" },
					eventSchemaSlug: "changed",
					properties: { value: "Saved" },
				},
			],
		},
		relationships: [
			{
				properties: {},
				propertiesMode: "merge",
				source: { kind: "root" },
				relationshipSchemaSlug: "atomic-link",
				target: { kind: "existing", entityId: target.id },
			},
		],
	});
	return {
		input,
		session,
		pluginId: installed.pluginId,
		command: { ...command(crypto.randomUUID()), accountGeneration, writeContext: principal },
	};
});

layer(testLayer(false))((test) => {
	test.effect("commits a new entity, relationship, and event together and replays its result", () =>
		Effect.gen(function* () {
			const input = yield* fixture();
			const result = yield* UserCommandWorkflow.execute({
				userId,
				input: input.input,
				command: input.command,
			});
			expect(result.events).toHaveLength(1);
			expect(
				yield* UserCommandWorkflow.execute({ userId, input: input.input, command: input.command }),
			).toEqual(result);
			const entities = yield* input.session.run((db) =>
				db.select().from(tables.entity).where(eq(tables.entity.id, result.entityId)),
			);
			const relationships = yield* input.session.run((db) =>
				db
					.select()
					.from(tables.relationship)
					.where(eq(tables.relationship.sourceEntityId, result.entityId)),
			);
			const events = yield* input.session.run((db) =>
				db.select().from(tables.event).where(eq(tables.event.entityId, result.entityId)),
			);
			expect(entities).toMatchObject([{ name: "Atomic root", properties: { name: "Root" } }]);
			expect(relationships).toHaveLength(1);
			expect(events).toMatchObject([
				{ id: result.events[0]?.eventId, properties: { value: "Saved" } },
			]);
		}),
	);
});

layer(testLayer(true))((test) => {
	test.effect(
		"rolls back every source component and item receipt after a late commit failure",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				assertExitFails(
					yield* Effect.exit(
						UserCommandWorkflow.execute({ userId, input: input.input, command: input.command }),
					),
					new DbError({ message: "Injected atomic commit failure" }),
				);
				expect(yield* (yield* AtomicWriteObservation).staged).toEqual({
					events: 1,
					entities: 1,
					relationships: 1,
				});
				const entities = yield* input.session.run((db) =>
					db
						.select()
						.from(tables.entity)
						.where(eq(tables.entity.entitySchemaPluginId, input.pluginId)),
				);
				const relationships = yield* input.session.run((db) =>
					db
						.select()
						.from(tables.relationship)
						.where(eq(tables.relationship.relationshipSchemaPluginId, input.pluginId)),
				);
				const events = yield* input.session.run((db) =>
					db
						.select()
						.from(tables.event)
						.where(eq(tables.event.eventSchemaPluginId, input.pluginId)),
				);
				const receipts = yield* input.session.run((db) =>
					db
						.select()
						.from(tables.mutationReceipt)
						.where(
							and(
								eq(tables.mutationReceipt.receiptType, "item"),
								eq(tables.mutationReceipt.rootExecutionId, input.command.causation.rootExecutionId),
							),
						),
				);
				expect(entities).toMatchObject([{ name: "Existing target" }]);
				expect(relationships).toEqual([]);
				expect(events).toEqual([]);
				expect(receipts).toEqual([]);
			}),
	);
});
