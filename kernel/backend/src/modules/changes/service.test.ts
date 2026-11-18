import { expect } from "bun:test";

import { BunCrypto } from "@effect/platform-bun";
import { DbError } from "@ryot-app/contract/errors";
import {
	ChangeSet,
	type ChangeSetEntityReference,
	ChangeSetEntityUpdate,
} from "@ryot-app/contract/modules/changes/change-set";
import { EntityStale } from "@ryot-app/contract/modules/entities/schemas";
import { EventBadRequest } from "@ryot-app/contract/modules/events/schemas";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationRunId,
	AutomationTriggerId,
	EntityId,
	EntitySchemaSlug,
	IntegrationId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { KERNEL_NAMESPACE } from "@ryot-app/i18n/message";
import { automationInputSchema } from "@ryot-app/plugin-backend-sdk/automation";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { randomUuid } from "@ryot-app/testing/random";
import { makeRecordingTracer } from "@ryot-app/testing/recording-tracer";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { and, eq, inArray } from "drizzle-orm";
import { Context, Deferred, Effect, Fiber, Layer, Ref, Schema, type Tracer } from "effect";

import { EventSchemaReader } from "#modules/definitions/event-schemas";
import notificationDefinition from "#modules/definitions/kernel-scripts/notification.sandbox";
import { Folds } from "#modules/derived-values/service";
import { EntitiesRepository } from "#modules/entities/repository";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { EventMutations } from "#modules/events/mutations";
import { EventsRepository } from "#modules/events/repository";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { PluginCatalogInvalidatorLive } from "#modules/plugins/catalog/events";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import type { NormalizedPlugin } from "#modules/plugins/packages/types";
import { PluginUserSettingsWriter } from "#modules/plugins/preferences/user-settings-writer";
import {
	command,
	relationshipDatabaseLayer,
	userId,
} from "#modules/relationships/lifecycle.test-support";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { ScriptChanges } from "#modules/scripts/executions/script-changes";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { workflowEngineTestLayer } from "#testing/effect";

import { changeSetsLayerWithNotificationSources } from "./change-sets.test-support";
import { ScriptChangesLayer } from "./script-changes";
import { ChangeSets } from "./service";

type StagedWrites = {
	readonly events: number;
	readonly entities: number;
	readonly relationships: number;
};
class AtomicWriteObservation extends Context.Service<
	AtomicWriteObservation,
	{ readonly staged: Effect.Effect<null | StagedWrites> }
>()("@ryot-app/kernel-backend/modules/changes/service.test/AtomicWriteObservation") {}

const testLayer = (failAfterEvents: boolean, notificationSourcesOpen = true) => {
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
		changeSetsLayerWithNotificationSources(notificationSourcesOpen).pipe(
			Layer.provideMerge(
				PluginUserSettingsWriter.layer.pipe(Layer.provide(PluginCatalogInvalidatorLive)),
			),
			Layer.provideMerge(mutations),
			Layer.provideMerge(workflowEngineTestLayer),
		),
		BunCrypto.layerSecureRandom,
	);
};

const commitUserCommand = (payload: {
	readonly input: ChangeSet;
	readonly command: DomainLifecycleCommand;
}) =>
	Effect.flatMap(ChangeSets, (changes) => changes.commit(payload.input, payload.command)).pipe(
		Effect.map(({ events, entityId }) => {
			assert(entityId);
			return { events, entityId };
		}),
	);

const fixture = Effect.fn("AtomicCommandTest.fixture")(function* (
	source: NormalizedPlugin = revisionPackage("atomic", "fixture", "record"),
) {
	const installed = yield* installRevisionPackage(source, userId);
	const session = yield* DatabaseSession;
	const runtime = yield* PluginRuntimeResolver;
	const providerSlug = source.manifest.providers[0]?.slug;
	assert(providerSlug);
	const provider = yield* runtime.findProviderAvailableToUserByReference(userId, {
		slug: providerSlug,
		owner: definitionOwner(installed.pluginId),
	});
	assert(provider);
	const script = yield* runtime.resolveUserDetailsScript(userId, provider.id);
	const accountUserId = yield* (yield* AccountAdmission.make).currentAccount(userId);
	const subject = { userId, type: "user" as const };
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
	const decoded = yield* Schema.decodeEffect(ChangeSet)({
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
		relationships: {
			upserts: [
				{
					properties: {},
					propertiesMode: "merge",
					source: { kind: "root" },
					relationshipSchemaSlug: "atomic-link",
					target: { kind: "existing", entityId: target.id },
				},
			],
		},
	});
	const { entity, events } = decoded;
	const upserts = decoded.relationships?.upserts;
	assert(entity && events && upserts);
	const input = { ...decoded, entity, events, relationships: { upserts } };
	return {
		input,
		session,
		pluginId: installed.pluginId,
		revisionId: installed.revisionId,
		command: { ...command(yield* randomUuid), accountUserId, writeContext: principal },
	};
});

