import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type {
	AutomationBlockedReason,
	AutomationPolicyOutput,
	AutomationWarning,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import {
	AutomationExecutionId,
	AutomationHookSlug,
	AutomationRunId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { eq, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Redacted, Ref } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";
import { assert, describe } from "vitest";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import {
	AutomationPolicyExecutionError,
	LifecycleExecution,
} from "#lib/domain/lifecycle-execution";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import {
	applyBaselineMigration,
	baselineMigrationStatements,
} from "#lib/test-utils/baseline-migration";
import { testDatabaseUrl } from "#lib/test-utils/database";
import {
	makeAppConfigLayer,
	makeConfigProviderLayer,
	makeWorkflowEngine,
} from "#lib/test-utils/effect";
import {
	withLifecycleBatchPlanning,
	withLifecycleDispatch,
} from "#modules/automations/lifecycle.test-support";
import { AutomationTriggerRepository } from "#modules/automations/trigger-repository";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import {
	buildDefinitionSnapshot,
	type DefinitionSource,
} from "#modules/definition-registry/snapshot";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import { PluginConfigEncryptionKey } from "#modules/plugins/config-encryption-key";
import { PluginConfigRevisions } from "#modules/plugins/config-revisions";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { EntitiesRepository } from "./repository";
import { EntitiesService, type UpdateEntityInput } from "./service";

const owner = UserId.make("owner");
const slug = EntitySchemaSlug.make("record");
const command = (id: string) =>
	rootLifecycleCommand({
		source: "api",
		lane: "interactive",
		itemIdentity: "entity",
		initiator: { id: owner, kind: "user" },
		executionId: AutomationExecutionId.make(id),
		occurredAt: IsoUtcString.make("2026-09-15T00:00:00.000Z"),
		accountGeneration: { userId: owner, token: "test-account-generation" },
	});
const systemCommand = (id: string) =>
	rootLifecycleCommand({
		source: "api",
		lane: "interactive",
		itemIdentity: "entity",
		accountGeneration: null,
		initiator: { id: null, kind: "system" },
		executionId: AutomationExecutionId.make(id),
		occurredAt: IsoUtcString.make("2026-09-15T00:00:00.000Z"),
	});
const createInput = (id: string) => ({
	userId: owner,
	name: " Original ",
	lifecycle: command(id),
	entitySchemaSlug: slug,
	scope: "user" as const,
	properties: { title: "original" },
});
const createEvent = (id: EventId, userId: UserId, entityId: EntityId, sessionEntityId?: EntityId) =>
	Effect.gen(function* () {
		const repository = yield* EventsRepository;
		const session = yield* DatabaseSession;
		return yield* session.transaction(
			repository.createEvent({
				id,
				userId,
				entityId,
				properties: {},
				eventSchemaPluginId: null,
				eventSchemaName: "Progress",
				eventSchemaSlug: EventSchemaSlug.make("progress"),
				occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-09-15T00:00:00.000Z")),
				...(sessionEntityId === undefined ? {} : { sessionEntityId }),
			}),
		);
	});
const warning: AutomationWarning = {
	code: "required-hook-failed",
	runId: AutomationRunId.make("after-run"),
	hookSlug: AutomationHookSlug.make("fixture.after"),
};
type TestOptions = {
	noHooks?: boolean;
	blocked?: boolean;
	blockedRequiredChange?: boolean;
	activateSchemaOnWrite?: boolean;
	deadlockOnce?: boolean;
	lateEventOnDelete?: boolean;
	failChange?: boolean | number;
	warnings?: ReadonlyArray<AutomationWarning>;
	policies?: ReadonlyArray<AutomationPolicyOutput | "fail">;
};

class FakeEntityLifecycle extends Context.Service<
	FakeEntityLifecycle,
	{
		readonly policyCalls: Effect.Effect<ReadonlyArray<string>>;
		readonly skippedPolicyTriggers: Effect.Effect<ReadonlyArray<string>>;
	}
>()("test/FakeEntityLifecycle") {}

const entitiesLayer = (options: TestOptions = {}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const name = `entity_test_${crypto.randomUUID().replaceAll("-", "")}`;
			const changePlans = yield* Ref.make(0);
			const schemaActivated = yield* Ref.make(false);
			const policyCalls = yield* Ref.make<ReadonlyArray<string>>([]);
			const skippedPolicyTriggers = yield* Ref.make<ReadonlyArray<string>>([]);
			const source: DefinitionSource = {
				savedViews: [],
				signalSchemas: [],
				relationshipSchemas: [],
				entitySchemas: [
					{
						slug,
						name: "Record",
						icon: "record",
						pluginSlug: null,
						eventSchemas: [
							{ name: "Progress", slug: "progress", propertiesSchema: { fields: {} } },
						],
						propertiesSchema: {
							fields: {
								title: { type: "string", label: "Title", description: "Title" },
								score: {
									type: "number",
									label: "Score",
									description: "Score",
									normalize: { round: { scale: 2 } },
								},
							},
						},
					},
				],
			};
			const base = Layer.mergeAll(
				PluginRepository.layer,
				PluginInstallationRepository.layer,
				PluginConfigRevisions.layer,
				PluginConfigEncryptionKey.layer,
			);
			const runtime = options.activateSchemaOnWrite
				? Layer.merge(
						Layer.mock(PluginRuntimeResolver)({
							lockCatalog: () => Ref.set(schemaActivated, true),
						}),
						Layer.mock(DefinitionRepository)({
							findUserEntitySchemas: () => {
								const definition = buildDefinitionSnapshot(source).entitySchemas[slug];
								assert(definition);
								return Effect.map(Ref.get(schemaActivated), (activated) => ({
									[slug]: activated
										? {
												...definition,
												propertiesSchema: {
													fields: {
														...definition.propertiesSchema.fields,
														activated: {
															label: "Activated",
															type: "boolean" as const,
															description: "Activated",
														},
													},
												},
											}
										: definition,
								}));
							},
						}),
					)
				: Layer.merge(
						PluginRuntimeResolver.layer.pipe(Layer.provide(base)),
						DefinitionRepository.layer,
					);
			const repositories = Layer.mergeAll(
				EntitiesRepository.layer.pipe(Layer.provide(Layer.merge(base, runtime))),
				EventsRepository.layer,
				EventSchemasRepository.layer.pipe(Layer.provide(runtime)),
				AutomationTriggerRepository.layer,
			);
			const ports = Layer.effect(
				LifecyclePlanner,
				Effect.gen(function* () {
					const triggers = yield* AutomationTriggerRepository;
					const session = yield* DatabaseSession;
					const eventRepository = yield* EventsRepository;
					return LifecyclePlanner.of(
						withLifecycleBatchPlanning(
							{
								plan: ({ trigger }) =>
									Effect.gen(function* () {
										expect(yield* session.isTransactionActive).toBe(true);
										if (options.noHooks) {
											return {
												trigger: null,
												runs: [] as const,
												policies: [] as const,
												_tag: "NoHooks" as const,
												wasCreated: false as const,
											};
										}
										let blockedReason: AutomationBlockedReason | null = null;
										if (trigger.kind.category === "request" && options.blocked) {
											blockedReason = {
												omittedHooks: [],
												hasRequiredHooks: false,
												code: "automation-limit-reached",
											};
										} else if (
											trigger.kind.category === "change" &&
											options.blockedRequiredChange
										) {
											blockedReason = {
												omittedHooks: [],
												hasRequiredHooks: true,
												code: "automation-limit-reached",
											};
										}
										const persisted = yield* triggers.insert({ ...trigger, blockedReason });
										if (
											options.lateEventOnDelete &&
											trigger.scopeUserId !== null &&
											trigger.payload?.resource === "event" &&
											trigger.payload.category === "request" &&
											trigger.payload.operation === "delete"
										) {
											const before = trigger.payload.draft;
											yield* eventRepository.createEvent({
												entityId: before.entityId,
												eventSchemaPluginId: null,
												userId: trigger.scopeUserId,
												eventSchemaName: "Progress",
												properties: before.properties,
												id: EventId.make("late-cascade-event"),
												eventSchemaSlug: before.eventSchemaSlug,
												occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(before.occurredAt)),
												...(before.sessionEntityId === null
													? {}
													: { sessionEntityId: before.sessionEntityId }),
											});
										}
										const changePlanCount =
											trigger.kind.category === "change"
												? yield* Ref.updateAndGet(changePlans, (count) => count + 1)
												: yield* Ref.get(changePlans);
										if (
											trigger.kind.category === "change" &&
											options.deadlockOnce &&
											changePlanCount === 1
										) {
											return yield* new DbError({
												code: "40P01",
												message: "Injected deadlock after insert",
											});
										}
										if (
											trigger.kind.category === "change" &&
											(options.failChange === true || options.failChange === changePlanCount)
										) {
											return yield* new DbError({
												message: "Injected planning failure after insert",
											});
										}
										return {
											runs: [],
											wasCreated: true,
											trigger: persisted,
											policies:
												trigger.kind.category === "request"
													? (options.policies ?? []).map((_, index) => ({
															position: index,
															runId: AutomationRunId.make(`policy-${index}`),
														}))
													: [],
										};
									}),
							},
							200,
							!options.noHooks,
						),
					);
				}),
			).pipe(Layer.provide(repositories));
			const execution = Layer.effect(
				LifecycleExecution,
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					return withLifecycleDispatch(
						{
							skipQueuedPolicies: ({ triggerId }) =>
								Ref.update(skippedPolicyTriggers, (all) => [...all, triggerId]),
							after: ({ triggerId }) =>
								Effect.gen(function* () {
									expect(yield* session.isTransactionActive).toBe(false);
									const [trigger] = yield* session.run((db) =>
										db
											.select()
											.from(tables.automationTrigger)
											.where(eq(tables.automationTrigger.id, triggerId)),
									);
									assert(trigger);
									expect(trigger.category).toBe("change");
									return options.warnings ?? [];
								}).pipe(Effect.mapError((error) => new DbError({ message: String(error) }))),
							executePolicy: ({ runId, acceptedPatches }) =>
								Effect.gen(function* () {
									yield* Ref.update(policyCalls, (all) => [...all, runId]);
									expect(yield* session.isTransactionActive).toBe(false);
									const requests = yield* session
										.run((db) =>
											db
												.select()
												.from(tables.automationTrigger)
												.where(eq(tables.automationTrigger.category, "request")),
										)
										.pipe(Effect.orDie);
									expect(requests.length).toBeGreaterThan(0);
									const index = Number(runId.split("-")[1]);
									if (index === 1) {
										expect(acceptedPatches).toEqual([
											{
												resource: "entity",
												draft: {
													name: "First",
													properties: { remove: [], set: { title: "first" } },
												},
											},
										]);
									}
									const output = options.policies?.[index];
									assert(output);
									if (output === "fail") {
										return yield* new AutomationPolicyExecutionError({
											runId,
											code: "policy-execution-failed",
										});
									}
									return output;
								}),
						},
						session,
					);
				}),
			);
			const eventsService = EventsService.layer.pipe(
				Layer.provide(
					Layer.mergeAll(
						repositories,
						ports,
						execution,
						Layer.succeed(
							WorkflowEngine,
							makeWorkflowEngine({
								activityExecute: (activity) =>
									Effect.map(
										Effect.exit(activity.execute),
										(exit) => new Workflow.Complete({ exit }),
									),
							}),
						),
					),
				),
			);
			const services = Layer.mergeAll(
				repositories,
				EntitiesService.layer.pipe(
					Layer.provide(Layer.mergeAll(repositories, ports, execution, eventsService)),
				),
			).pipe(
				Layer.provideMerge(DatabaseSession.layer),
				Layer.provide(
					makeAppConfigLayer({ database: { poolMax: 1, url: Redacted.make(testDatabaseUrl()) } }),
				),
			);
			const schema = Layer.effectDiscard(
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const statements = yield* baselineMigrationStatements();
					yield* Effect.acquireRelease(
						session.run((db) => db.execute(sql`create schema ${sql.identifier(name)}`)),
						() =>
							session
								.run((db) => db.execute(sql`drop schema ${sql.identifier(name)} cascade`))
								.pipe(Effect.orDie),
					);
					yield* session.run((db) =>
						Effect.gen(function* () {
							yield* db.execute(sql`set search_path to ${sql.identifier(name)}, public`);
							yield* applyBaselineMigration(statements, (statement) =>
								db.execute(sql.raw(statement)),
							);
						}),
					);
					yield* (yield* DefinitionRepository.make).replaceKernelDefinitions(source);
					yield* session.run((db) =>
						db
							.insert(tables.user)
							.values({
								id: owner,
								name: "Owner",
								email: "owner@example.test",
								accountGeneration: "test-account-generation",
							}),
					);
				}),
			);
			return Layer.mergeAll(
				schema,
				Layer.succeed(FakeEntityLifecycle, {
					policyCalls: Ref.get(policyCalls),
					skippedPolicyTriggers: Ref.get(skippedPolicyTriggers),
				}),
			).pipe(Layer.provideMerge(services), Layer.provideMerge(makeConfigProviderLayer()));
		}),
	);

