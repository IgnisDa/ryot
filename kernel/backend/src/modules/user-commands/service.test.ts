import { expect } from "bun:test";

import { BunCrypto } from "@effect/platform-bun";
import { DbError } from "@ryot-app/contract/errors";
import { EntityStale } from "@ryot-app/contract/modules/entities/schemas";
import { UserCommand } from "@ryot-app/contract/modules/mutations/user-command";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntityId, EntitySchemaSlug, type UserId } from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { and, eq, inArray } from "drizzle-orm";
import { Context, Deferred, Effect, Fiber, Layer, Ref, Schema } from "effect";

import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { Folds } from "#modules/derived-values/service";
import { EntitiesRepository } from "#modules/entities/repository";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { EventMutations } from "#modules/events/mutations";
import { EventsRepository } from "#modules/events/repository";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import type { NormalizedPlugin } from "#modules/plugins/packages/types";
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

import { UserCommands } from "./service";

type StagedWrites = {
	readonly events: number;
	readonly entities: number;
	readonly relationships: number;
};
class AtomicWriteObservation extends Context.Service<
	AtomicWriteObservation,
	{ readonly staged: Effect.Effect<null | StagedWrites> }
>()("@ryot-app/kernel-backend/modules/user-commands/service.test/AtomicWriteObservation") {}