const eventCreate = (entity: ChangeSetEntityReference) => ({
	changes: [],
	creates: [
		{ entity, itemIdentity: "event", eventSchemaSlug: "changed", properties: { value: "Saved" } },
	],
});

layer(testLayer(false))((test) => {
	test.effect(
		"resolves the writer's execution authority once to prepare and once to commit",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const spans: Tracer.Span[] = [];
				yield* commitUserCommand({ input: input.input, command: input.command }).pipe(
					Effect.withTracer(makeRecordingTracer(spans)),
				);
				const within = (span: Tracer.AnySpan, name: string): boolean =>
					span._tag === "Span" &&
					(span.name === name || (span.parent._tag === "Some" && within(span.parent.value, name)));
				const resolves = spans.filter(({ name }) => name === "SandboxExecutionAuthority.resolve");
				expect(resolves).toHaveLength(2);
				expect(
					resolves.map((span) => [
						within(span, "ChangeSets.prepareUserChanges"),
						within(span, "EntitiesService.persistPreparedUserSave"),
					]),
				).toEqual([
					[true, false],
					[false, true],
				]);
				expect(spans.filter(({ name }) => name === "SandboxRepository.getScriptPin")).toHaveLength(
					2,
				);
			}),
		testTimeout,
	);

	test.effect(
		"commits events on existing entities without a root entity and rejects root references",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const [relation] = input.input.relationships.upserts;
				assert(relation?.target.kind === "existing");
				const target = relation.target.entityId;
				const commands = yield* ChangeSets;
				const committed = yield* commands.commit(
					{ events: eventCreate({ kind: "existing", entityId: target }) },
					input.command,
				);
				expect(committed.entityId).toBeUndefined();
				expect(committed.events.map(({ itemIdentity }) => itemIdentity)).toEqual(["event"]);
				const rejected = yield* Effect.flip(
					commands.commit(
						{ events: eventCreate({ kind: "root" }) },
						{
							...input.command,
							...command(yield* randomUuid),
							writeContext: input.command.writeContext,
							accountUserId: input.command.accountUserId,
						},
					),
				);
				expect(rejected).toEqual(new EventBadRequest({ reason: { code: "root-entity-required" } }));
			}),
		testTimeout,
	);

	test.effect(
		"allows event preparation to overlap an atomic subject commit without inverted locks",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const initial = yield* commitUserCommand({ input: input.input, command: input.command });
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
					input: fixtureInput.input,
					command: fixtureInput.command,
				});
				const source = initial.events[0];
				assert(source);
				const execute = (events: ChangeSet["events"]) =>
					commitUserCommand({
						input: { ...fixtureInput.input, events, relationships: {} },
						command: {
							...fixtureInput.command,
							...command(crypto.randomUUID()),
							writeContext: fixtureInput.command.writeContext,
							accountUserId: fixtureInput.command.accountUserId,
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
					const original = yield* commitUserCommand({ input: input.input, command: input.command });
					const source = original.events[0];
					assert(source);
					const nextCommand = () => ({
						...input.command,
						...command(crypto.randomUUID()),
						writeContext: input.command.writeContext,
						accountUserId: input.command.accountUserId,
					});
					let changes: NonNullable<ChangeSet["events"]>["changes"] = [];
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
					const racingInput = yield* Schema.decodeEffect(ChangeSet)({
						...input.input,
						relationships: {},
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
					yield* commitUserCommand({ input: racingInput, command: nextCommand() });
					const staleInput = yield* Schema.decodeEffect(ChangeSet)({
						...input.input,
						relationships: {},
						entity: { ...input.input.entity, name: "Must not commit" },
						events: {
							creates: [],
							changes: [],
							baselines: [{ revision: 1, entityId: original.entityId }],
						},
					});
					assertExitFails(
						yield* Effect.exit(commitUserCommand({ input: staleInput, command: nextCommand() })),
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
					input: matching.input,
					command: matching.command,
				});
				const matchingRelationship = matching.input.relationships.upserts[0];
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
				const matchingInput = yield* Schema.decodeEffect(ChangeSet)({
					...matching.input,
					relationships: {},
					events: { ...matching.input.events, baselines: matchingBaselines },
				});
				const matchingResult = yield* commitUserCommand({
					input: matchingInput,
					command: {
						...matching.command,
						...command(yield* randomUuid),
						writeContext: matching.command.writeContext,
						accountUserId: matching.command.accountUserId,
					},
				});
				expect(matchingResult.events).toHaveLength(1);

				for (const mutatedScope of ["source", "evidence"] as const) {
					const input = yield* fixture();
					const source = yield* commitUserCommand({ input: input.input, command: input.command });
					const relationship = input.input.relationships.upserts[0];
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
					const racingInput = yield* Schema.decodeEffect(ChangeSet)({
						...input.input,
						relationships: {},
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
						input: racingInput,
						command: {
							...input.command,
							...command(yield* randomUuid),
							writeContext: input.command.writeContext,
							accountUserId: input.command.accountUserId,
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
					const staleInput = yield* Schema.decodeEffect(ChangeSet)({
						...input.input,
						events: { ...input.input.events, baselines },
						entity: { ...input.input.entity, name: "Must not commit" },
					});
					assertExitFails(
						yield* Effect.exit(
							commitUserCommand({
								input: staleInput,
								command: {
									...input.command,
									...command(yield* randomUuid),
									writeContext: input.command.writeContext,
									accountUserId: input.command.accountUserId,
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
				const original = yield* commitUserCommand({ input: input.input, command: input.command });
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
						const commandInput = yield* Schema.decodeEffect(ChangeSet)({
							...input.input,
							relationships: {},
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
							input: commandInput,
							command: {
								...input.command,
								...command(yield* randomUuid),
								writeContext: input.command.writeContext,
								accountUserId: input.command.accountUserId,
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
				const result = yield* commitUserCommand({ input: input.input, command: input.command });
				expect(result.events).toHaveLength(1);
				expect(yield* commitUserCommand({ input: input.input, command: input.command })).toEqual(
					result,
				);
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
					yield* Effect.exit(commitUserCommand({ input: input.input, command: input.command })),
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

type Fixture = Effect.Success<ReturnType<typeof fixture>>;

const nextCommand = (input: Fixture, principal = input.command.writeContext) => ({
	...input.command,
	...command(crypto.randomUUID()),
	writeContext: principal,
	accountUserId: input.command.accountUserId,
});

const commit = (input: ChangeSet, lifecycle: DomainLifecycleCommand) =>
	Effect.flatMap(ChangeSets, (changes) => changes.commit(input, lifecycle));

const automationRun = (input: Fixture, overrides: { readonly stage?: "after" | "before" } = {}) => {
	const { pluginRevision } = input.command.writeContext;
	assert(pluginRevision);
	return {
		...input.command.writeContext,
		subject: {
			accountUserId: userId,
			executionUserId: userId,
			pluginId: pluginRevision.id,
			type: "automation-run" as const,
			stage: overrides.stage ?? "after",
			causation: input.command.causation,
			pluginRevisionId: pluginRevision.revisionId,
			pluginConfigRevisionId: pluginRevision.configRevisionId,
			runId: AutomationRunId.make(`run-${crypto.randomUUID()}`),
			triggerId: AutomationTriggerId.make(`trigger-${crypto.randomUUID()}`),
		},
	} satisfies ScriptExecutionPrincipal;
};

const targetOf = (input: Fixture) => {
	const [relation] = input.input.relationships.upserts;
	assert(relation?.target.kind === "existing");
	return relation.target.entityId;
};

const rejection = (part: string) => ({ part, _tag: "ChangeSetRejected" });

const entityBaseline = (input: Fixture, entityId: EntityId) =>
	Effect.gen(function* () {
		const [row] = yield* input.session.run((db) =>
			db
				.select({
					name: tables.entity.name,
					updatedAt: tables.entity.updatedAt,
					properties: tables.entity.properties,
				})
				.from(tables.entity)
				.where(eq(tables.entity.id, entityId)),
		);
		assert(row);
		return { name: row.name, properties: row.properties, updatedAt: row.updatedAt.toISOString() };
	});

const entityUpdates = (
	items: ReadonlyArray<
		readonly [EntityId, Effect.Success<ReturnType<typeof entityBaseline>>, string]
	>,
) =>
	Schema.decodeUnknownEffect(ChangeSet)({
		entities: {
			updates: items.map(([entityId, expected, name]) => ({
				name,
				properties: { name },
				entitySchemaSlug: "record",
				target: { expected, entityId, kind: "update" },
			})),
		},
	});

layer(testLayer(false))((test) => {
	test.effect(
		"commits relationship deletes, entity data clears and entity deletes",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const root = yield* commitUserCommand(input);
				const target = targetOf(input);
				const rowsOf = Effect.gen(function* () {
					return {
						entities: yield* input.session.run((db) =>
							db
								.select({ id: tables.entity.id })
								.from(tables.entity)
								.where(eq(tables.entity.id, root.entityId)),
						),
						events: yield* input.session.run((db) =>
							db
								.select({ id: tables.event.id })
								.from(tables.event)
								.where(eq(tables.event.entityId, root.entityId)),
						),
						relationships: yield* input.session.run((db) =>
							db
								.select({ id: tables.relationship.id })
								.from(tables.relationship)
								.where(eq(tables.relationship.sourceEntityId, root.entityId)),
						),
					};
				});
				expect(yield* rowsOf).toMatchObject({ events: [{}], entities: [{}], relationships: [{}] });
				yield* commit(
					{
						relationships: {
							deletes: [
								{
									relationshipSchemaSlug: "atomic-link",
									target: { kind: "existing", entityId: target },
									source: { kind: "existing", entityId: root.entityId },
								},
							],
						},
					},
					nextCommand(input),
				);
				expect((yield* rowsOf).relationships).toEqual([]);
				yield* commit(
					{ entities: { clears: [{ entityId: root.entityId, entitySchemaSlug: "record" }] } },
					nextCommand(input),
				);
				expect((yield* rowsOf).events).toEqual([]);
				yield* commit(
					{ entities: { deletes: [{ entityId: root.entityId, entitySchemaSlug: "record" }] } },
					nextCommand(input),
				);
				expect(yield* rowsOf).toEqual({ events: [], entities: [], relationships: [] });
			}),
		testTimeout,
	);

	test.effect(
		"merges one entity's data into another",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const root = yield* commitUserCommand(input);
				const target = targetOf(input);
				yield* commit(
					{
						entities: {
							merges: [{ mergeInto: target, mergeFrom: root.entityId, entitySchemaSlug: "record" }],
						},
					},
					nextCommand(input),
				);
				const moved = yield* input.session.run((db) =>
					db
						.select({ entityId: tables.event.entityId })
						.from(tables.event)
						.where(
							inArray(
								tables.event.id,
								root.events.map(({ eventId }) => eventId),
							),
						),
				);
				expect(moved).toEqual([{ entityId: target }]);
			}),
		testTimeout,
	);

	test.effect(
		"updates existing entities against their baselines and fails a stale one as a conflict",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const target = targetOf(input);
				const read = entityBaseline(input, target);
				const original = yield* read;
				yield* commit(yield* entityUpdates([[target, original, "Renamed"]]), nextCommand(input));
				expect(yield* read).toMatchObject({ name: "Renamed", properties: { name: "Renamed" } });
				assertExitFails(
					yield* Effect.exit(
						commit(yield* entityUpdates([[target, original, "Stale"]]), nextCommand(input)),
					),
					new EntityStale({ reason: { entityId: target, code: "entity-stale" } }),
				);
				expect(yield* read).toMatchObject({ name: "Renamed" });
			}),
		testTimeout,
	);

	test.effect(
		"applies entity merges before entity updates",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const root = yield* commitUserCommand(input);
				const target = targetOf(input);
				const read = entityBaseline(input, target);
				const updates = yield* entityUpdates([[target, yield* read, "Merged"]]);
				yield* commit(
					{
						entities: {
							...updates.entities,
							merges: [{ mergeInto: target, mergeFrom: root.entityId, entitySchemaSlug: "record" }],
						},
					},
					nextCommand(input),
				);
				expect(yield* read).toMatchObject({ name: "Merged", properties: { name: "Merged" } });
				const moved = yield* input.session.run((db) =>
					db
						.select({ entityId: tables.event.entityId })
						.from(tables.event)
						.where(
							inArray(
								tables.event.id,
								root.events.map(({ eventId }) => eventId),
							),
						),
				);
				expect(moved).toEqual([{ entityId: target }]);
			}),
		testTimeout,
	);

	test.effect(
		"ensures the bootstrap's entity once and refuses ensures from other scripts",
		() =>
			Effect.gen(function* () {
				const source = revisionPackage("atomic", "fixture", "record");
				const input = yield* fixture({
					...source,
					manifest: {
						...source.manifest,
						userBootstrap: [
							{ slug: "bootstrap", description: "Bootstrap", scriptSlug: "atomic.task" },
						],
					},
				});
				const [task] = yield* input.session.run((db) =>
					db
						.select({ id: tables.sandboxScript.id })
						.from(tables.sandboxScript)
						.where(
							and(
								eq(tables.sandboxScript.slug, "atomic.task"),
								eq(tables.sandboxScript.pluginRevisionId, input.revisionId),
							),
						),
				);
				assert(task);
				const subject = { userId, type: "user" as const };
				const pin = yield* (yield* SandboxRepository.make).getScriptPin(
					SandboxScriptId.make(task.id),
					undefined,
					subject,
				);
				assert(pin?.pluginRevision);
				expect(pin.pluginRevision.userBootstrapScriptSlugs).toEqual(["atomic.task"]);
				const bootstrap = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
				const ensure = {
					entities: {
						ensures: [{ name: "Ensured", properties: { name: "E" }, entitySchemaSlug: "record" }],
					},
				} satisfies ChangeSet;
				expect(yield* Effect.flip(commit(ensure, nextCommand(input)))).toMatchObject(
					rejection("entities.ensures"),
				);
				yield* commit(
					{ entities: { deletes: [{ entityId: targetOf(input), entitySchemaSlug: "record" }] } },
					nextCommand(input),
				);
				yield* commit(ensure, nextCommand(input, bootstrap));
				yield* commit(ensure, nextCommand(input, bootstrap));
				const ensured = yield* input.session.run((db) =>
					db
						.select({ name: tables.entity.name })
						.from(tables.entity)
						.where(eq(tables.entity.entitySchemaPluginId, input.pluginId)),
				);
				expect(ensured).toEqual([{ name: "Ensured" }]);
			}),
		testTimeout,
	);

	test.effect(
		"emits signals and admits notifications from a user automation run",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const run = automationRun(input);
				yield* commit(
					{
						notifications: [{ key: "notification.done" }],
						signals: [{ properties: {}, discriminator: "first", schemaSlug: "atomic.signal" }],
					},
					nextCommand(input, run),
				);
				const signals = yield* input.session.run((db) =>
					db
						.select({ id: tables.automationTrigger.id })
						.from(tables.automationTrigger)
						.where(eq(tables.automationTrigger.category, "signal")),
				);
				expect(signals).toHaveLength(1);
				const notifications = yield* input.session.run((db) =>
					db
						.select({ sourceKey: tables.notification.sourceKey })
						.from(tables.notification)
						.where(eq(tables.notification.userId, userId)),
				);
				expect(notifications).toEqual([
					{ sourceKey: `${run.subject.runId}-changes-0-notification` },
				]);
			}),
		testTimeout,
	);

	test.effect(
		"accepts a user fold request for the writer's own entities",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const root = yield* commitUserCommand(input);
				expect(
					yield* commit(
						{ folds: { scope: "user", entityIds: [root.entityId] } },
						nextCommand(input),
					),
				).toEqual({ events: [] });
			}),
		testTimeout,
	);

	test.effect(
		"rejects every part its writer's principal may not write",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const user = input.command.writeContext;
				assert(user.subject.type === "user" && user.pluginRevision);
				const run = automationRun(input);
				const target = targetOf(input);
				const events = {
					changes: [],
					creates: [
						{
							itemIdentity: "denied",
							eventSchemaSlug: "changed",
							properties: { value: "Denied" },
							entity: { entityId: target, kind: "existing" as const },
						},
					],
				};
				const cases: ReadonlyArray<readonly [ChangeSet, ScriptExecutionPrincipal, string]> = [
					[{ entity: input.input.entity }, run, "entity"],
					[{ settings: { theme: "dark" } }, run, "settings"],
					[
						{ entities: { deletes: [{ entityId: target, entitySchemaSlug: "record" }] } },
						run,
						"entities.deletes",
					],
					[
						yield* entityUpdates([[target, yield* entityBaseline(input, target), "Denied"]]),
						run,
						"entities.updates",
					],
					[
						{ settings: { theme: "dark" } },
						{
							...user,
							subject: { ...user.subject, integrationId: IntegrationId.make("integration") },
						},
						"settings",
					],
					[
						{ signals: [{ properties: {}, discriminator: "d", schemaSlug: "atomic.signal" }] },
						user,
						"signals",
					],
					[{ notifications: [{ key: "notification.done" }] }, user, "notifications"],
					[
						{
							globalEntities: [
								{
									name: "G",
									properties: {},
									externalId: "g",
									populatedAt: null,
									entitySchemaSlug: "record",
								},
							],
						},
						user,
						"globalEntities",
					],
					[
						{
							globalRelationships: [
								{
									relationships: [],
									selector: { type: "self" },
									relationshipSchemaSlug: "atomic-link",
								},
							],
						},
						user,
						"globalRelationships",
					],
					[{ events }, { ...user, subject: { userId, type: "projection" } }, "changes"],
					[{ events }, automationRun(input, { stage: "before" }), "changes"],
					[{ events }, { ...user, subject: { type: "system" } }, "events"],
					[
						{ folds: { scope: "all-users", entityIds: [target] } },
						{ ...user, subject: { type: "system" } },
						"folds",
					],
					[
						{ entities: { deletes: [{ entityId: target, entitySchemaSlug: "undeclared" }] } },
						user,
						"schemas",
					],
				];
				for (const [changes, principal, part] of cases) {
					expect(yield* Effect.flip(commit(changes, nextCommand(input, principal)))).toMatchObject(
						rejection(part),
					);
				}
				const writtenEvents = yield* input.session.run((db) =>
					db
						.select({ id: tables.event.id })
						.from(tables.event)
						.where(eq(tables.event.entityId, target)),
				);
				expect(writtenEvents).toEqual([]);
			}),
		testTimeout,
	);
});

layer(testLayer(false))((test) => {
	test.effect(
		"upserts global entities and the relationships that name them from a system provider script",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const owner = UserId.make("owner");
				yield* session.run((db) =>
					db.insert(tables.user).values({ id: owner, name: "Owner", email: "owner@example.test" }),
				);
				const installed = yield* installRevisionPackage(
					revisionPackage("global", "fixture", "record"),
				);
				const runtime = yield* PluginRuntimeResolver;
				const provider = yield* runtime.findProviderAvailableToUserByReference(owner, {
					slug: "global-provider",
					owner: definitionOwner(installed.pluginId),
				});
				assert(provider);
				const script = yield* runtime.resolveUserDetailsScript(owner, provider.id);
				const subject = { type: "system" as const };
				const pin = yield* (yield* SandboxRepository.make).getScriptPin(
					script.id,
					undefined,
					subject,
				);
				assert(pin?.pluginRevision?.scope === "system" && pin.providerId !== null);
				const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
				const upserted = {
					externalId: "g1",
					kind: "upserted" as const,
					entitySchemaSlug: "record",
				};
				yield* commit(
					{
						globalEntities: [
							{
								name: "Global",
								externalId: "g1",
								populatedAt: null,
								entitySchemaSlug: "record",
								properties: { name: "Global" },
							},
						],
						globalRelationships: [
							{
								selector: { type: "self" },
								relationshipSchemaSlug: "global-link",
								relationships: [{ properties: {}, source: upserted, target: upserted }],
							},
						],
					},
					{ ...command(yield* randomUuid, owner), writeContext: principal },
				);
				const [entity] = yield* session.run((db) =>
					db
						.select()
						.from(tables.entity)
						.where(eq(tables.entity.entitySchemaPluginId, installed.pluginId)),
				);
				expect(entity).toMatchObject({
					userId: null,
					externalId: "g1",
					providerId: pin.providerId,
				});
				assert(entity);
				expect(
					yield* session.run((db) =>
						db
							.select({
								userId: tables.relationship.userId,
								sourceEntityId: tables.relationship.sourceEntityId,
								targetEntityId: tables.relationship.targetEntityId,
							})
							.from(tables.relationship)
							.where(eq(tables.relationship.relationshipSchemaPluginId, installed.pluginId)),
					),
				).toEqual([{ userId: null, sourceEntityId: entity.id, targetEntityId: entity.id }]);
			}),
		testTimeout,
	);
});