const proposal = (name: string, properties: { title: string }) => ({
	action: "transform" as const,
	patch: {
		resource: "entity" as const,
		draft: { name, properties: { remove: [], set: properties } },
	},
});

describe("EntitiesService committed lifecycle", () => {
	layer(entitiesLayer({ noHooks: true }))((test) => {
		test.effect("replays a no-hook create after source deletion without new history", () =>
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const session = yield* DatabaseSession;
				const input = createInput("no-hook-replay");
				const first = yield* service.create(input);
				expect(first.warnings).toEqual([]);
				expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual([]);
				const receipts = yield* session.run((db) => db.select().from(tables.mutationReceipt));
				expect(receipts.filter(({ receiptType }) => receiptType === "item")).toHaveLength(1);
				expect(receipts.every(({ evidence }) => evidence === null)).toBe(true);
				yield* session.run((db) =>
					db.delete(tables.entity).where(eq(tables.entity.id, first.entity.id)),
				);
				expect(yield* service.create(input)).toEqual(first);
				expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
				expect(
					yield* service.create({ ...input, name: "Different" }).pipe(Effect.flip),
				).toMatchObject({ reason: { code: "mutation-conflict" } });
				expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual([]);
			}),
		);
	});
	layer(entitiesLayer())((test) => {
		test.effect(
			"normalizes numeric properties before persisting the entity and change snapshot",
			() =>
				Effect.gen(function* () {
					const service = yield* EntitiesService;
					const session = yield* DatabaseSession;
					const result = yield* service.create({
						...createInput("normalized"),
						properties: { score: 25.555, title: "numeric" },
					});
					expect(result.entity.properties).toEqual({ score: 25.56, title: "numeric" });
					const changes = (yield* session.run((db) =>
						db.select().from(tables.automationTrigger),
					)).find((row) => row.category === "change");
					expect(changes?.payload).toMatchObject({
						after: { properties: { score: 25.56, title: "numeric" } },
					});
				}),
		);
	});

	layer(entitiesLayer({ blockedRequiredChange: true }))((test) => {
		test.effect(
			"returns blocked required-hook warnings for normal create, update, and delete",
			() =>
				Effect.gen(function* () {
					const service = yield* EntitiesService;
					const blocked = expect.objectContaining({
						hasRequiredHooks: true,
						code: "automation-limit-reached",
					});
					const created = yield* service.create(createInput("limited-create"));
					expect(created.warnings).toEqual([blocked, blocked]);
					const updated = yield* service.update({
						userId: owner,
						scope: "user",
						name: "Updated",
						populatedAt: null,
						entityId: created.entity.id,
						properties: { title: "updated" },
						lifecycle: command("limited-update"),
					});
					expect(updated.warnings).toEqual([blocked, blocked]);
					const deleted = yield* service.deleteByIds(
						[created.entity.id],
						command("limited-delete"),
					);
					expect(deleted.warnings).toEqual([blocked, blocked]);
				}),
		);
	});

	layer(entitiesLayer())((test) => {
		test.effect(
			"replays exact create, update and noop results after newer writes and deletion",
			() =>
				Effect.gen(function* () {
					const service = yield* EntitiesService;
					const session = yield* DatabaseSession;
					const original = createInput("snapshot-create");
					const created = yield* service.prepareCreateStep(original);
					assert(created._tag === "Committed");
					const input = {
						userId: owner,
						name: "Updated",
						populatedAt: null,
						scope: "user" as const,
						properties: { title: "updated" },
						entityId: created.result.entity.id,
						lifecycle: command("snapshot-update"),
					} satisfies UpdateEntityInput;
					const updated = yield* service.update(input);
					const noopInput = { ...input, lifecycle: command("snapshot-noop") };
					const noop = yield* service.update(noopInput);
					expect(noop).toEqual({ warnings: [], entity: updated.entity });
					const receipts = yield* session.run((db) => db.select().from(tables.mutationReceipt));
					const updateReceipt = receipts.find(
						(row) =>
							row.executionId === input.lifecycle.causation.executionId &&
							row.commandKind === "entity:update",
					);
					const noopReceipt = receipts.find(
						(row) =>
							row.executionId === noopInput.lifecycle.causation.executionId &&
							row.commandKind === "entity:update",
					);
					assert(updateReceipt && noopReceipt);
					expect(updateReceipt.result).toEqual({ entity: updated.entity });
					expect(noopReceipt.result).toEqual({ entity: noop.entity });
					expect(noopReceipt.dispatch).toEqual([]);
					yield* service.update({
						...input,
						name: "Newest",
						properties: { title: "newest" },
						lifecycle: command("snapshot-newest"),
					});
					expect(yield* service.prepareCreateStep(original)).toEqual(created);
					expect(yield* service.update(input)).toEqual(updated);
					expect(yield* service.update(noopInput)).toEqual(noop);
					const deleteCommand = command("snapshot-delete");
					const deleted = yield* service.deleteByIds([input.entityId], deleteCommand);
					const deleteReceipts = yield* session.run((db) =>
						db
							.select()
							.from(tables.mutationReceipt)
							.where(eq(tables.mutationReceipt.executionId, deleteCommand.causation.executionId)),
					);
					const itemReceipt = deleteReceipts.find((row) => row.commandKind === "entity:delete");
					assert(itemReceipt);
					expect(itemReceipt.result).toBeNull();
					// Force item-receipt recovery rather than the aggregate replay shortcut.
					yield* session.run((db) =>
						db
							.delete(tables.mutationReceipt)
							.where(eq(tables.mutationReceipt.commandKind, "entity:delete-batch")),
					);
					expect(yield* service.deleteByIds([input.entityId], deleteCommand)).toEqual(deleted);
					const beforeReplay = yield* session.run((db) => db.select().from(tables.mutationReceipt));
					expect(yield* service.prepareCreateStep(original)).toEqual(created);
					expect(yield* service.update(input)).toEqual(updated);
					expect(yield* service.update(noopInput)).toEqual(noop);
					expect(yield* session.run((db) => db.select().from(tables.mutationReceipt))).toEqual(
						beforeReplay,
					);
					expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
					expect(
						(yield* session.run((db) =>
							db
								.select()
								.from(tables.mutationReceipt)
								.where(eq(tables.mutationReceipt.id, updateReceipt.id)),
						))[0]?.dispatch,
					).toEqual(updateReceipt.dispatch);
				}),
		);
		test.effect("commits in prepare without policies and after policies with the same rows", () =>
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const session = yield* DatabaseSession;
				const fast = yield* service.prepareCreateStep(createInput("step-fast"));
				assert(fast._tag === "Committed");
				expect(fast.result.entity.name).toBe("Original");
				expect(fast.dispatch.map(({ triggerId }) => typeof triggerId)).toEqual([
					"string",
					"string",
				]);
				const replay = yield* service.prepareCreateStep(createInput("step-fast"));
				assert(replay._tag === "Committed");
				expect(replay.result.entity.id).toBe(fast.result.entity.id);
				expect(
					(yield* session.run((db) => db.select().from(tables.entity))).map(({ id }) => id),
				).toEqual([fast.result.entity.id]);
			}),
		);
	});

	layer(entitiesLayer({ policies: [{ action: "allow" }] }))((test) => {
		test.effect("runs prepared policies outside the commit and keeps the recorded rows", () =>
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const session = yield* DatabaseSession;
				const prepared = yield* service.prepareCreateStep(createInput("step-policies"));
				assert(prepared._tag === "PoliciesRequired");
				expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
				const accepted = yield* service.applyMutationPolicies(prepared.pending);
				const committed = yield* service.commitMutation(accepted);
				expect(committed.result.entity.name).toBe("Original");
				expect(
					(yield* session.run((db) => db.select().from(tables.entity))).map(({ name }) => name),
				).toEqual(["Original"]);
				expect(
					(yield* session.run((db) => db.select().from(tables.automationTrigger))).map(
						({ category }) => category,
					),
				).toEqual(["request", "change", "change"]);
				expect(committed.dispatch).toHaveLength(2);
			}),
		);
	});

	layer(entitiesLayer({ activateSchemaOnWrite: true }))((test) => {
		test.effect("revalidates the entity schema under the catalog lock before writing", () =>
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const session = yield* DatabaseSession;
				expect(yield* service.create(createInput("schema-race")).pipe(Effect.flip)).toMatchObject({
					reason: { code: "mutation-conflict" },
				});
				expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
			}),
		);
	});

	layer(entitiesLayer())((test) => {
		test.effect(
			"rejects invalid names, missing schemas, incomplete provenance and invalid bulk limits before planning",
			() =>
				Effect.gen(function* () {
					const service = yield* EntitiesService;
					const session = yield* DatabaseSession;
					expect(
						yield* service.create({ ...createInput("name"), name: "   " }).pipe(Effect.flip),
					).toMatchObject({ reason: { code: "name-required" } });
					expect(
						yield* service
							.create({
								...createInput("missing"),
								entitySchemaSlug: EntitySchemaSlug.make("missing"),
							})
							.pipe(Effect.flip),
					).toMatchObject({ reason: { code: "entity-schema-not-found" } });
					expect(
						yield* service
							.create({ ...createInput("provenance"), externalId: "incomplete" })
							.pipe(Effect.flip),
					).toMatchObject({ reason: { code: "incomplete-provenance" } });
					expect(
						yield* service
							.upsertGlobalEntities([], providerId, command("limit"), { maximumTotal: -1 })
							.pipe(Effect.flip),
					).toMatchObject({ reason: { code: "invalid-maximum-total" } });
					expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual(
						[],
					);
				}),
		);
	});
	layer(entitiesLayer({ failChange: 2 }))((test) => {
		test.effect("rolls all bulk rows and change plans back when the second plan fails", () =>
			Effect.gen(function* () {
				yield* seedProvider;
				const service = yield* EntitiesService;
				const session = yield* DatabaseSession;
				const items = ["one", "two"].map((externalId) => ({
					externalId,
					name: externalId,
					populatedAt: null,
					entitySchemaSlug: slug,
					properties: { title: externalId },
				}));
				expect(
					yield* service
						.upsertGlobalEntities(items, providerId, command("bulk-rollback"))
						.pipe(Effect.flip),
				).toMatchObject({ _tag: "DbError" });
				expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
				expect(
					(yield* session.run((db) => db.select().from(tables.automationTrigger))).map(
						(row) => row.category,
					),
				).toEqual(["request", "request"]);
			}),
		);
	});
	layer(entitiesLayer({ failChange: 3 }))((test) => {
		test.effect("rolls a delete back with its change plan", () =>
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const session = yield* DatabaseSession;
				const created = yield* service.create(createInput("before-delete"));
				expect(
					yield* service
						.deleteByIds([created.entity.id], command("delete-rollback"))
						.pipe(Effect.flip),
				).toMatchObject({ _tag: "DbError" });
				expect(yield* service.getByIdAnyScope(created.entity.id)).toEqual(created.entity);
				expect(
					(yield* session.run((db) => db.select().from(tables.automationTrigger)))
						.filter((row) => row.category === "change")
						.map((row) => row.operation),
				).toEqual(["create", "batch"]);
			}),
		);
	});

	layer(entitiesLayer())((test) => {
		test.effect("deletes workout-session events with item and batch lifecycle plans", () =>
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const events = yield* EventsRepository;
				const session = yield* DatabaseSession;
				const workoutSession = yield* service.create({
					...createInput("workout-session-cascade"),
					name: "Workout Session",
				});
				const workout = yield* service.create({
					...createInput("workout-set-cascade"),
					name: "Workout Set",
				});
				const eventIds = [EventId.make("workout-event-1"), EventId.make("workout-event-2")];
				for (const eventId of eventIds) {
					yield* createEvent(eventId, owner, workout.entity.id, workoutSession.entity.id);
				}
				const lifecycle = command("workout-session-delete");
				const deleted = yield* service.deleteByIds([workoutSession.entity.id], lifecycle);
				expect(deleted.deletedCount).toBe(1);
				expect(yield* session.run((db) => db.select().from(tables.event))).toEqual([]);
				const triggers = yield* session.run((db) =>
					db
						.select()
						.from(tables.automationTrigger)
						.where(eq(tables.automationTrigger.executionId, lifecycle.causation.executionId)),
				);
				const eventDeletes = triggers.filter(
					({ category, operation, resourceKind }) =>
						category === "change" && resourceKind === "event" && operation === "delete",
				);
				const eventBatches = triggers.filter(
					({ category, operation, resourceKind }) =>
						category === "change" && resourceKind === "event" && operation === "batch",
				);
				expect(
					eventDeletes.map(({ payload }) =>
						payload?.category === "change" &&
						payload.resource === "event" &&
						payload.operation === "delete"
							? payload.before.id
							: null,
					),
				).toEqual(eventIds);
				expect(eventBatches).toHaveLength(1);
				assert(eventBatches[0]?.payload?.operation === "batch");
				expect(eventBatches[0].payload.items).toHaveLength(2);
				const [batchReceipt] = yield* session.run((db) =>
					db
						.select()
						.from(tables.mutationReceipt)
						.where(eq(tables.mutationReceipt.commandKind, "entity:delete-batch")),
				);
				assert(batchReceipt);
				for (const trigger of [...eventDeletes, ...eventBatches]) {
					expect(batchReceipt.dispatch).toContainEqual(
						expect.objectContaining({ triggerId: trigger.id }),
					);
				}
				const receiptCount = yield* session.run((db) => db.select().from(tables.mutationReceipt));
				expect(yield* service.deleteByIds([workoutSession.entity.id], lifecycle)).toEqual(deleted);
				expect(yield* session.run((db) => db.select().from(tables.mutationReceipt))).toEqual(
					receiptCount,
				);
				expect(yield* events.listEventIdentitiesForEntities([workoutSession.entity.id])).toEqual(
					[],
				);
			}),
		);
	});

	layer(entitiesLayer({ lateEventOnDelete: true }))((test) => {
		test.effect("rolls back a cascade when an event appears after deletion preparation", () =>
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const events = yield* EventsRepository;
				const session = yield* DatabaseSession;
				const workoutSession = yield* service.create(createInput("late-event-session"));
				const workout = yield* service.create(createInput("late-event-workout"));
				yield* createEvent(
					EventId.make("initial-cascade-event"),
					owner,
					workout.entity.id,
					workoutSession.entity.id,
				);
				const failure = yield* service
					.deleteByIds([workoutSession.entity.id], command("late-event-delete"))
					.pipe(Effect.flip);
				expect(failure).toMatchObject({
					_tag: "DbError",
					message: "Entity event references changed while deletion policies ran",
				});
				expect(yield* service.getByIdAnyScope(workoutSession.entity.id)).toEqual(
					workoutSession.entity,
				);
				expect(
					yield* events.listEventIdentitiesForEntities([workoutSession.entity.id]),
				).toHaveLength(2);
				expect(
					(yield* session.run((db) => db.select().from(tables.automationTrigger))).filter(
						({ category, operation, resourceKind }) =>
							category === "change" &&
							resourceKind === "event" &&
							(operation === "delete" || operation === "batch"),
					),
				).toEqual([]);
			}),
		);
	});

	layer(entitiesLayer())((test) => {
		test.effect("deletes an event once when both entity reference roles match the batch", () =>
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const session = yield* DatabaseSession;
				const primary = yield* service.create(createInput("overlap-primary"));
				const sessionEntity = yield* service.create(createInput("overlap-session"));
				const eventId = EventId.make("overlapping-event");
				yield* createEvent(eventId, owner, primary.entity.id, sessionEntity.entity.id);
				const lifecycle = command("overlap-cascade-delete");
				expect(
					(yield* service.deleteByIds([primary.entity.id, sessionEntity.entity.id], lifecycle))
						.deletedCount,
				).toBe(2);
				const eventDeletes = (yield* session.run((db) =>
					db.select().from(tables.automationTrigger),
				))
					.filter(
						({ category, operation, resourceKind }) =>
							category === "change" && resourceKind === "event" && operation === "delete",
					)
					.map(({ payload }) =>
						payload?.category === "change" &&
						payload.resource === "event" &&
						payload.operation === "delete"
							? payload.before.id
							: null,
					);
				expect(eventDeletes).toEqual([eventId]);
			}),
		);
	});

	layer(entitiesLayer())((test) => {
		test.effect("deletes events for every user of a global entity", () =>
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const session = yield* DatabaseSession;
				const secondUser = UserId.make("second-owner");
				yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({
							id: secondUser,
							name: "Second owner",
							email: "second@example.test",
							accountGeneration: "second-account-generation",
						}),
				);
				const globalEntity = yield* service.createGlobal({
					name: "Global",
					entitySchemaSlug: slug,
					properties: { title: "global" },
					lifecycle: systemCommand("global-create"),
				});
				const eventIds: [EventId, EventId] = [
					EventId.make("global-event-owner"),
					EventId.make("global-event-second"),
				];
				yield* createEvent(eventIds[0], owner, globalEntity.entity.id);
				yield* createEvent(eventIds[1], secondUser, globalEntity.entity.id);
				const lifecycle = systemCommand("global-cascade-delete");
				yield* service.deleteByIds([globalEntity.entity.id], lifecycle);
				expect(yield* session.run((db) => db.select().from(tables.event))).toEqual([]);
				const eventChanges = (yield* session.run((db) =>
					db.select().from(tables.automationTrigger),
				))
					.filter(
						({ category, operation, resourceKind }) =>
							category === "change" && resourceKind === "event" && operation === "delete",
					)
					.map(({ payload }) =>
						payload?.category === "change" &&
						payload.resource === "event" &&
						payload.operation === "delete"
							? payload.before.id
							: null,
					);
				expect(eventChanges).toEqual(eventIds);
				const eventBatches = (yield* session.run((db) =>
					db.select().from(tables.automationTrigger),
				)).filter(
					({ category, operation, resourceKind }) =>
						category === "change" && resourceKind === "event" && operation === "batch",
				);
				expect(
					eventBatches
						.map(({ scopeUserId }) => scopeUserId)
						.sort((left, right) => (left ?? "").localeCompare(right ?? "")),
				).toEqual([owner, secondUser]);
			}),
		);
	});

	const providerId = SandboxProviderId.make("fixture-provider");
	const seedProvider = Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			Effect.gen(function* () {
				yield* db
					.insert(tables.plugin)
					.values({ slug: "provider", status: "disabled", id: "provider-plugin" });
				yield* db
					.insert(tables.sandboxProvider)
					.values({
						id: providerId,
						slug: "provider",
						name: "Provider",
						rootEntitySchemaSlug: slug,
						pluginId: "provider-plugin",
						information: { source: "fixture" },
					});
			}),
		);
	});
	layer(entitiesLayer())((test) => {
		test.effect(
			"persists provider provenance and population-only updates; existing provider create is a noop",
			() =>
				Effect.gen(function* () {
					yield* seedProvider;
					const service = yield* EntitiesService;
					const session = yield* DatabaseSession;
					const input = {
						providerId,
						name: "Global",
						populatedAt: null,
						externalId: "external",
						entitySchemaSlug: slug,
						lifecycle: command("global"),
						properties: { title: "global" },
					};
					const created = yield* service.createGlobal(input);
					expect(created.entity).toMatchObject({
						providerId,
						populatedAt: null,
						externalId: "external",
					});
					expect(
						yield* service.createGlobal({
							...input,
							name: "Ignored",
							lifecycle: command("global-noop"),
						}),
					).toEqual({ warnings: [], entity: created.entity });
					const populatedAt = DateTime.toDateUtc(DateTime.makeUnsafe("2026-09-15T01:00:00.000Z"));
					const updated = yield* service.upsert({
						...input,
						populatedAt,
						scope: "global",
						updateExisting: false,
						lifecycle: command("population"),
					});
					expect(updated.entity.populatedAt).toBe("2026-09-15T01:00:00.000Z");
					const noop = yield* service.upsert({
						...input,
						scope: "global",
						name: "Ignored",
						updateExisting: false,
						lifecycle: command("upsert-noop"),
					});
					expect(noop.entity).toEqual(updated.entity);
					expect(
						(yield* session.run((db) => db.select().from(tables.automationTrigger))).filter(
							(row) => row.category === "change",
						).length,
					).toBe(4);
				}),
		);
	});
	layer(entitiesLayer({ warnings: [warning] }))((test) => {
		test.effect("caps global bulk writes under lock and returns dispatched warnings", () =>
			Effect.gen(function* () {
				yield* seedProvider;
				const service = yield* EntitiesService;
				const session = yield* DatabaseSession;
				const items = ["one", "two", "three"].map((externalId) => ({
					externalId,
					name: externalId,
					populatedAt: null,
					entitySchemaSlug: slug,
					properties: { title: externalId },
				}));
				const result = yield* service.upsertGlobalEntities(items, providerId, command("bulk"), {
					maximumTotal: 2,
				});
				expect(result.results.map((item) => item.status)).toEqual([
					"upserted",
					"upserted",
					"skipped",
				]);
				expect(result.warnings).toEqual([warning, warning, warning]);
				const replay = yield* service.upsertGlobalEntities(items, providerId, command("bulk"), {
					maximumTotal: 2,
				});
				expect(replay.results).toEqual(result.results);
				expect(yield* session.run((db) => db.select().from(tables.entity))).toHaveLength(2);
				expect(
					(yield* session.run((db) => db.select().from(tables.automationTrigger))).filter(
						(row) => row.category === "change",
					).length,
				).toBe(3);
			}),
		);
	});
	layer(entitiesLayer({ failChange: true }))((test) => {
		test.effect(
			"atomically rolls a no-policy source and change plan back on planning failure",
			() =>
				Effect.gen(function* () {
					const service = yield* EntitiesService;
					const session = yield* DatabaseSession;
					expect(yield* service.create(createInput("rollback")).pipe(Effect.flip)).toMatchObject({
						_tag: "DbError",
						message: "Injected planning failure after insert",
					});
					const [entities, triggers] = yield* session.run((db) =>
						Effect.all([
							db.select().from(tables.entity),
							db.select().from(tables.automationTrigger),
						]),
					);
					expect(entities).toEqual([]);
					expect(triggers).toEqual([]);
				}),
		);
	});

	layer(entitiesLayer({ deadlockOnce: true }))((test) => {
		test.effect("retries the entire source write and change plan after a deadlock", () =>
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const session = yield* DatabaseSession;
				const saved = yield* service.create(createInput("deadlock-retry"));
				expect(
					(yield* session.run((db) => db.select().from(tables.entity))).map(({ id }) => id),
				).toEqual([saved.entity.id]);
				expect(
					(yield* session.run((db) => db.select().from(tables.automationTrigger))).map(
						({ category, operation }) => ({ category, operation }),
					),
				).toEqual([
					{ category: "request", operation: "create" },
					{ category: "change", operation: "create" },
					{ category: "change", operation: "batch" },
				]);
			}),
		);
	});

	layer(entitiesLayer({ warnings: [warning] }))((test) => {
		test.effect(
			"returns warnings after commit, replays create once and rejects conflicting command content",
			() =>
				Effect.gen(function* () {
					const service = yield* EntitiesService;
					const session = yield* DatabaseSession;
					const first = yield* service.create(createInput("replay"));
					expect(first.warnings).toEqual([warning, warning]);
					expect(first.entity.name).toBe("Original");
					expect(yield* service.create(createInput("replay"))).toEqual(first);
					expect(
						yield* service
							.create({ ...createInput("replay"), properties: { title: "different" } })
							.pipe(Effect.flip),
					).toMatchObject({ reason: { code: "mutation-conflict" } });
					const [entities, triggers] = yield* session.run((db) =>
						Effect.all([
							db.select().from(tables.entity),
							db.select().from(tables.automationTrigger),
						]),
					);
					expect(entities).toHaveLength(1);
					expect(triggers.length).toBe(3);
					const change = triggers.find(
						(row) => row.category === "change" && row.operation === "create",
					);
					const request = triggers.find((row) => row.category === "request");
					assert(change && request);
					expect(change.payload).toEqual({
						category: "change",
						resource: "entity",
						operation: "create",
						after: first.entity,
					});
					expect(change.parentTriggerId).toBe(request.id);
				}),
		);
	});

	layer(entitiesLayer())((test) => {
		test.effect(
			"captures exact persisted update/delete snapshots and leaves noop timestamps untouched",
			() =>
				Effect.gen(function* () {
					const service = yield* EntitiesService;
					const session = yield* DatabaseSession;
					const created = yield* service.create(createInput("create"));
					const input = {
						userId: owner,
						name: "Updated",
						populatedAt: null,
						scope: "user" as const,
						entityId: created.entity.id,
						lifecycle: command("update"),
						properties: { title: "updated" },
					};
					const updated = yield* service.update(input);
					const noop = yield* service.update({ ...input, lifecycle: command("noop") });
					expect(noop.entity).toEqual(updated.entity);
					const deleted = yield* service.deleteByIds([created.entity.id], command("delete"));
					expect(deleted).toEqual({ warnings: [], deletedCount: 1 });
					expect(yield* service.deleteByIds([created.entity.id], command("delete"))).toEqual(
						deleted,
					);
					const changes = (yield* session.run((db) =>
						db.select().from(tables.automationTrigger),
					)).filter((row) => row.category === "change");
					expect(changes.length).toBe(6);
					expect(changes.find((row) => row.operation === "update")?.payload).toEqual({
						category: "change",
						resource: "entity",
						operation: "update",
						after: updated.entity,
						before: created.entity,
					});
					expect(changes.find((row) => row.operation === "delete")?.payload).toEqual({
						category: "change",
						resource: "entity",
						operation: "delete",
						before: updated.entity,
					});
					expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
				}),
		);
	});

	for (const [name, options, code] of [
		[
			"rejected",
			{
				policies: [
					{ action: "reject", reason: "Denied" },
					{ action: "reject", reason: "Should not execute" },
				],
			},
			"policy-rejected",
		],
		["blocked", { blocked: true }, "automation-limit"],
		[
			"failed",
			{ policies: ["fail", { action: "reject", reason: "Should not execute" }] },
			"policy-execution-failed",
		],
	] as const) {
		layer(entitiesLayer(options))((test) => {
			test.effect(`retains ${name} request without a source mutation`, () =>
				Effect.gen(function* () {
					const service = yield* EntitiesService;
					const session = yield* DatabaseSession;
					const error = yield* service.create(createInput(name)).pipe(Effect.flip);
					expect(error).toMatchObject({ reason: { code }, _tag: "EntityBadRequest" });
					if (name === "rejected") {
						expect(error).toMatchObject({ reason: { message: "Denied" } });
					}
					if (name === "failed") {
						expect(error).toMatchObject({ reason: { runId: "policy-0" } });
					}
					expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
					const [request] = yield* session.run((db) =>
						db
							.select()
							.from(tables.automationTrigger)
							.where(eq(tables.automationTrigger.category, "request")),
					);
					assert(request);
					const lifecycle = yield* FakeEntityLifecycle;
					expect(yield* lifecycle.policyCalls).toEqual(name === "blocked" ? [] : ["policy-0"]);
					expect(yield* lifecycle.skippedPolicyTriggers).toEqual(
						name === "blocked" ? [] : [request.id],
					);
				}),
			);
		});
	}

	layer(
		entitiesLayer({
			policies: [proposal("First", { title: "first" }), proposal("Second", { title: "second" })],
		}),
	)((test) => {
		test.effect("chains transforms in order then validates the final draft", () =>
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				expect((yield* service.create(createInput("transform"))).entity).toMatchObject({
					name: "Second",
					properties: { title: "second" },
				});
			}),
		);
	});

	layer(entitiesLayer({ policies: [proposal("Changed", { title: "changed" })] }))((test) => {
		test.effect("applies only the fields exposed by a strict entity patch", () =>
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				expect((yield* service.create(createInput("identity"))).entity).toMatchObject({
					name: "Changed",
					properties: { title: "changed" },
				});
			}),
		);
	});

	layer(
		entitiesLayer({
			policies: [
				{
					action: "transform",
					patch: { resource: "entity", draft: { properties: { remove: [], set: { title: 42 } } } },
				},
			],
		}),
	)((test) => {
		test.effect("revalidates transformed properties against AppSchema", () =>
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const session = yield* DatabaseSession;
				expect(yield* service.create(createInput("invalid")).pipe(Effect.flip)).toMatchObject({
					reason: { code: "invalid-properties" },
				});
				expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
			}),
		);
	});

	layer(entitiesLayer())((test) => {
		test.effect("rejects enclosing caller transactions before request planning", () =>
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const session = yield* DatabaseSession;
				const error = yield* session
					.transaction(service.create(createInput("nested")))
					.pipe(Effect.flip);
				expect(error).toMatchObject({ reason: { code: "enclosing-transaction" } });
				expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual([]);
			}),
		);
	});

	layer(entitiesLayer())((test) => {
		test.effect("requires an active transaction and returns committed dispatch references", () =>
			Effect.gen(function* () {
				yield* seedProvider;
				const service = yield* EntitiesService;
				const session = yield* DatabaseSession;
				const input = {
					providerId,
					name: "Planned",
					populatedAt: null,
					updateExisting: true,
					externalId: "planned",
					entitySchemaSlug: slug,
					scope: "global" as const,
					lifecycle: command("planned"),
					properties: { title: "planned" },
				};
				expect(yield* service.persistPlannedProviderUpsert(input).pipe(Effect.flip)).toMatchObject({
					code: "active-transaction-required",
				});
				const work = yield* session.transaction(service.persistPlannedProviderUpsert(input));
				expect(work.result.entity.name).toBe("Planned");
				const triggers = yield* AutomationTriggerRepository;
				const planned = yield* Effect.forEach(work.dispatch, ({ triggerId }) =>
					triggers.findById(triggerId),
				);
				expect(planned.map((trigger) => trigger?.kind)).toEqual([
					{ category: "change", resource: "entity", operation: "create" },
					{ category: "change", operation: "batch", resource: "entity" },
				]);
				const batch = planned[1]?.payload;
				assert(batch?.operation === "batch");
				expect(batch.items).toEqual([planned[0]?.payload]);
				const newerInput = {
					...input,
					name: "Newer",
					properties: { title: "newer" },
					lifecycle: command("planned-newer"),
				};
				const newer = yield* session.transaction(service.persistPlannedProviderUpsert(newerInput));
				const noopInput = { ...newerInput, lifecycle: command("planned-noop") };
				const noop = yield* session.transaction(service.persistPlannedProviderUpsert(noopInput));
				expect(noop.result).toEqual(newer.result);
				expect(noop.dispatch).toEqual([]);
				expect(yield* session.transaction(service.persistPlannedProviderUpsert(input))).toEqual(
					work,
				);
				yield* service.deleteByIds([work.result.entity.id], command("planned-delete"));
				expect(yield* session.transaction(service.persistPlannedProviderUpsert(input))).toEqual(
					work,
				);
				expect(
					yield* session.transaction(service.persistPlannedProviderUpsert(newerInput)),
				).toEqual(newer);
				expect(yield* session.transaction(service.persistPlannedProviderUpsert(noopInput))).toEqual(
					noop,
				);
				expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
			}),
		);
	});

	layer(entitiesLayer())((test) => {
		test.effect("covers one batch-scoped provider write with a single batch trigger", () =>
			Effect.gen(function* () {
				yield* seedProvider;
				const service = yield* EntitiesService;
				const session = yield* DatabaseSession;
				const lifecycle = command("planned-batch");
				const item = (externalId: string) => ({
					providerId,
					externalId,
					name: externalId,
					populatedAt: null,
					updateExisting: true,
					entitySchemaSlug: slug,
					scope: "global" as const,
					properties: { title: externalId },
					lifecycle: { ...lifecycle, itemIdentity: `${lifecycle.itemIdentity}:${externalId}` },
				});
				const work = yield* session.transaction(
					service.persistPlannedProviderUpserts({
						items: [item("first"), item("second")],
						batch: { command: lifecycle, identity: ["children"] },
					}),
				);
				expect(work.results.map(({ entity }) => entity.externalId)).toEqual(["first", "second"]);
				const triggers = yield* AutomationTriggerRepository;
				const planned = yield* Effect.forEach(work.dispatch, ({ triggerId }) =>
					triggers.findById(triggerId),
				);
				expect(planned.map((trigger) => trigger?.kind.operation)).toEqual([
					"create",
					"create",
					"batch",
				]);
				const batch = planned[2]?.payload;
				assert(batch?.operation === "batch");
				expect(batch.items).toEqual(planned.slice(0, 2).map((trigger) => trigger?.payload));
			}),
		);
	});

	layer(entitiesLayer({ policies: [{ action: "allow" }] }))((test) => {
		test.effect(
			"rolls back transaction-scoped provider persistence when a before policy matches",
			() =>
				Effect.gen(function* () {
					yield* seedProvider;
					const service = yield* EntitiesService;
					const session = yield* DatabaseSession;
					const error = yield* session
						.transaction(
							service.persistPlannedProviderUpsert({
								providerId,
								name: "Policy",
								scope: "global",
								populatedAt: null,
								externalId: "policy",
								updateExisting: true,
								entitySchemaSlug: slug,
								properties: { title: "policy" },
								lifecycle: command("planned-policy"),
							}),
						)
						.pipe(Effect.flip);
					expect(error).toMatchObject({ code: "before-policy-requires-owner" });
					const [entities, triggers] = yield* session.run((db) =>
						Effect.all([
							db.select().from(tables.entity),
							db.select().from(tables.automationTrigger),
						]),
					);
					expect(entities).toEqual([]);
					expect(triggers).toEqual([]);
				}),
		);
	});

	layer(entitiesLayer({ warnings: [warning] }))((test) => {
		test.effect("ensures bootstrap entities with warnings and no duplicate changes", () =>
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const session = yield* DatabaseSession;
				const items = [
					{ name: "Routine", entitySchemaSlug: slug, properties: { title: "routine" } },
				];
				const first = yield* service.ensureUserEntities(owner, items, command("ensure"));
				expect(first).toMatchObject([{ wasInserted: true, warnings: [warning, warning] }]);
				expect(yield* service.ensureUserEntities(owner, items, command("ensure"))).toEqual(first);
				expect(yield* session.run((db) => db.select().from(tables.entity))).toHaveLength(1);
				expect(
					(yield* session.run((db) => db.select().from(tables.automationTrigger))).filter(
						(row) => row.category === "change",
					).length,
				).toBe(2);
				const noop = yield* service.ensureUserEntities(owner, items, command("ensure-noop"));
				expect(noop).toEqual(
					first.map(({ entityId }) => ({ entityId, warnings: [], wasInserted: false })),
				);
				const [ensured] = first;
				assert(ensured);
				yield* service.deleteByIds([ensured.entityId], command("ensure-delete"));
				yield* session.run((db) =>
					db
						.delete(tables.mutationReceipt)
						.where(eq(tables.mutationReceipt.commandKind, "entity:ensure-batch")),
				);
				expect(yield* service.ensureUserEntities(owner, items, command("ensure"))).toEqual(first);
				expect(yield* service.ensureUserEntities(owner, items, command("ensure-noop"))).toEqual(
					noop,
				);
				expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
			}),
		);
	});

	layer(entitiesLayer({ failChange: true }))((test) => {
		test.effect("rolls the entire ensure batch back when its change plan fails", () =>
			Effect.gen(function* () {
				const service = yield* EntitiesService;
				const session = yield* DatabaseSession;
				yield* service
					.ensureUserEntities(
						owner,
						[{ name: "Routine", entitySchemaSlug: slug, properties: { title: "routine" } }],
						command("ensure-rollback"),
					)
					.pipe(Effect.flip);
				expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
				expect(
					(yield* session.run((db) => db.select().from(tables.automationTrigger))).map(
						(row) => row.category,
					),
				).toEqual(["request"]);
			}),
		);
	});
});