const testLayer = (failAfterEvents: boolean) => {
	const live = EventSchemaReader.layer.pipe(Layer.provideMerge(relationshipDatabaseLayer()));
	const mutations = Layer.unwrap(
		Effect.gen(function* () {
			const staged = yield* Ref.make<null | StagedWrites>(null);
			return Layer.merge(
				Layer.effect(
					EventMutations,
					Effect.gen(function* () {
						const original = yield* EventMutations.make;
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
				).pipe(Layer.provide(Folds.layer)),
				Layer.succeed(AtomicWriteObservation, { staged: Ref.get(staged) }),
			);
		}),
	).pipe(Layer.provideMerge(live));
	return Layer.provideMerge(
		UserCommands.layer.pipe(
			Layer.provideMerge(mutations),
			Layer.provideMerge(workflowEngineTestLayer),
		),
		BunCrypto.layerSecureRandom,
	);
};

const commitUserCommand = (payload: {
	readonly userId: UserId;
	readonly input: UserCommand;
	readonly command: DomainLifecycleCommand;
}) =>
	Effect.flatMap(UserCommands, (commands) =>
		commands.commit(payload.input, payload.command, payload.userId),
	);

const fixture = Effect.fn("AtomicCommandTest.fixture")(function* (
	source: NormalizedPlugin = revisionPackage("atomic", "fixture", "record"),
) {
	const installed = yield* installRevisionPackage(source, userId);
	const session = yield* DatabaseSession;
	const runtime = yield* PluginRuntimeResolver;
	const provider = yield* runtime.findProviderAvailableToUserByReference(userId, {
		slug: "atomic-provider",
		owner: definitionOwner(installed.pluginId),
	});
	assert(provider);
	const script = yield* runtime.resolveUserDetailsScript(userId, provider.id);
	const accountGeneration = yield* (yield* AccountAdmission.make).currentAccount(userId);
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
			id: EntityId.make(yield* randomUuid),
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
		revisionId: installed.revisionId,
		command: { ...command(yield* randomUuid), accountGeneration, writeContext: principal },
	};
});

layer(testLayer(false))((test) => {
	test.effect(
		"allows event preparation to overlap an atomic subject commit without inverted locks",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const initial = yield* commitUserCommand({
					userId,
					input: input.input,
					command: input.command,
				});
				const source = initial.events[0];
				assert(source);
				const entities = yield* EntitiesRepository;
				const events = yield* EventsRepository;
				const subjectLocked = yield* Deferred.make<void>();
				const snapshotRead = yield* Deferred.make<void>();
				const commit = yield* Effect.forkScoped(
					input.session.transaction(
						Effect.gen(function* () {
							yield* entities.getMutationEntities([initial.entityId], true);
							yield* Deferred.succeed(subjectLocked, undefined);
							yield* Deferred.await(snapshotRead);
							yield* events.lockEventRows({ userId, eventIds: [source.eventId] });
						}),
					),
				);
				yield* Deferred.await(subjectLocked);
				const prepare = yield* Effect.forkScoped(
					input.session.transaction(
						Effect.gen(function* () {
							const snapshot = yield* events.getEventSnapshot({ userId, eventId: source.eventId });
							assert(snapshot);
							yield* Deferred.succeed(snapshotRead, undefined);
							yield* entities.lockEntityReferencesByIds([initial.entityId]);
							return snapshot.snapshot.properties;
						}),
					),
				);
				yield* Fiber.join(commit);
				expect(yield* Fiber.join(prepare)).toEqual({ value: "Saved" });
			}).pipe(Effect.scoped),
		testTimeout,
	);

	test.effect(
		"retains source order across derived event creation, repair and explicit reset",
		() =>
			Effect.gen(function* () {
				const fixtureInput = yield* fixture();
				const initial = yield* commitUserCommand({
					userId,
					input: fixtureInput.input,
					command: fixtureInput.command,
				});
				const source = initial.events[0];
				assert(source);
				const execute = (events: UserCommand["events"]) =>
					commitUserCommand({
						userId,
						input: { ...fixtureInput.input, events, relationships: [] },
						command: {
							...fixtureInput.command,
							...command(crypto.randomUUID()),
							writeContext: fixtureInput.command.writeContext,
							accountGeneration: fixtureInput.command.accountGeneration,
						},
					});
				const derived = yield* execute({
					changes: [],
					creates: [
						{
							itemIdentity: "derived",
							eventSchemaSlug: "changed",
							properties: { value: "Derived" },
							entity: { kind: "existing", entityId: initial.entityId },
							orderAfter: { suffix: "derived", eventId: source.eventId },
						},
					],
				});
				const output = derived.events[0];
				assert(output);
				const [row] = yield* fixtureInput.session.run((db) =>
					db.select().from(tables.event).where(eq(tables.event.id, output.eventId)),
				);
				const [sourceRow] = yield* fixtureInput.session.run((db) =>
					db.select().from(tables.event).where(eq(tables.event.id, source.eventId)),
				);
				assert(row && sourceRow);
				expect(row.orderKey).toBe(`${source.eventId}~derived`);
				expect(row.orderCreatedAt?.toISOString()).toBe(sourceRow.createdAt.toISOString());
				yield* execute({
					creates: [],
					changes: [
						{
							kind: "update",
							itemIdentity: "repair",
							item: {
								eventId: output.eventId,
								patch: {
									occurredAt: "2026-01-02T00:00:00.000Z",
									orderAfter: { suffix: "repaired", eventId: source.eventId },
								},
							},
						},
					],
				});
				const [repaired] = yield* fixtureInput.session.run((db) =>
					db.select().from(tables.event).where(eq(tables.event.id, output.eventId)),
				);
				expect(repaired?.orderKey).toBe(`${source.eventId}~repaired`);
				yield* execute({
					creates: [],
					changes: [
						{
							kind: "update",
							itemIdentity: "explicit",
							item: { eventId: output.eventId, patch: { orderAfter: null } },
						},
					],
				});
				const [explicit] = yield* fixtureInput.session.run((db) =>
					db.select().from(tables.event).where(eq(tables.event.id, output.eventId)),
				);
				expect(explicit).toMatchObject({
					orderKey: null,
					orderCreatedAt: null,
					createdAt: row.createdAt,
				});
			}),
		testTimeout,
	);

	for (const mutation of ["insert", "update", "delete"] as const) {
		test.effect(
			`rejects an atomic command when its source-event baseline changed by ${mutation}`,
			() =>
				Effect.gen(function* () {
					const input = yield* fixture();
					const original = yield* commitUserCommand({
						userId,
						input: input.input,
						command: input.command,
					});
					const source = original.events[0];
					assert(source);
					const nextCommand = () => ({
						...input.command,
						...command(crypto.randomUUID()),
						writeContext: input.command.writeContext,
						accountGeneration: input.command.accountGeneration,
					});
					let changes: UserCommand["events"]["changes"] = [];
					if (mutation === "update") {
						changes = [
							{
								kind: "update",
								itemIdentity: "corrected",
								item: {
									eventId: source.eventId,
									patch: { properties: { remove: [], set: { value: "Corrected" } } },
								},
							},
						];
					}
					if (mutation === "delete") {
						changes = [{ kind: "delete", itemIdentity: "removed", eventId: source.eventId }];
					}
					const racingInput = yield* Schema.decodeEffect(UserCommand)({
						...input.input,
						relationships: [],
						events: {
							changes,
							creates:
								mutation === "insert"
									? [
											{
												itemIdentity: "inserted",
												eventSchemaSlug: "changed",
												properties: { value: "New" },
												entity: { kind: "existing", entityId: original.entityId },
											},
										]
									: [],
						},
					});
					yield* commitUserCommand({ userId, input: racingInput, command: nextCommand() });
					const staleInput = yield* Schema.decodeEffect(UserCommand)({
						...input.input,
						relationships: [],
						entity: { ...input.input.entity, name: "Must not commit" },
						events: {
							creates: [],
							changes: [],
							baselines: [{ revision: 1, entityId: original.entityId }],
						},
					});
					assertExitFails(
						yield* Effect.exit(
							commitUserCommand({ userId, input: staleInput, command: nextCommand() }),
						),
						new EntityStale({ reason: { code: "entity-stale", entityId: original.entityId } }),
					);
					const partial = yield* input.session.run((db) =>
						db
							.select({ id: tables.entity.id })
							.from(tables.entity)
							.where(
								and(
									eq(tables.entity.entitySchemaPluginId, input.pluginId),
									eq(tables.entity.name, "Must not commit"),
								),
							),
					);
					expect(partial).toEqual([]);
				}),
			testTimeout,
		);
	}

	test.effect(
		"checks source and evidence event baselines together and atomically",
		() =>
			Effect.gen(function* () {
				const matching = yield* fixture();
				const original = yield* commitUserCommand({
					userId,
					input: matching.input,
					command: matching.command,
				});
				const matchingRelationship = matching.input.relationships[0];
				assert(matchingRelationship);
				assert(matchingRelationship.target.kind === "existing");
				const matchingEvidenceId = matchingRelationship.target.entityId;
				const eventRows = yield* EventsRepository;
				const matchingBaselines = [
					{
						entityId: original.entityId,
						revision: yield* eventRows.getScopeRevision({
							userId,
							entityId: original.entityId,
							eventSchemaPluginId: matching.pluginId,
						}),
					},
					{
						entityId: matchingEvidenceId,
						revision: yield* eventRows.getScopeRevision({
							userId,
							entityId: matchingEvidenceId,
							eventSchemaPluginId: matching.pluginId,
						}),
					},
				];
				expect(matchingBaselines[1]?.revision).toBe(0);
				const matchingInput = yield* Schema.decodeEffect(UserCommand)({
					...matching.input,
					relationships: [],
					events: { ...matching.input.events, baselines: matchingBaselines },
				});
				const matchingResult = yield* commitUserCommand({
					userId,
					input: matchingInput,
					command: {
						...matching.command,
						...command(yield* randomUuid),
						writeContext: matching.command.writeContext,
						accountGeneration: matching.command.accountGeneration,
					},
				});
				expect(matchingResult.events).toHaveLength(1);

				for (const mutatedScope of ["source", "evidence"] as const) {
					const input = yield* fixture();
					const source = yield* commitUserCommand({
						userId,
						input: input.input,
						command: input.command,
					});
					const relationship = input.input.relationships[0];
					assert(relationship);
					assert(relationship.target.kind === "existing");
					const evidenceId = relationship.target.entityId;
					const baselines = [
						{
							entityId: source.entityId,
							revision: yield* eventRows.getScopeRevision({
								userId,
								entityId: source.entityId,
								eventSchemaPluginId: input.pluginId,
							}),
						},
						{
							entityId: evidenceId,
							revision: yield* eventRows.getScopeRevision({
								userId,
								entityId: evidenceId,
								eventSchemaPluginId: input.pluginId,
							}),
						},
					];
					expect(baselines[1]?.revision).toBe(0);
					const changedEntityId = mutatedScope === "source" ? source.entityId : evidenceId;
					const racingInput = yield* Schema.decodeEffect(UserCommand)({
						...input.input,
						relationships: [],
						events: {
							changes: [],
							creates: [
								{
									eventSchemaSlug: "changed",
									properties: { value: "Raced" },
									itemIdentity: `racing-${mutatedScope}`,
									entity: { kind: "existing", entityId: changedEntityId },
								},
							],
						},
					});
					yield* commitUserCommand({
						userId,
						input: racingInput,
						command: {
							...input.command,
							...command(yield* randomUuid),
							writeContext: input.command.writeContext,
							accountGeneration: input.command.accountGeneration,
						},
					});

					const sourceEvidenceBefore = yield* input.session.run((db) =>
						db
							.select()
							.from(tables.entity)
							.where(inArray(tables.entity.id, [source.entityId, evidenceId]))
							.orderBy(tables.entity.id),
					);
					const committedBefore = {
						events: yield* input.session.run((db) =>
							db
								.select({ id: tables.event.id })
								.from(tables.event)
								.where(eq(tables.event.eventSchemaPluginId, input.pluginId))
								.orderBy(tables.event.id),
						),
						entities: yield* input.session.run((db) =>
							db
								.select({ id: tables.entity.id })
								.from(tables.entity)
								.where(eq(tables.entity.entitySchemaPluginId, input.pluginId))
								.orderBy(tables.entity.id),
						),
						relationships: yield* input.session.run((db) =>
							db
								.select({ id: tables.relationship.id })
								.from(tables.relationship)
								.where(eq(tables.relationship.relationshipSchemaPluginId, input.pluginId))
								.orderBy(tables.relationship.id),
						),
					};
					const staleInput = yield* Schema.decodeEffect(UserCommand)({
						...input.input,
						events: { ...input.input.events, baselines },
						entity: { ...input.input.entity, name: "Must not commit" },
					});
					assertExitFails(
						yield* Effect.exit(
							commitUserCommand({
								userId,
								input: staleInput,
								command: {
									...input.command,
									...command(yield* randomUuid),
									writeContext: input.command.writeContext,
									accountGeneration: input.command.accountGeneration,
								},
							}),
						),
						new EntityStale({ reason: { code: "entity-stale", entityId: changedEntityId } }),
					);
					const sourceEvidenceAfter = yield* input.session.run((db) =>
						db
							.select()
							.from(tables.entity)
							.where(inArray(tables.entity.id, [source.entityId, evidenceId]))
							.orderBy(tables.entity.id),
					);
					const committedAfter = {
						events: yield* input.session.run((db) =>
							db
								.select({ id: tables.event.id })
								.from(tables.event)
								.where(eq(tables.event.eventSchemaPluginId, input.pluginId))
								.orderBy(tables.event.id),
						),
						entities: yield* input.session.run((db) =>
							db
								.select({ id: tables.entity.id })
								.from(tables.entity)
								.where(eq(tables.entity.entitySchemaPluginId, input.pluginId))
								.orderBy(tables.entity.id),
						),
						relationships: yield* input.session.run((db) =>
							db
								.select({ id: tables.relationship.id })
								.from(tables.relationship)
								.where(eq(tables.relationship.relationshipSchemaPluginId, input.pluginId))
								.orderBy(tables.relationship.id),
						),
					};
					expect(sourceEvidenceAfter).toEqual(sourceEvidenceBefore);
					expect(committedAfter).toEqual(committedBefore);
				}
			}),
		testTimeout,
	);

	test.effect(
		"event-only commands keep entity and data revisions unchanged",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const original = yield* commitUserCommand({
					userId,
					input: input.input,
					command: input.command,
				});
				const [rootBefore] = yield* input.session.run((db) =>
					db
						.select({
							name: tables.entity.name,
							updatedAt: tables.entity.updatedAt,
							properties: tables.entity.properties,
						})
						.from(tables.entity)
						.where(eq(tables.entity.id, original.entityId)),
				);
				assert(rootBefore);
				expect(rootBefore.name).toBe(input.input.entity.name);
				expect(rootBefore.properties).toEqual(input.input.entity.properties);
				const eventRows = yield* EventsRepository;
				const evidenceRevisionBefore = yield* eventRows.getScopeRevision({
					userId,
					entityId: original.entityId,
					eventSchemaPluginId: input.pluginId,
				});
				const executeEventOnly = (itemIdentity: string) =>
					Effect.gen(function* () {
						const commandInput = yield* Schema.decodeEffect(UserCommand)({
							...input.input,
							relationships: [],
							events: {
								changes: [],
								creates: [
									{
										itemIdentity,
										eventSchemaSlug: "changed",
										properties: { value: itemIdentity },
										entity: { kind: "existing", entityId: original.entityId },
									},
								],
							},
							entity: {
								...input.input.entity,
								target: {
									kind: "update",
									entityId: original.entityId,
									expected: {
										name: input.input.entity.name,
										properties: input.input.entity.properties,
										updatedAt: rootBefore.updatedAt.toISOString(),
									},
								},
							},
						});
						return yield* commitUserCommand({
							userId,
							input: commandInput,
							command: {
								...input.command,
								...command(yield* randomUuid),
								writeContext: input.command.writeContext,
								accountGeneration: input.command.accountGeneration,
							},
						});
					});
				const first = yield* executeEventOnly("checkpoint-one");
				const evidenceRevisionAfterFirst = yield* eventRows.getScopeRevision({
					userId,
					entityId: original.entityId,
					eventSchemaPluginId: input.pluginId,
				});
				expect(evidenceRevisionAfterFirst).toBe(evidenceRevisionBefore + 1);
				const second = yield* executeEventOnly("checkpoint-two");
				const evidenceRevisionAfterSecond = yield* eventRows.getScopeRevision({
					userId,
					entityId: original.entityId,
					eventSchemaPluginId: input.pluginId,
				});
				expect(first.events).toHaveLength(1);
				expect(second.events).toHaveLength(1);
				expect(evidenceRevisionAfterSecond).toBe(evidenceRevisionAfterFirst + 1);
				const [rootAfter] = yield* input.session.run((db) =>
					db
						.select({
							name: tables.entity.name,
							updatedAt: tables.entity.updatedAt,
							properties: tables.entity.properties,
						})
						.from(tables.entity)
						.where(eq(tables.entity.id, original.entityId)),
				);
				expect(rootAfter).toEqual(rootBefore);
			}),
		testTimeout,
	);

	test.effect(
		"commits a new entity, relationship, and event together and replays its result",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const result = yield* commitUserCommand({
					userId,
					input: input.input,
					command: input.command,
				});
				expect(result.events).toHaveLength(1);
				expect(
					yield* commitUserCommand({ userId, input: input.input, command: input.command }),
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
		testTimeout,
	);
});

layer(testLayer(true))((test) => {
	test.effect(
		"rolls back every source component and import item after a late commit failure",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				assertExitFails(
					yield* Effect.exit(
						commitUserCommand({ userId, input: input.input, command: input.command }),
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
				expect(entities).toMatchObject([{ name: "Existing target" }]);
				expect(relationships).toEqual([]);
				expect(events).toEqual([]);
			}),
		testTimeout,
	);
});