layer(testLayer(false, false))((test) => {
	test.effect(
		"writes no event or signal when a later notification admission fails",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const target = targetOf(input);
				assertExitFails(
					yield* Effect.exit(
						commit(
							{
								notifications: [{ key: "notification.done" }],
								signals: [{ properties: {}, discriminator: "late", schemaSlug: "atomic.signal" }],
								events: {
									changes: [],
									creates: [
										{
											itemIdentity: "late",
											eventSchemaSlug: "changed",
											properties: { value: "Late" },
											entity: { kind: "existing", entityId: target },
										},
									],
								},
							},
							nextCommand(input, automationRun(input)),
						),
					),
					new DbError({ message: "Notification source has been cancelled or settled" }),
				);
				expect(
					yield* input.session.run((db) =>
						db
							.select({ id: tables.event.id })
							.from(tables.event)
							.where(eq(tables.event.entityId, target)),
					),
				).toEqual([]);
				expect(
					yield* input.session.run((db) =>
						db
							.select({ id: tables.automationTrigger.id })
							.from(tables.automationTrigger)
							.where(eq(tables.automationTrigger.category, "signal")),
					),
				).toEqual([]);
			}),
		testTimeout,
	);
});

const notificationInput = (executionUserId: UserId) =>
	Schema.decodeEffect(automationInputSchema)({
		automation: {
			executionUserId,
			runId: "run-notification",
			triggerId: "trigger-notification",
			hookSlug: "automation.notification",
			occurredAt: "2026-09-15T00:00:00.000Z",
			causation: {
				depth: 0,
				parentRunId: null,
				lane: "background",
				source: "integration",
				parentTriggerId: null,
				executionId: "execution-notification",
				rootExecutionId: "execution-notification",
				initiator: { kind: "user", id: executionUserId },
			},
			payload: {
				operation: "emit",
				category: "signal",
				resource: "signal",
				signalSchemaPluginId: null,
				actorUserId: executionUserId,
				signalSchemaSlug: "integration.disabled",
				properties: {
					providerName: {
						namespace: KERNEL_NAMESPACE,
						key: "definition.integration-provider.data-json.name",
					},
				},
			},
		},
	});

layer(ScriptChangesLayer.pipe(Layer.provideMerge(testLayer(false))))((test) => {
	test.effect(
		"commits a keyed script execution's changes once and replays its result",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const commitKeyed = Effect.flatMap(ScriptChanges, (scripts) =>
					scripts.commitKeyed({
						lane: "background",
						changes: input.input,
						executionId: "workflow-step-1",
						occurredAt: input.command.occurredAt,
						principal: input.command.writeContext,
					}),
				);
				const first = yield* commitKeyed;
				expect(yield* commitKeyed).toEqual(first);
				assert(first.entityId);
				const events = yield* input.session.run((db) =>
					db
						.select({ id: tables.event.id })
						.from(tables.event)
						.where(eq(tables.event.entityId, first.entityId ?? "")),
				);
				expect(events).toHaveLength(1);
			}),
		testTimeout,
	);

	test.effect(
		"admits the kernel notification script's notifications in the kernel namespace",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const run = automationRun(input);
				const kernelRun = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({
					...run,
					kernelScript: true,
					pluginRevision: null,
					subject: {
						...run.subject,
						pluginId: null,
						pluginRevisionId: null,
						pluginConfigRevisionId: null,
					},
				});
				const result = yield* notificationDefinition.run(yield* notificationInput(userId));
				assert(result.changes);
				yield* commit(result.changes, nextCommand(input, kernelRun));
				const admitted = yield* input.session.run((db) =>
					db
						.select({ request: tables.notification.request })
						.from(tables.notification)
						.where(eq(tables.notification.userId, userId)),
				);
				expect(admitted).toMatchObject([
					{
						request: {
							kind: "message",
							message: { namespace: KERNEL_NAMESPACE, key: "notification.integration-disabled" },
						},
					},
				]);
			}),
		testTimeout,
	);
});

layer(ScriptChangesLayer.pipe(Layer.provideMerge(testLayer(false))))((test) => {
	test.effect(
		"rejects references to another plugin's or user's entities and events as invalid changes",
		() =>
			Effect.gen(function* () {
				const own = yield* fixture();
				const foreign = yield* fixture(revisionPackage("foreign", "fixture", "record"));
				const ownEntity = targetOf(own);
				const foreignEntity = targetOf(foreign);
				const [foreignEvent] = (yield* commit(
					{ events: eventCreate({ kind: "existing", entityId: foreignEntity }) },
					nextCommand(foreign),
				)).events;
				assert(foreignEvent);
				const update = yield* Schema.decodeUnknownEffect(ChangeSetEntityUpdate.fields.target)({
					kind: "update",
					entityId: foreignEntity,
					expected: yield* entityBaseline(foreign, foreignEntity),
				});
				const otherUser = UserId.make(`other-${yield* randomUuid}`);
				yield* own.session.run((db) =>
					db
						.insert(tables.user)
						.values({ id: otherUser, name: "Other", email: `${otherUser}@example.test` }),
				);
				const [otherUserRow] = yield* (yield* EntitiesRepository).insertEntities([
					{
						scope: "user",
						properties: {},
						populatedAt: null,
						userId: otherUser,
						name: "Other user's record",
						entitySchemaPluginId: own.pluginId,
						id: EntityId.make(yield* randomUuid),
						entitySchemaSlug: EntitySchemaSlug.make("record"),
					},
				]);
				assert(otherUserRow);
				const otherUserEntity = otherUserRow.id;
				const attacks: Record<string, readonly [string, string, typeof ChangeSet.Encoded]> = {
					"event entity": [
						"events",
						foreignEntity,
						{ events: eventCreate({ kind: "existing", entityId: foreignEntity }) },
					],
					"another user's entity": [
						"events",
						otherUserEntity,
						{ events: eventCreate({ kind: "existing", entityId: otherUserEntity }) },
					],
					"entity clear": [
						"entities.clears",
						foreignEntity,
						{ entities: { clears: [{ entityId: foreignEntity, entitySchemaSlug: "record" }] } },
					],
					"entity delete": [
						"entities.deletes",
						foreignEntity,
						{ entities: { deletes: [{ entityId: foreignEntity, entitySchemaSlug: "record" }] } },
					],
					"root entity update": [
						"entity",
						foreignEntity,
						{
							entity: {
								name: "Taken",
								target: update,
								entitySchemaSlug: "record",
								properties: { name: "Taken" },
							},
						},
					],
					"entity merge from": [
						"entities.merges",
						foreignEntity,
						{
							entities: {
								merges: [
									{ mergeInto: ownEntity, mergeFrom: foreignEntity, entitySchemaSlug: "record" },
								],
							},
						},
					],
					"entity merge into": [
						"entities.merges",
						foreignEntity,
						{
							entities: {
								merges: [
									{ mergeFrom: ownEntity, mergeInto: foreignEntity, entitySchemaSlug: "record" },
								],
							},
						},
					],
					"event delete": [
						"events",
						foreignEvent.eventId,
						{
							events: {
								creates: [],
								changes: [
									{ kind: "delete", itemIdentity: "event-delete", eventId: foreignEvent.eventId },
								],
							},
						},
					],
					"entity update": [
						"entities.updates",
						foreignEntity,
						{
							entities: {
								updates: [
									{
										name: "Taken",
										target: update,
										entitySchemaSlug: "record",
										properties: { name: "Taken" },
									},
								],
							},
						},
					],
					"relationship delete": [
						"relationships",
						foreignEntity,
						{
							relationships: {
								deletes: [
									{
										relationshipSchemaSlug: "atomic-link",
										source: { kind: "existing", entityId: ownEntity },
										target: { kind: "existing", entityId: foreignEntity },
									},
								],
							},
						},
					],
					"event update": [
						"events",
						foreignEvent.eventId,
						{
							events: {
								creates: [],
								changes: [
									{
										kind: "update",
										itemIdentity: "event-update",
										item: {
											eventId: foreignEvent.eventId,
											patch: { properties: { remove: [], set: { value: "Taken" } } },
										},
									},
								],
							},
						},
					],
					"relationship upsert": [
						"relationships",
						foreignEntity,
						{
							relationships: {
								upserts: [
									{
										properties: {},
										propertiesMode: "merge",
										relationshipSchemaSlug: "atomic-link",
										source: { kind: "existing", entityId: ownEntity },
										target: { kind: "existing", entityId: foreignEntity },
									},
								],
							},
						},
					],
					"event session": [
						"events",
						foreignEntity,
						{
							events: {
								changes: [],
								creates: [
									{
										itemIdentity: "event",
										eventSchemaSlug: "changed",
										properties: { value: "Saved" },
										entity: { kind: "existing", entityId: ownEntity },
										session: { kind: "existing", entityId: foreignEntity },
									},
								],
							},
						},
					],
				};
				const outcomes: Record<string, unknown> = {};
				const expected: Record<string, unknown> = {
					"missing entity": { code: "conflict", conflict: "entity-not-found" },
				};
				const missing = EntityId.make(yield* randomUuid);
				for (const [name, [part, id, attack]] of Object.entries({
					...attacks,
					"missing entity": [
						"events",
						missing,
						{ events: eventCreate({ kind: "existing", entityId: missing }) },
					] as const,
				})) {
					const error = yield* Effect.flip(
						Effect.flatMap(ScriptChanges, (scripts) =>
							Effect.flatMap(Schema.decodeEffect(ChangeSet)(attack), (changes) =>
								scripts.commitKeyed({
									changes,
									lane: "interactive",
									executionId: `foreign-${name}`,
									occurredAt: own.command.occurredAt,
									principal: own.command.writeContext,
								}),
							),
						),
					);
					outcomes[name] = error._tag === "ScriptChangesRejected" ? error.reason : error;
					expected[name] ??= {
						code: "invalid",
						message: `${part}: ${id} belongs to another plugin or user`,
					};
				}
				expect(outcomes).toEqual(expected);
			}),
		testTimeout,
	);
});
