import { assert, expect, layer } from "@effect/vitest";
import { EntityBadRequest } from "@ryot-app/contract/modules/entities/schemas";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	PluginId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { and, eq, inArray } from "drizzle-orm";
import { DateTime, Effect, Layer, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	PolicyBatchPayload,
	PolicyBatchWorkflow,
	runPolicyBatchWorkflow,
} from "#modules/automations/lifecycle/policy-batch";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { kernelDefinitionSource } from "#modules/definitions/kernel-source";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { EntityImportWorkflowOperations } from "#modules/entities/providers/operations-workflow";
import {
	ProviderEntityPopulationAttemptWorkflow,
	runProviderEntityPopulationAttemptWorkflow,
} from "#modules/entities/providers/provider-entity-population-workflow";
import {
	EventCreateWorkflow,
	type EventCreateWorkflowPayload,
} from "#modules/events/event-create-workflow";
import { runEventCreateWorkflow } from "#modules/events/event-create-workflow-live";
import { EventMutations } from "#modules/events/mutations";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import { MutationReceipts } from "#modules/mutations/receipts";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { testPluginPackageId } from "#modules/plugins/test-support";
import { relationshipDatabaseLayer } from "#modules/relationships/lifecycle.test-support";
import { RelationshipsService } from "#modules/relationships/service";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { dispatchSandboxHostActivity } from "#modules/scripts/host/durable-dispatcher";
import { unusedSandboxHostImplementations } from "#modules/scripts/host/host-implementations.test-support";
import { SandboxSubmissionCommands } from "#modules/scripts/host/submission-command";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { RedisService } from "#platform/redis";
import * as tables from "#schema/tables/combined";
import { makeRedisService, makeWorkflowActivityEngine, makeWorkflowEngine } from "#testing/effect";

import { EntitiesRepository } from "./repository";
import { makeEntityScriptHost } from "./script-host";
import { EntitiesService, type UpsertEntityInput } from "./service";
import { EntityUserDataService } from "./user-data/service";
import { type DomainLifecycleCommand, kernelCollectionLifecycleCommand } from "./write-context";

const firstUser = UserId.make("relationship-owner");
const secondUser = UserId.make("second-namespace-owner");
const bottle = EntitySchemaSlug.make("bottle");
const titleProperties = {
	fields: { title: { type: "string", label: "Title", description: "Title" } },
} as const;
const bottleProperties = {
	fields: {
		...titleProperties.fields,
		code: { label: "Code", type: "string", immutable: true, description: "Code" },
	},
} as const;
const namespacePackage = (packageId = testPluginPackageId(), version = "one") => {
	const source = revisionPackage("whiskey", version, bottle, packageId);
	return {
		...source,
		manifest: {
			...source.manifest,
			metadata: { ...source.manifest.metadata, name: "Whiskey" },
			entitySchemas: ["bottle", "part", "section"].map((slug) => ({
				slug,
				name: slug,
				icon: "box",
				propertiesSchema: slug === "bottle" ? bottleProperties : titleProperties,
				eventSchemas: [{ slug: "tasted", name: "Tasted", propertiesSchema: titleProperties }],
			})),
			relationshipSchemas: [
				{
					slug: "link",
					name: "Link",
					sourceEntitySchemaSlug: null,
					targetEntitySchemaSlug: null,
					propertiesSchema: { fields: {} },
				},
				{
					name: "Parts",
					slug: "bottle-part",
					targetEntitySchemaSlug: "part",
					sourceEntitySchemaSlug: "bottle",
					propertiesSchema: { fields: {} },
				},
				{
					name: "Sections",
					slug: "part-section",
					sourceEntitySchemaSlug: "part",
					propertiesSchema: { fields: {} },
					targetEntitySchemaSlug: "section",
				},
				{
					slug: "credits",
					name: "Credits",
					sourceEntitySchemaSlug: "bottle",
					targetEntitySchemaSlug: "bottle",
					propertiesSchema: { fields: {} },
				},
			],
		},
	};
};

const entityDeclaration = (slug: string) => ({
	slug,
	name: slug,
	icon: "box",
	eventSchemas: [],
	propertiesSchema: titleProperties,
});
const retiredAt = new Date("2026-10-13T00:00:00.000Z");

const admittedCommand = Effect.fnUntraced(function* (
	installed: Effect.Success<ReturnType<typeof installRevisionPackage>>,
	userId: UserId,
	executionId: string,
) {
	const runtime = yield* PluginRuntimeResolver;
	const provider = yield* runtime.findProviderAvailableToUserByReference(userId, {
		slug: "whiskey-provider",
		owner: definitionOwner(installed.pluginId),
	});
	assert(provider);
	const script = yield* runtime.resolveUserDetailsScript(userId, provider.id);
	const subject = {
		userId,
		type: "user" as const,
		accountGeneration: { userId, token: "test-account-generation" },
	};
	const pin = yield* (yield* SandboxRepository.make).getScriptPin(script.id, undefined, subject);
	assert(pin?.pluginRevision);
	const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
	const command: DomainLifecycleCommand = {
		...rootLifecycleCommand({
			source: "api",
			lane: "interactive",
			itemIdentity: "namespace",
			occurredAt: "2026-10-13T00:00:00.000Z",
			initiator: { id: userId, kind: "user" },
			accountGeneration: subject.accountGeneration,
			executionId: AutomationExecutionId.make(executionId),
		}),
		writeContext: principal,
	};
	return { command, providerId: provider.id };
});

const userDataService = EntityUserDataService.make.pipe(
	Effect.provideServiceEffect(MutationReceipts, MutationReceipts.make),
);

const ensureKernelCollections = Effect.gen(function* () {
	const definitions = yield* DefinitionRepository;
	const current = yield* definitions.readKernelSource;
	const kernel = kernelDefinitionSource();
	const collection = kernel.entitySchemas.find(({ slug }) => slug === "collection");
	const membership = kernel.relationshipSchemas.find(({ slug }) => slug === "member-of");
	assert(collection && membership);
	yield* definitions.replaceKernelDefinitions({
		...current,
		entitySchemas: [
			...current.entitySchemas.filter(({ slug }) => slug !== "collection"),
			collection,
		],
		relationshipSchemas: [
			...current.relationshipSchemas.filter(({ slug }) => slug !== "member-of"),
			membership,
		],
	});
});

const nextCommand = (
	command: DomainLifecycleCommand,
	itemIdentity: string,
): DomainLifecycleCommand => ({ ...command, itemIdentity });

const createEvents = (
	command: DomainLifecycleCommand,
	userId: UserId,
	payload: EventCreateWorkflowPayload["payload"],
	executionId: string,
) => {
	const instance = WorkflowInstance.initial(EventCreateWorkflow, executionId);
	const original = makeWorkflowActivityEngine(instance);
	return Effect.gen(function* () {
		const repository = yield* EventsRepository.make;
		const schemas = yield* EventSchemaReader.make;
		const capturedContext =
			yield* Effect.context<Effect.Services<ReturnType<typeof runPolicyBatchWorkflow>>>();
		const engine = makeWorkflowEngine({
			...original,
			execute: (workflow, options) =>
				workflow._tag === PolicyBatchWorkflow._tag
					? Schema.decodeUnknownEffect(PolicyBatchPayload)(options.payload).pipe(
							Effect.orDie,
							Effect.flatMap((batch) => {
								const childInstance = WorkflowInstance.initial(
									PolicyBatchWorkflow,
									options.executionId,
								);
								return runPolicyBatchWorkflow(batch).pipe(
									Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(childInstance)),
									Effect.provideService(WorkflowInstance, childInstance),
									Effect.provide(capturedContext),
								);
							}),
						)
					: Effect.die(`Unexpected workflow: ${workflow._tag}`),
		});
		return yield* runEventCreateWorkflow({ userId, command, payload }, executionId).pipe(
			Effect.provideServiceEffect(EventMutations, EventMutations.make),
			Effect.provideService(EventsRepository, repository),
			Effect.provideService(EventSchemaReader, schemas),
			Effect.provideService(WorkflowEngine, engine),
		);
	}).pipe(
		Effect.provideService(WorkflowEngine, original),
		Effect.provideService(WorkflowInstance, instance),
	);
};

layer(
	EnrichmentRequests.layer.pipe(
		Layer.provide(
			Layer.succeed(RedisService, makeRedisService({ publish: () => Effect.succeed(1) })),
		),
		Layer.provideMerge(relationshipDatabaseLayer()),
	),
)((test) => {
	test.effect(
		"retries user entity writes across durable attempts without duplicate rows or hooks",
		() =>
			Effect.gen(function* () {
				const source = namespacePackage();
				const capabilities = ["createUserEntity", "updateUserEntity", "deleteUserEntity"] as const;
				const installed = yield* installRevisionPackage(
					{
						...source,
						scripts: source.scripts.map((script) =>
							script.metadata.kind === "provider"
								? { ...script, metadata: { ...script.metadata, capabilities } }
								: script,
						),
						manifest: {
							...source.manifest,
							scripts: source.manifest.scripts.map((script) =>
								script.kind === "provider" ? { ...script, capabilities } : script,
							),
							hooks: source.manifest.hooks.map((hook) =>
								Object.assign({}, hook, {
									targets: [
										{ resource: "entity", operation: "create", entitySchemaSlug: "bottle" },
										{ resource: "entity", operation: "update", entitySchemaSlug: "bottle" },
										{ resource: "entity", operation: "delete", entitySchemaSlug: "bottle" },
									] as const,
								}),
							),
						},
					},
					firstUser,
				);
				const { command } = yield* admittedCommand(installed, firstUser, "write-attempt");
				assert(command.writeContext);
				const principal = command.writeContext;
				const hosts = unusedSandboxHostImplementations();
				const implementations = {
					...hosts,
					additional: {
						...hosts.additional,
						...(yield* makeEntityScriptHost.pipe(
							Effect.provideServiceEffect(
								SandboxSubmissionCommands,
								SandboxSubmissionCommands.make,
							),
							Effect.provideServiceEffect(EntityUserDataService, userDataService),
						)),
					},
				};
				const options = {
					idempotencyKey: "fixed-submission",
					submittedAt: "2026-10-15T00:00:00.000Z",
				};
				const request = {
					index: 0,
					kind: "host" as const,
					name: "createUserEntity",
					args: {
						capability: "createUserEntity" as const,
						args: [
							{ name: "Entry", entitySchemaSlug: "bottle", properties: { title: "initial" } },
							options,
						],
					},
				};
				const scope = {
					principal,
					context: {},
					executionId: "attempt-one",
					lane: "interactive" as const,
					startedAt: options.submittedAt,
				};
				const invalid = yield* dispatchSandboxHostActivity(
					implementations,
					{
						...request,
						args: {
							...request.args,
							args: [
								{ name: "Entry", properties: { title: 3 }, entitySchemaSlug: "bottle" },
								options,
							],
						},
					},
					scope,
				);
				expect(invalid).toMatchObject({
					state: "failure",
					error: { data: { code: "invalid-properties" } },
				});
				const [first, raced] = yield* Effect.all(
					[
						dispatchSandboxHostActivity(implementations, request, scope),
						dispatchSandboxHostActivity(implementations, request, {
							...scope,
							executionId: "concurrent-attempt",
						}),
					],
					{ concurrency: 2 },
				);
				assert(first);
				expect(raced).toEqual(first);
				expect(first.state).toBe("success");
				expect(
					yield* dispatchSandboxHostActivity(
						implementations,
						{ ...request, index: 8 },
						{ ...scope, executionId: "attempt-two", startedAt: "2026-10-16T00:00:00.000Z" },
					),
				).toEqual(first);
				const session = yield* DatabaseSession;
				const rows = yield* session.run((db) =>
					db.select().from(tables.entity).where(eq(tables.entity.userId, firstUser)),
				);
				expect(rows).toHaveLength(1);
				const row = rows[0];
				assert(row);
				const update = {
					index: 1,
					kind: "host" as const,
					name: "updateUserEntity",
					args: {
						capability: "updateUserEntity" as const,
						args: [
							{
								name: "Changed",
								entityId: row.id,
								properties: { title: "changed" },
								expected: {
									name: row.name,
									properties: { title: "initial" },
									updatedAt: row.updatedAt.toISOString(),
								},
							},
							options,
						] as const,
					},
				};
				const saved = yield* dispatchSandboxHostActivity(implementations, update, scope);
				expect(saved.state).toBe("success");
				const runs = yield* session.run((db) => db.select().from(tables.automationRun));
				expect(runs).toHaveLength(2);
				expect(
					yield* dispatchSandboxHostActivity(implementations, update, {
						...scope,
						executionId: "attempt-three",
					}),
				).toEqual(saved);
				expect(yield* session.run((db) => db.select().from(tables.automationRun))).toEqual(runs);
				const stale = yield* dispatchSandboxHostActivity(
					implementations,
					{
						...update,
						args: {
							...update.args,
							args: [update.args.args[0], { ...options, idempotencyKey: "stale-edit" }],
						},
					},
					scope,
				);
				expect(stale).toMatchObject({
					state: "failure",
					error: { data: { entityId: row.id, code: "entity-stale" } },
				});
				const conflict = yield* dispatchSandboxHostActivity(
					implementations,
					{
						...request,
						args: {
							...request.args,
							args: [{ properties: {}, name: "Different", entitySchemaSlug: "bottle" }, options],
						},
					},
					scope,
				);
				expect(conflict).toMatchObject({
					state: "failure",
					error: { data: { code: "mutation-conflict" } },
				});
				expect(
					yield* session.run((db) =>
						db.select().from(tables.entity).where(eq(tables.entity.userId, firstUser)),
					),
				).toHaveLength(1);
				const deletion = {
					index: 2,
					kind: "host" as const,
					name: "deleteUserEntity",
					args: {
						capability: "deleteUserEntity" as const,
						args: [{ entityId: row.id, entitySchemaSlug: "bottle" }, options] as const,
					},
				};
				expect(yield* dispatchSandboxHostActivity(implementations, deletion, scope)).toEqual({
					state: "success",
					value: { entityId: row.id },
				});
				const afterDeletion = yield* session.run((db) => db.select().from(tables.automationRun));
				expect(afterDeletion).toHaveLength(3);
				expect(
					yield* dispatchSandboxHostActivity(implementations, deletion, {
						...scope,
						executionId: "delete-retry",
					}),
				).toEqual({ state: "success", value: { entityId: row.id } });
				expect(yield* session.run((db) => db.select().from(tables.automationRun))).toEqual(
					afterDeletion,
				);
				expect(
					yield* session.run((db) =>
						db.select().from(tables.entity).where(eq(tables.entity.id, row.id)),
					),
				).toEqual([]);
			}),
	);
	test.effect(
		"rejects foreign same-name domain writes and unrestricted relationship endpoints",
		() =>
			Effect.gen(function* () {
				const a = yield* installRevisionPackage(namespacePackage(), firstUser);
				const b = yield* installRevisionPackage(namespacePackage(), firstUser);
				const entities = yield* EntitiesService;
				const relationships = yield* RelationshipsService;
				const admitted = yield* admittedCommand(a, firstUser, "foreign-writes");
				const ownSchema = { slug: bottle, owner: definitionOwner(a.pluginId) };
				const foreignSchema = { slug: bottle, owner: definitionOwner(b.pluginId) };
				const own = yield* entities.create({
					name: "A",
					scope: "user",
					userId: firstUser,
					entitySchema: ownSchema,
					properties: { title: "A" },
					lifecycle: admitted.command,
				});
				const foreign = yield* entities.create({
					name: "B",
					scope: "user",
					userId: firstUser,
					properties: { title: "B" },
					entitySchema: foreignSchema,
					lifecycle: { ...nextCommand(admitted.command, "seed-foreign"), writeContext: null },
				});
				const create = yield* Effect.flip(
					entities.create({
						scope: "user",
						name: "Wrong",
						properties: {},
						userId: firstUser,
						entitySchema: foreignSchema,
						lifecycle: nextCommand(admitted.command, "foreign-create"),
					}),
				);
				assert(create instanceof EntityBadRequest);
				expect(create.reason).toEqual({
					code: "owner-mismatch",
					expected: ownSchema.owner,
					actual: foreignSchema.owner,
				});
				expect(
					yield* Effect.flip(
						entities.update({
							scope: "user",
							name: "Wrong",
							properties: {},
							userId: firstUser,
							populatedAt: null,
							entityId: foreign.entity.id,
							lifecycle: nextCommand(admitted.command, "foreign-update"),
						}),
					),
				).toMatchObject({ reason: { code: "owner-mismatch" } });
				expect(
					yield* Effect.flip(
						entities.deleteByIds(
							[foreign.entity.id],
							nextCommand(admitted.command, "foreign-delete"),
						),
					),
				).toMatchObject({ reason: { code: "owner-mismatch" } });
				expect(
					yield* Effect.flip(
						entities.ensureUserEntities(
							firstUser,
							[{ name: "Wrong", properties: {}, entitySchema: foreignSchema }],
							nextCommand(admitted.command, "foreign-ensure"),
						),
					),
				).toMatchObject({ reason: { code: "owner-mismatch" } });
				expect(
					yield* Effect.flip(
						relationships.create(
							{
								scope: "user",
								properties: {},
								userId: firstUser,
								sourceEntityId: own.entity.id,
								targetEntityId: foreign.entity.id,
								relationshipSchema: {
									owner: ownSchema.owner,
									slug: RelationshipSchemaSlug.make("link"),
								},
							},
							nextCommand(admitted.command, "foreign-endpoint"),
						),
					),
				).toMatchObject({ reason: { code: "owner-mismatch" } });
				expect((yield* entities.getByIdAnyScope(foreign.entity.id)).properties).toEqual({
					title: "B",
				});
			}),
	);

	test.effect("rejects private global entities, batches, and relationships", () =>
		Effect.gen(function* () {
			const installed = yield* installRevisionPackage(namespacePackage(), firstUser);
			const { command, providerId } = yield* admittedCommand(
				installed,
				firstUser,
				"private-globals",
			);
			const entities = yield* EntitiesService;
			const relationships = yield* RelationshipsService;
			const entitySchema = { slug: bottle, owner: definitionOwner(installed.pluginId) };
			expect(
				yield* Effect.flip(
					entities.createGlobal({
						entitySchema,
						name: "Global",
						lifecycle: command,
						properties: { title: "Global" },
					}),
				),
			).toMatchObject({ reason: { code: "global-scope-forbidden" } });
			expect(
				yield* Effect.flip(
					entities.upsertGlobalEntities(
						[
							{
								entitySchema,
								name: "Global",
								populatedAt: null,
								externalId: "global",
								properties: { title: "Global" },
							},
						],
						providerId,
						nextCommand(command, "global-batch"),
					),
				),
			).toMatchObject({ reason: { code: "global-scope-forbidden" } });
			const own = yield* entities.create({
				name: "Own",
				entitySchema,
				scope: "user",
				userId: firstUser,
				properties: { title: "Own" },
				lifecycle: nextCommand(command, "own"),
			});
			expect(
				yield* Effect.flip(
					relationships.create(
						{
							properties: {},
							scope: "global",
							sourceEntityId: own.entity.id,
							targetEntityId: own.entity.id,
							relationshipSchema: {
								owner: entitySchema.owner,
								slug: RelationshipSchemaSlug.make("link"),
							},
						},
						nextCommand(command, "global-link"),
					),
				),
			).toMatchObject({ reason: { code: "global-scope-forbidden" } });
		}),
	);

	test.effect(
		"binds entity-local events to the stored owner for creates, updates, and deletes",
		() =>
			Effect.gen(function* () {
				const a = yield* installRevisionPackage(namespacePackage(), firstUser);
				const b = yield* installRevisionPackage(namespacePackage(), firstUser);
				const entities = yield* EntitiesService;
				const events = yield* EventsService;
				const session = yield* DatabaseSession;
				const first = yield* admittedCommand(a, firstUser, "event-a");
				const second = yield* admittedCommand(b, firstUser, "event-b");
				const own = yield* entities.create({
					name: "A",
					scope: "user",
					userId: firstUser,
					lifecycle: first.command,
					properties: { title: "A" },
					entitySchema: { slug: bottle, owner: definitionOwner(a.pluginId) },
				});
				const foreign = yield* entities.create({
					name: "B",
					scope: "user",
					userId: firstUser,
					lifecycle: second.command,
					properties: { title: "B" },
					entitySchema: { slug: bottle, owner: definitionOwner(b.pluginId) },
				});
				const localEvent = EventSchemaSlug.make("tasted");
				expect(
					(yield* createEvents(
						nextCommand(first.command, "own-event"),
						firstUser,
						[
							{
								entityId: own.entity.id,
								eventSchemaSlug: localEvent,
								properties: { title: "Own event" },
							},
						],
						"own-event-workflow",
					)).count,
				).toBe(1);
				expect(
					(yield* createEvents(
						nextCommand(second.command, "foreign-event"),
						firstUser,
						[
							{
								entityId: foreign.entity.id,
								eventSchemaSlug: localEvent,
								properties: { title: "Foreign event" },
							},
						],
						"foreign-event-workflow",
					)).count,
				).toBe(1);
				const denied = yield* createEvents(
					nextCommand(first.command, "wrong-event"),
					firstUser,
					[
						{
							entityId: foreign.entity.id,
							eventSchemaSlug: localEvent,
							properties: { title: "Wrong" },
						},
					],
					"wrong-event-workflow",
				);
				expect(denied.count).toBe(0);
				const [row] = yield* session.run((db) =>
					db.select().from(tables.event).where(eq(tables.event.entityId, foreign.entity.id)),
				);
				assert(row);
				expect(row.eventSchemaPluginId).toBe(b.pluginId);
				const eventId = EventId.make(row.id);
				expect(
					yield* Effect.flip(
						events.edit(
							{ eventId, patch: { properties: { remove: [], set: { title: "Wrong" } } } },
							firstUser,
							nextCommand(first.command, "wrong-edit"),
						),
					),
				).toMatchObject({ reason: { code: "owner-mismatch" } });
				expect(
					yield* Effect.flip(
						events.delete(
							{ eventId, userId: firstUser },
							nextCommand(first.command, "wrong-delete"),
						),
					),
				).toMatchObject({ reason: { code: "owner-mismatch" } });
				expect(
					(yield* session.run((db) =>
						db.select().from(tables.event).where(eq(tables.event.id, eventId)),
					))[0]?.properties,
				).toEqual({ title: "Foreign event" });
			}),
	);

	test.effect(
		"preserves explicit kernel collection membership and authorized entity-cascade cleanup",
		() =>
			Effect.gen(function* () {
				const definitions = yield* DefinitionRepository;
				const current = yield* definitions.readKernelSource;
				const kernel = kernelDefinitionSource();
				const collection = kernel.entitySchemas.find(({ slug }) => slug === "collection");
				const membership = kernel.relationshipSchemas.find(({ slug }) => slug === "member-of");
				assert(collection && membership);
				yield* definitions.replaceKernelDefinitions({
					...current,
					entitySchemas: [...current.entitySchemas, collection],
					relationshipSchemas: [...current.relationshipSchemas, membership],
				});
				const installed = yield* installRevisionPackage(namespacePackage(), firstUser);
				const { command } = yield* admittedCommand(installed, firstUser, "collections");
				const entities = yield* EntitiesService;
				const relationships = yield* RelationshipsService;
				const collectionSchema = {
					owner: { kind: "kernel" as const },
					slug: EntitySchemaSlug.make("collection"),
				};
				expect(
					yield* Effect.flip(
						entities.create({
							scope: "user",
							properties: {},
							name: "Unmarked",
							userId: firstUser,
							lifecycle: command,
							entitySchema: collectionSchema,
						}),
					),
				).toMatchObject({ reason: { code: "owner-mismatch" } });
				const item = yield* entities.create({
					name: "Item",
					scope: "user",
					userId: firstUser,
					properties: { title: "Item" },
					lifecycle: nextCommand(command, "item"),
					entitySchema: { slug: bottle, owner: definitionOwner(installed.pluginId) },
				});
				const container = yield* entities.create({
					scope: "user",
					properties: {},
					userId: firstUser,
					name: "Collection",
					entitySchema: collectionSchema,
					lifecycle: kernelCollectionLifecycleCommand(nextCommand(command, "collection")),
				});
				const link = yield* relationships.create(
					{
						scope: "user",
						properties: {},
						userId: firstUser,
						sourceEntityId: item.entity.id,
						targetEntityId: container.entity.id,
						relationshipSchema: {
							owner: collectionSchema.owner,
							slug: RelationshipSchemaSlug.make("member-of"),
						},
					},
					kernelCollectionLifecycleCommand(nextCommand(command, "membership")),
				);
				const membershipRow = link.relationship;
				assert(membershipRow);
				expect(membershipRow.relationshipSchemaPluginId).toBeNull();
				yield* createEvents(
					kernelCollectionLifecycleCommand(nextCommand(command, "collection-event")),
					firstUser,
					[
						{
							entityId: container.entity.id,
							sessionEntityId: item.entity.id,
							eventSchemaSlug: EventSchemaSlug.make("add-entity-to-collection"),
							properties: {
								entityId: item.entity.id,
								entitySchemaSlug: bottle,
								relationshipProperties: {},
							},
						},
					],
					"collection-event-workflow",
				);
				expect(
					(yield* entities.deleteByIds([item.entity.id], nextCommand(command, "delete-item")))
						.deletedCount,
				).toBe(1);
				const session = yield* DatabaseSession;
				expect(
					yield* session.run((db) =>
						db
							.select()
							.from(tables.relationship)
							.where(eq(tables.relationship.id, membershipRow.id)),
					),
				).toEqual([]);
				expect(
					yield* session.run((db) =>
						db.select().from(tables.event).where(eq(tables.event.sessionEntityId, item.entity.id)),
					),
				).toEqual([]);
				expect(
					(yield* entities.getByIdAnyScope(container.entity.id)).entitySchemaPluginId,
				).toBeNull();
			}),
	);

	test.effect("merges plugin entity data and kernel collection memberships under the plugin", () =>
		Effect.gen(function* () {
			yield* ensureKernelCollections;
			const installed = yield* installRevisionPackage(namespacePackage(), firstUser);
			const { command } = yield* admittedCommand(installed, firstUser, "merge-plugin");
			const entities = yield* EntitiesService;
			const relationships = yield* RelationshipsService;
			const merges = yield* userDataService;
			const session = yield* DatabaseSession;
			const schema = { slug: bottle, owner: definitionOwner(installed.pluginId) };
			const collectionSchema = {
				owner: { kind: "kernel" as const },
				slug: EntitySchemaSlug.make("collection"),
			};
			const createBottle = (name: string) =>
				entities.create({
					name,
					scope: "user",
					userId: firstUser,
					entitySchema: schema,
					properties: { title: name },
					lifecycle: nextCommand(command, `create-${name}`),
				});
			const from = (yield* createBottle("From")).entity;
			const into = (yield* createBottle("Into")).entity;
			const container = (yield* entities.create({
				scope: "user",
				properties: {},
				userId: firstUser,
				name: "Merge collection",
				entitySchema: collectionSchema,
				lifecycle: kernelCollectionLifecycleCommand(nextCommand(command, "collection")),
			})).entity;
			const link = yield* relationships.create(
				{
					scope: "user",
					properties: {},
					userId: firstUser,
					sourceEntityId: from.id,
					targetEntityId: container.id,
					relationshipSchema: {
						owner: collectionSchema.owner,
						slug: RelationshipSchemaSlug.make("member-of"),
					},
				},
				kernelCollectionLifecycleCommand(nextCommand(command, "membership")),
			);
			assert(link.relationship);
			const tasted = yield* createEvents(
				nextCommand(command, "tasted-event"),
				firstUser,
				[
					{
						entityId: from.id,
						properties: { title: "Tasted" },
						eventSchemaSlug: EventSchemaSlug.make("tasted"),
					},
				],
				"merge-tasted-workflow",
			);
			const added = yield* createEvents(
				kernelCollectionLifecycleCommand(nextCommand(command, "collection-event")),
				firstUser,
				[
					{
						entityId: container.id,
						sessionEntityId: from.id,
						eventSchemaSlug: EventSchemaSlug.make("add-entity-to-collection"),
						properties: {
							entityId: from.id,
							entitySchemaSlug: bottle,
							relationshipProperties: {},
							relationshipId: link.relationship.id,
						},
					},
				],
				"merge-collection-event-workflow",
			);
			expect([tasted.count, added.count]).toEqual([1, 1]);
			const payload = { mergeFrom: from.id, mergeInto: into.id, entitySchemaSlug: bottle };

			expect(
				yield* Effect.flip(
					merges.mergeEntityUserDataForCommand(
						firstUser,
						payload,
						kernelCollectionLifecycleCommand({
							...nextCommand(command, "no-plugin"),
							writeContext: null,
						}),
					),
				),
			).toMatchObject({ message: "Entity merge requires a pinned plugin" });

			const merged = yield* merges.mergeEntityUserDataForCommand(
				firstUser,
				payload,
				kernelCollectionLifecycleCommand(nextCommand(command, "merge")),
			);
			expect(merged).toMatchObject({ movedEventsCount: 2, movedRelationshipsCount: 1 });
			expect(
				yield* session.run((db) =>
					db
						.select({ source: tables.relationship.sourceEntityId })
						.from(tables.relationship)
						.where(eq(tables.relationship.targetEntityId, container.id)),
				),
			).toEqual([{ source: into.id }]);
			expect(
				yield* session.run((db) =>
					db
						.select({
							entityId: tables.event.entityId,
							sessionEntityId: tables.event.sessionEntityId,
							eventSchemaSlug: tables.event.eventSchemaSlug,
						})
						.from(tables.event)
						.where(eq(tables.event.userId, firstUser)),
				),
			).toEqual(
				expect.arrayContaining([
					{ entityId: into.id, sessionEntityId: null, eventSchemaSlug: "tasted" },
					{
						entityId: container.id,
						sessionEntityId: into.id,
						eventSchemaSlug: "add-entity-to-collection",
					},
				]),
			);
		}),
	);

	test.effect("refuses plugin merges outside the plugin's own user-owned entities", () =>
		Effect.gen(function* () {
			yield* ensureKernelCollections;
			const a = yield* installRevisionPackage(namespacePackage(), firstUser);
			const b = yield* installRevisionPackage(namespacePackage(), firstUser);
			const first = yield* admittedCommand(a, firstUser, "merge-refusals-a");
			const second = yield* admittedCommand(b, firstUser, "merge-refusals-b");
			const entities = yield* EntitiesService;
			const merges = yield* userDataService;
			const session = yield* DatabaseSession;
			const eventRows = yield* EventsRepository;
			const createBottle = (name: string, installed: typeof a, base: DomainLifecycleCommand) =>
				entities.create({
					name,
					scope: "user",
					userId: firstUser,
					properties: { title: name },
					lifecycle: nextCommand(base, `create-${name}`),
					entitySchema: { slug: bottle, owner: definitionOwner(installed.pluginId) },
				});
			const createCollection = (name: string) =>
				entities.create({
					name,
					scope: "user",
					properties: {},
					userId: firstUser,
					lifecycle: kernelCollectionLifecycleCommand(nextCommand(first.command, name)),
					entitySchema: {
						owner: { kind: "kernel" as const },
						slug: EntitySchemaSlug.make("collection"),
					},
				});
			const merge = (
				mergeFrom: string,
				mergeInto: string,
				entitySchemaSlug: EntitySchemaSlug,
				command: DomainLifecycleCommand,
			) =>
				Effect.flip(
					merges.mergeEntityUserDataForCommand(
						firstUser,
						{
							entitySchemaSlug,
							mergeFrom: EntityId.make(mergeFrom),
							mergeInto: EntityId.make(mergeInto),
						},
						kernelCollectionLifecycleCommand(command),
					),
				);
			const from = (yield* createBottle("From", a, first.command)).entity;
			const into = (yield* createBottle("Into", a, first.command)).entity;
			const foreignFrom = (yield* createBottle("ForeignFrom", b, second.command)).entity;
			const foreignInto = (yield* createBottle("ForeignInto", b, second.command)).entity;
			const left = (yield* createCollection("left")).entity;
			const right = (yield* createCollection("right")).entity;
			const globalSource = EntityId.make("global-bottle");
			yield* session.run((db) =>
				db
					.insert(tables.entity)
					.values({
						userId: null,
						name: "Global",
						id: globalSource,
						entitySchemaSlug: bottle,
						properties: { title: "Global" },
						entitySchemaPluginId: a.pluginId,
					}),
			);

			expect(
				yield* merge(
					left.id,
					right.id,
					EntitySchemaSlug.make("collection"),
					nextCommand(first.command, "m1"),
				),
			).toMatchObject({ reason: { code: "owner-mismatch" } });
			expect(
				yield* merge(foreignFrom.id, foreignInto.id, bottle, nextCommand(first.command, "m2")),
			).toMatchObject({ reason: { code: "owner-mismatch" } });
			expect(
				yield* merge(globalSource, into.id, bottle, nextCommand(first.command, "m3")),
			).toMatchObject({ reason: { code: "global-scope-forbidden" } });
			expect(
				yield* merge(
					from.id,
					into.id,
					EntitySchemaSlug.make("part"),
					nextCommand(first.command, "m4"),
				),
			).toMatchObject({ reason: { code: "entity-schema-mismatch" } });

			yield* session.transaction(
				eventRows.createEvent({
					userId: firstUser,
					entityId: foreignFrom.id,
					sessionEntityId: from.id,
					eventSchemaName: "Tasted",
					eventSchemaPluginId: b.pluginId,
					properties: { title: "Foreign" },
					id: EventId.make("foreign-session-event"),
					eventSchemaSlug: EventSchemaSlug.make("tasted"),
					occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-13T00:00:00.000Z")),
				}),
			);
			expect(
				yield* merge(from.id, into.id, bottle, nextCommand(first.command, "m5")),
			).toMatchObject({ reason: { code: "owner-mismatch" } });
			expect(
				yield* session.run((db) =>
					db
						.select({ sessionEntityId: tables.event.sessionEntityId })
						.from(tables.event)
						.where(eq(tables.event.id, EventId.make("foreign-session-event"))),
				),
			).toEqual([{ sessionEntityId: from.id }]);
			yield* session.run((db) =>
				db.delete(tables.entity).where(eq(tables.entity.id, globalSource)),
			);
		}),
	);

	test.effect(
		"continues an admitted additive writer and rejects newer values it cannot process",
		() =>
			Effect.gen(function* () {
				const original = namespacePackage();
				const installed = yield* installRevisionPackage(original, firstUser);
				const { command } = yield* admittedCommand(installed, firstUser, "old-writer");
				const newer = namespacePackage(original.manifest.metadata.packageId, "two");
				const updated = yield* installRevisionPackage(
					{
						...newer,
						manifest: {
							...newer.manifest,
							entitySchemas: Array.from(newer.manifest.entitySchemas, (definition) => ({
								...definition,
								propertiesSchema: {
									fields: {
										...definition.propertiesSchema.fields,
										newer: { type: "string", label: "Newer", description: "Newer" },
									},
								},
							})),
						},
					},
					firstUser,
				);
				expect(updated.pluginId).toBe(installed.pluginId);
				const entities = yield* EntitiesService;
				const entitySchema = { slug: bottle, owner: definitionOwner(installed.pluginId) };
				const continued = yield* entities.create({
					entitySchema,
					scope: "user",
					userId: firstUser,
					name: "Continued",
					lifecycle: command,
					properties: { title: "Old payload" },
				});
				expect(continued.entity.properties).toEqual({ title: "Old payload" });
				const fresh = yield* admittedCommand(updated, firstUser, "new-writer");
				const newValue = yield* entities.create({
					name: "New",
					entitySchema,
					scope: "user",
					userId: firstUser,
					lifecycle: fresh.command,
					properties: { newer: "present", title: "New payload" },
				});
				expect(
					yield* Effect.flip(
						entities.update({
							name: "Old",
							scope: "user",
							userId: firstUser,
							populatedAt: null,
							entityId: newValue.entity.id,
							properties: { title: "Overwrite" },
							lifecycle: nextCommand(command, "old-update"),
						}),
					),
				).toMatchObject({ reason: { code: "mutation-conflict" } });
				expect(
					yield* Effect.flip(
						entities.deleteByIds([newValue.entity.id], nextCommand(command, "old-delete")),
					),
				).toMatchObject({ reason: { code: "mutation-conflict" } });
				expect(
					yield* Effect.flip(
						entities.create({
							entitySchema,
							scope: "user",
							name: "Unknown",
							userId: firstUser,
							lifecycle: nextCommand(command, "unknown-payload"),
							properties: { title: "Old", newer: "unrecognized" },
						}),
					),
				).toMatchObject({ reason: { paths: [["newer"]], code: "invalid-properties" } });
				expect((yield* entities.getByIdAnyScope(newValue.entity.id)).properties).toEqual({
					newer: "present",
					title: "New payload",
				});
			}),
	);

	test.effect("rejects a newer stored value introduced while before policies run", () =>
		Effect.gen(function* () {
			const original = namespacePackage();
			const installed = yield* installRevisionPackage(original, firstUser);
			const { command } = yield* admittedCommand(installed, firstUser, "policy-race");
			const service = yield* EntitiesService;
			const entitySchema = { slug: bottle, owner: definitionOwner(installed.pluginId) };
			const created = yield* service.create({
				name: "Old",
				entitySchema,
				scope: "user",
				userId: firstUser,
				lifecycle: command,
				properties: { title: "Old" },
			});
			const newer = namespacePackage(original.manifest.metadata.packageId, "policy");
			const script = newer.scripts.find(({ metadata }) => metadata.kind === "automation");
			assert(script?.metadata.kind === "automation");
			const policy = {
				...script,
				slug: "whiskey.guard",
				contentHash: "whiskey-guard",
				entry: "backend/policy.sandbox.ts",
				metadata: {
					...script.metadata,
					capabilities: [],
					slug: "whiskey.guard",
					automationType: "policy" as const,
					inputProjection: { entity: { properties: ["title"] } },
				},
			};
			yield* installRevisionPackage(
				{
					...newer,
					scripts: [...newer.scripts, policy],
					manifest: {
						...newer.manifest,
						scripts: [...newer.manifest.scripts, { ...policy.metadata, entry: policy.entry }],
						hooks: [
							...newer.manifest.hooks,
							{
								name: "Guard",
								stage: "before",
								slug: "whiskey.guard",
								scriptSlug: policy.slug,
								targets: [{ resource: "entity", operation: "update", entitySchemaSlug: bottle }],
							},
						],
						entitySchemas: Array.from(newer.manifest.entitySchemas, (definition) => ({
							...definition,
							propertiesSchema: {
								fields: {
									...definition.propertiesSchema.fields,
									newer: { type: "string", label: "Newer", description: "Newer" },
								},
							},
						})),
					},
				},
				firstUser,
			);
			const execution = yield* LifecycleExecution;
			const repository = yield* EntitiesRepository;
			const session = yield* DatabaseSession;
			const oldWriter = yield* EntitiesService.make.pipe(
				Effect.provideService(LifecycleExecution, {
					...execution,
					executePolicy: () =>
						session
							.transaction(
								repository.updateEntity({
									populatedAt: null,
									name: "Concurrent",
									entityId: created.entity.id,
									properties: { newer: "present", title: "Concurrent" },
								}),
							)
							.pipe(Effect.as({ action: "allow" as const })),
				}),
			);
			expect(
				yield* Effect.flip(
					oldWriter.update({
						scope: "user",
						userId: firstUser,
						name: "Overwrite",
						populatedAt: null,
						entityId: created.entity.id,
						properties: { title: "Overwrite" },
						lifecycle: nextCommand(command, "race-update"),
					}),
				),
			).toMatchObject({ reason: { code: "mutation-conflict" } });
			expect((yield* service.getByIdAnyScope(created.entity.id)).properties).toEqual({
				newer: "present",
				title: "Concurrent",
			});
		}),
	);

	test.effect("preserves unknown properties deliberately allowed by the pinned declaration", () =>
		Effect.gen(function* () {
			const source = namespacePackage();
			const original = {
				...source,
				manifest: {
					...source.manifest,
					entitySchemas: Array.from(source.manifest.entitySchemas, (definition) => ({
						...definition,
						propertiesSchema: {
							...definition.propertiesSchema,
							unknownKeys: "passthrough" as const,
						},
					})),
				},
			};
			const installed = yield* installRevisionPackage(original, firstUser);
			const { command } = yield* admittedCommand(installed, firstUser, "passthrough-writer");
			const newer = namespacePackage(original.manifest.metadata.packageId, "passthrough");
			yield* installRevisionPackage(
				{
					...newer,
					manifest: {
						...newer.manifest,
						entitySchemas: Array.from(newer.manifest.entitySchemas, (definition) => ({
							...definition,
							propertiesSchema: {
								unknownKeys: "passthrough",
								fields: {
									...definition.propertiesSchema.fields,
									newer: { type: "string", label: "Newer", description: "Newer" },
								},
							},
						})),
					},
				},
				firstUser,
			);
			const entities = yield* EntitiesService;
			const entitySchema = { slug: bottle, owner: definitionOwner(installed.pluginId) };
			const properties = { title: "Old", newer: "Allowed", opaque: { value: 1 } };
			const created = yield* entities.create({
				properties,
				entitySchema,
				scope: "user",
				name: "Opaque",
				userId: firstUser,
				lifecycle: command,
			});
			expect(created.entity.properties).toEqual(properties);
			const updated = yield* entities.update({
				scope: "user",
				name: "Updated",
				userId: firstUser,
				populatedAt: null,
				entityId: created.entity.id,
				properties: { ...properties, title: "Updated" },
				lifecycle: nextCommand(command, "passthrough-update"),
			});
			expect(updated.entity.properties).toEqual({ ...properties, title: "Updated" });
		}),
	);

	test.effect(
		"accepts only the exact unfinished initialization binding, including hidden installs",
		() =>
			Effect.gen(function* () {
				const source = namespacePackage();
				const installed = yield* installRevisionPackage(
					{
						...source,
						manifest: {
							...source.manifest,
							userBootstrap: [
								{ slug: "initialize", description: "Initialize", scriptSlug: "whiskey.task" },
							],
						},
					},
					firstUser,
				);
				const runtime = yield* PluginRuntimeResolver;
				const script = yield* runtime.findScriptAvailableToUser(
					firstUser,
					installed.pluginId,
					"whiskey.task",
				);
				assert(script);
				const session = yield* DatabaseSession;
				const [row] = yield* session.run((db) =>
					db
						.select({ activationId: tables.plugin.activationId })
						.from(tables.plugin)
						.where(eq(tables.plugin.id, installed.pluginId)),
				);
				assert(row);
				const binding = {
					activationId: row.activationId,
					installationId: installed.installation.id,
				};
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ isHidden: true, health: "installing", isInitialized: false })
						.where(eq(tables.pluginInstallation.id, installed.installation.id)),
				);
				const subject = {
					userId: firstUser,
					type: "user" as const,
					accountGeneration: { userId: firstUser, token: "test-account-generation" },
				};
				const repository = yield* SandboxRepository.make;
				const pin = yield* repository.getScriptPin(script.id, undefined, subject, binding);
				assert(pin?.pluginRevision);
				const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
				const command: DomainLifecycleCommand = {
					...rootLifecycleCommand({
						lane: "background",
						source: "bootstrap",
						itemIdentity: "initialize",
						occurredAt: "2026-10-13T00:00:00.000Z",
						initiator: { kind: "user", id: firstUser },
						accountGeneration: subject.accountGeneration,
						executionId: AutomationExecutionId.make("namespace-initialization"),
					}),
					writeContext: principal,
				};
				const entities = yield* EntitiesService;
				const entitySchema = { slug: bottle, owner: definitionOwner(installed.pluginId) };
				const results = yield* entities.ensureUserEntities(
					firstUser,
					[{ entitySchema, name: "Seed", properties: { title: "Seed" } }],
					command,
				);
				expect(results).toMatchObject([{ wasInserted: true }]);
				expect(
					yield* Effect.flip(
						entities.ensureUserEntities(
							firstUser,
							[{ entitySchema, name: "Wrong", properties: {} }],
							{
								...nextCommand(command, "wrong-activation"),
								writeContext: {
									...principal,
									initialization: { ...binding, activationId: "foreign-activation" },
								},
							},
						),
					),
				).toMatchObject({ reason: { code: "mutation-conflict" } });
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ isInitialized: true })
						.where(eq(tables.pluginInstallation.id, binding.installationId)),
				);
				expect(
					yield* Effect.flip(
						entities.ensureUserEntities(
							firstUser,
							[{ entitySchema, properties: {}, name: "Completed" }],
							nextCommand(command, "completed-binding"),
						),
					),
				).toMatchObject({ reason: { code: "mutation-conflict" } });
			}),
	);

	test.effect(
		"continues captured ordinary installation work without bypassing quarantine or hidden intent",
		() =>
			Effect.gen(function* () {
				const installed = yield* installRevisionPackage(namespacePackage(), firstUser);
				const { command } = yield* admittedCommand(installed, firstUser, "historical-health");
				const session = yield* DatabaseSession;
				const entities = yield* EntitiesService;
				const entitySchema = { slug: bottle, owner: definitionOwner(installed.pluginId) };
				for (const health of ["installing", "needs-configuration"] as const) {
					yield* session.run((db) =>
						db
							.update(tables.pluginInstallation)
							.set({ health })
							.where(eq(tables.pluginInstallation.id, installed.installation.id)),
					);
					const result = yield* entities.create({
						entitySchema,
						name: health,
						scope: "user",
						userId: firstUser,
						properties: { title: health },
						lifecycle: nextCommand(command, health),
					});
					expect(result.entity.entitySchemaPluginId).toBe(installed.pluginId);
				}
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ isHidden: true, health: "ready" })
						.where(eq(tables.pluginInstallation.id, installed.installation.id)),
				);
				expect(
					yield* Effect.flip(
						entities.create({
							entitySchema,
							scope: "user",
							name: "Hidden",
							properties: {},
							userId: firstUser,
							lifecycle: nextCommand(command, "hidden"),
						}),
					),
				).toMatchObject({ reason: { code: "mutation-conflict" } });
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({
							isHidden: false,
							health: "incompatible",
							incompatibilityReason: "package-identity-conflict",
						})
						.where(eq(tables.pluginInstallation.id, installed.installation.id)),
				);
				expect(
					yield* Effect.flip(
						entities.create({
							entitySchema,
							scope: "user",
							properties: {},
							userId: firstUser,
							name: "Quarantined",
							lifecycle: nextCommand(command, "quarantined"),
						}),
					),
				).toMatchObject({ reason: { code: "mutation-conflict" } });
			}),
	);

	test.effect("rejects pinned declarations missing from the pinned or active revision", () =>
		Effect.gen(function* () {
			const original = namespacePackage();
			const installed = yield* installRevisionPackage(
				{
					...original,
					manifest: {
						...original.manifest,
						entitySchemas: [...original.manifest.entitySchemas, entityDeclaration("retired")],
					},
				},
				firstUser,
			);
			const { command } = yield* admittedCommand(installed, firstUser, "declaration-gaps");
			const newer = namespacePackage(original.manifest.metadata.packageId, "two");
			const [newerBottle, ...newerEntities] = newer.manifest.entitySchemas;
			assert(newerBottle?.slug === bottle);
			yield* installRevisionPackage(
				{
					...newer,
					manifest: {
						...newer.manifest,
						relationshipSchemas: [
							...newer.manifest.relationshipSchemas,
							{
								name: "Added",
								slug: "added-link",
								sourceEntitySchemaSlug: null,
								targetEntitySchemaSlug: null,
								propertiesSchema: { fields: {} },
							},
						],
						entitySchemas: [
							{
								...newerBottle,
								eventSchemas: [
									...newerBottle.eventSchemas,
									{ slug: "opened", name: "Opened", propertiesSchema: titleProperties },
								],
							},
							...newerEntities,
							entityDeclaration("added"),
						],
					},
				},
				firstUser,
			);
			const entities = yield* EntitiesService;
			const relationships = yield* RelationshipsService;
			const owner = definitionOwner(installed.pluginId);
			const create = (slug: string, itemIdentity: string) =>
				Effect.flip(
					entities.create({
						name: slug,
						scope: "user",
						userId: firstUser,
						properties: { title: slug },
						lifecycle: nextCommand(command, itemIdentity),
						entitySchema: { owner, slug: EntitySchemaSlug.make(slug) },
					}),
				);
			expect(yield* create("retired", "retired-entity")).toMatchObject({
				reason: {
					code: "mutation-conflict",
					message: "Pinned entity declaration has no active storage definition",
				},
			});
			expect(yield* create("added", "added-entity")).toMatchObject({
				reason: {
					code: "mutation-conflict",
					message: "Entity schema is not declared by the pinned writer",
				},
			});
			const own = yield* entities.create({
				name: "Own",
				scope: "user",
				userId: firstUser,
				properties: { title: "Own" },
				entitySchema: { owner, slug: bottle },
				lifecycle: nextCommand(command, "own-entity"),
			});
			const eventSchemaSlug = EventSchemaSlug.make("opened");
			const denied = yield* createEvents(
				nextCommand(command, "added-event"),
				firstUser,
				[{ eventSchemaSlug, entityId: own.entity.id, properties: { title: "Opened" } }],
				"added-event-workflow",
			);
			expect(denied.count).toBe(0);
			expect(denied.failure).toEqual({
				index: 0,
				reason: { eventSchemaSlug, code: "event-schema-not-found" },
			});
			expect(
				yield* Effect.flip(
					relationships.create(
						{
							scope: "user",
							properties: {},
							userId: firstUser,
							sourceEntityId: own.entity.id,
							targetEntityId: own.entity.id,
							relationshipSchema: { owner, slug: RelationshipSchemaSlug.make("added-link") },
						},
						nextCommand(command, "added-link"),
					),
				),
			).toMatchObject({ reason: { code: "concurrent-relationship-change" } });
		}),
	);

	test.effect("lets a user-scope provider upsert change an immutable property", () =>
		Effect.gen(function* () {
			const installed = yield* installRevisionPackage(namespacePackage(), firstUser);
			const { command, providerId } = yield* admittedCommand(
				installed,
				firstUser,
				"immutable-upsert",
			);
			const entities = yield* EntitiesService;
			const input = {
				providerId,
				name: "Bottle",
				populatedAt: null,
				userId: firstUser,
				updateExisting: true,
				scope: "user" as const,
				externalId: "immutable-bottle",
				properties: { code: "a", title: "Bottle" },
				entitySchema: { slug: bottle, owner: definitionOwner(installed.pluginId) },
			};
			yield* entities.upsert({ ...input, lifecycle: nextCommand(command, "immutable-create") });
			const updated = yield* entities.upsert({
				...input,
				properties: { code: "b", title: "Bottle" },
				lifecycle: nextCommand(command, "immutable-update"),
			});
			expect(updated.entity.properties).toEqual({ code: "b", title: "Bottle" });
		}),
	);

	test.effect("rejects pinned writes after session, plugin, installation, or account changes", () =>
		Effect.gen(function* () {
			const installed = yield* installRevisionPackage(namespacePackage(), firstUser);
			const foreignPlugin = yield* installRevisionPackage(namespacePackage(), firstUser);
			const { command } = yield* admittedCommand(installed, firstUser, "authority-changes");
			const foreignCommand = (yield* admittedCommand(foreignPlugin, firstUser, "foreign-session"))
				.command;
			const session = yield* DatabaseSession;
			const entities = yield* EntitiesService;
			const own = yield* entities.create({
				name: "Own",
				scope: "user",
				userId: firstUser,
				properties: { title: "Own" },
				lifecycle: nextCommand(command, "own-entity"),
				entitySchema: { slug: bottle, owner: definitionOwner(installed.pluginId) },
			});
			const foreign = yield* entities.create({
				scope: "user",
				name: "Foreign",
				userId: firstUser,
				lifecycle: foreignCommand,
				properties: { title: "Foreign" },
				entitySchema: { slug: bottle, owner: definitionOwner(foreignPlugin.pluginId) },
			});
			const denied = yield* createEvents(
				nextCommand(command, "foreign-session-event"),
				firstUser,
				[
					{
						entityId: own.entity.id,
						properties: { title: "Tasted" },
						sessionEntityId: foreign.entity.id,
						eventSchemaSlug: EventSchemaSlug.make("tasted"),
					},
				],
				"foreign-session-workflow",
			);
			expect(denied.count).toBe(0);
			expect(denied.failure).toEqual({
				index: 0,
				reason: { entityId: foreign.entity.id, code: "session-entity-not-found" },
			});
			const rejected = (itemIdentity: string, message: string) =>
				Effect.gen(function* () {
					expect(
						yield* Effect.flip(
							entities.create({
								scope: "user",
								userId: firstUser,
								name: itemIdentity,
								properties: { title: itemIdentity },
								lifecycle: nextCommand(command, itemIdentity),
								entitySchema: { slug: bottle, owner: definitionOwner(installed.pluginId) },
							}),
						),
					).toMatchObject({ reason: { message, code: "mutation-conflict" } });
				});
			const installationUnavailable = "Current domain write installation authority is unavailable";
			const setInstallation = (values: Partial<typeof tables.pluginInstallation.$inferInsert>) =>
				session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set(values)
						.where(eq(tables.pluginInstallation.id, installed.installation.id)),
				);
			yield* setInstallation({ ingestionRetiring: true });
			yield* rejected("retiring", installationUnavailable);
			yield* setInstallation({ ingestionRetiring: false, uninstalledAt: retiredAt });
			yield* rejected("uninstalled", installationUnavailable);
			yield* setInstallation({ uninstalledAt: null });
			yield* session.run((db) =>
				db
					.update(tables.user)
					.set({ accountGeneration: "rotated-account-generation" })
					.where(eq(tables.user.id, firstUser)),
			);
			yield* rejected("rotated-account", "Current domain write account authority is unavailable");
			yield* session.run((db) =>
				db
					.update(tables.user)
					.set({ accountGeneration: "test-account-generation" })
					.where(eq(tables.user.id, firstUser)),
			);
			yield* session.run((db) =>
				db
					.update(tables.plugin)
					.set({ status: "disabled" })
					.where(eq(tables.plugin.id, installed.pluginId)),
			);
			yield* rejected("disabled-plugin", "Pinned domain write authority is unavailable");
		}),
	);

	test.effect(
		"keeps complete private provider graphs and reconciliation isolated by user and local owner",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({
							id: secondUser,
							name: "Second",
							email: "second-namespace@example.test",
							accountGeneration: "test-account-generation",
						}),
				);
				const source = namespacePackage();
				const first = yield* installRevisionPackage(source, firstUser);
				const second = yield* installRevisionPackage(source, secondUser);
				const firstAdmission = yield* admittedCommand(first, firstUser, "first-private-graph");
				const secondAdmission = yield* admittedCommand(second, secondUser, "second-private-graph");
				const details = {
					name: "Bottle",
					properties: { title: "Bottle" },
					expectedChildEntitySchemaSlug: "part",
					relatedEntityGroups: [
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "credits",
							entities: [
								{
									name: "Related",
									externalId: "shared-related",
									properties: { title: "Related" },
									providerSlug: "whiskey-provider",
								},
							],
						},
					],
					childEntities: [
						{
							name: "Part",
							entitySchemaSlug: "part",
							externalId: "shared-part",
							properties: { title: "Part" },
							expectedChildEntitySchemaSlug: "section",
							childEntities: [
								{
									name: "Section",
									entitySchemaSlug: "section",
									externalId: "shared-section",
									properties: { title: "Section" },
								},
							],
						},
					],
				};
				const populate = (
					installed: typeof first,
					admission: typeof firstAdmission,
					userId: UserId,
					value: unknown,
					executionId: string,
					mode: "ensure" | "refresh",
				) => {
					const instance = WorkflowInstance.initial(
						ProviderEntityPopulationAttemptWorkflow,
						executionId,
					);
					return runProviderEntityPopulationAttemptWorkflow(
						{
							mode,
							executionId,
							level: "full",
							requestId: executionId,
							entitySchemaSlug: bottle,
							externalId: "shared-root",
							providerId: admission.providerId,
							entityScope: { userId, type: "user" },
							pluginId: PluginId.make(installed.pluginId),
							command: nextCommand(admission.command, executionId),
						},
						executionId,
					).pipe(
						Effect.provideService(WorkflowInstance, instance),
						Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
						Effect.provideService(
							RedisService,
							makeRedisService({ publish: () => Effect.succeed(1) }),
						),
						Effect.provideService(EntityImportWorkflowOperations, {
							processRelatedPage: () => Effect.die("unused"),
							completeProviderEntityImport: () => Effect.void,
							requireRelatedScript: () => Effect.die("unused"),
							processProviderResolve: () => Effect.die("Unexpected provider resolve"),
							preRegisterProviderImport: () => Effect.die("Unexpected provider pre-registration"),
							processSandbox: () =>
								Effect.succeed({ value, logs: [], error: null, status: "completed" }),
						}),
					);
				};
				const firstRoot = yield* populate(
					first,
					firstAdmission,
					firstUser,
					details,
					"first-private-graph",
					"ensure",
				);
				const secondRoot = yield* populate(
					second,
					secondAdmission,
					secondUser,
					details,
					"second-private-graph",
					"ensure",
				);
				expect(firstRoot.id).not.toBe(secondRoot.id);
				const rows = yield* session.run((db) =>
					db.select().from(tables.entity).where(eq(tables.entity.entitySchemaSlug, "bottle")),
				);
				expect(
					rows.filter(
						({ userId, entitySchemaPluginId }) =>
							userId === firstUser && entitySchemaPluginId === first.pluginId,
					),
				).toHaveLength(2);
				expect(
					rows.filter(
						({ userId, entitySchemaPluginId }) =>
							userId === secondUser && entitySchemaPluginId === second.pluginId,
					),
				).toHaveLength(2);
				expect(rows.some(({ userId }) => userId === null)).toBe(false);
				const nested = yield* session.run((db) =>
					db.select().from(tables.entity).where(eq(tables.entity.entitySchemaSlug, "section")),
				);
				expect(
					nested
						.map(({ userId, entitySchemaPluginId }) => [userId, entitySchemaPluginId])
						.sort(
							(left, right) =>
								String(left[0]).localeCompare(String(right[0])) ||
								String(left[1]).localeCompare(String(right[1])),
						),
				).toEqual(
					[
						[firstUser, first.pluginId],
						[secondUser, second.pluginId],
					].sort(
						(left, right) =>
							String(left[0]).localeCompare(String(right[0])) ||
							String(left[1]).localeCompare(String(right[1])),
					),
				);
				yield* populate(
					first,
					firstAdmission,
					firstUser,
					{
						name: "Bottle",
						childEntities: [],
						properties: { title: "Refreshed" },
						expectedChildEntitySchemaSlug: "part",
					},
					"first-refresh",
					"refresh",
				);
				const firstLinks = yield* session.run((db) =>
					db
						.select()
						.from(tables.relationship)
						.where(
							and(
								eq(tables.relationship.userId, firstUser),
								eq(tables.relationship.relationshipSchemaPluginId, first.pluginId),
								eq(tables.relationship.relationshipSchemaSlug, "bottle-part"),
							),
						),
				);
				const secondLinks = yield* session.run((db) =>
					db
						.select()
						.from(tables.relationship)
						.where(
							and(
								eq(tables.relationship.userId, secondUser),
								eq(tables.relationship.relationshipSchemaPluginId, second.pluginId),
								eq(tables.relationship.relationshipSchemaSlug, "bottle-part"),
							),
						),
				);
				expect(firstLinks).toEqual([]);
				expect(secondLinks).toHaveLength(1);
			}),
	);
});

layer(relationshipDatabaseLayer())((test) => {
	test.effect(
		"checks every batch write authority key and reads provider rows only in the writer's scope",
		() =>
			Effect.gen(function* () {
				const installed = yield* installRevisionPackage(namespacePackage(), firstUser);
				const foreign = yield* installRevisionPackage(namespacePackage(), firstUser);
				const { command, providerId } = yield* admittedCommand(
					installed,
					firstUser,
					"batch-authority",
				);
				const entities = yield* EntitiesService;
				const session = yield* DatabaseSession;
				const otherUser = UserId.make("batch-scope-owner");
				const ownSchema = { slug: bottle, owner: definitionOwner(installed.pluginId) };
				const item = (externalId: string) => ({
					providerId,
					externalId,
					name: externalId,
					populatedAt: null,
					userId: firstUser,
					updateExisting: false,
					scope: "user" as const,
					entitySchema: ownSchema,
					properties: { title: externalId },
					lifecycle: nextCommand(command, externalId),
				});
				const write = (items: ReadonlyArray<UpsertEntityInput>) =>
					session.transaction(
						entities.persistPlannedProviderUpserts({
							items,
							batch: { command, identity: ["authority"] },
						}),
					);
				const { userId: _userId, ...globalItem } = item("global");
				const kernelSchema = { slug: bottle, owner: { kind: "kernel" as const } };
				for (const [items, reason] of [
					[
						[
							item("own"),
							{
								...item("foreign"),
								entitySchema: { slug: bottle, owner: definitionOwner(foreign.pluginId) },
							},
						],
						{ code: "owner-mismatch" },
					],
					[
						[item("own"), { ...globalItem, scope: "global" as const }],
						{ code: "global-scope-forbidden" },
					],
					[
						[item("own"), { ...item("other-user"), userId: otherUser }],
						{
							code: "mutation-conflict",
							message: "Domain write authority does not match the stored owner or scope",
						},
					],
					[
						[
							{
								...item("collection"),
								entitySchema: kernelSchema,
								lifecycle: kernelCollectionLifecycleCommand(nextCommand(command, "collection")),
							},
							{ ...item("kernel"), entitySchema: kernelSchema },
						],
						{ code: "owner-mismatch" },
					],
				] satisfies ReadonlyArray<[ReadonlyArray<UpsertEntityInput>, object]>) {
					expect(yield* Effect.flip(write(items))).toMatchObject({ reason });
				}
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ ingestionRetiring: true })
						.where(eq(tables.pluginInstallation.id, installed.installation.id)),
				);
				expect(yield* Effect.flip(write([item("retiring")]))).toMatchObject({
					reason: {
						code: "mutation-conflict",
						message: "Current domain write installation authority is unavailable",
					},
				});
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ ingestionRetiring: false })
						.where(eq(tables.pluginInstallation.id, installed.installation.id)),
				);
				yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({
							id: otherUser,
							name: "Other",
							email: "batch-scope@example.test",
							accountGeneration: "test-account-generation",
						}),
				);
				const shared = (id: string, userId: UserId | null) => ({
					id,
					userId,
					name: id,
					providerId,
					externalId: "shared",
					populatedAt: retiredAt,
					entitySchemaSlug: bottle,
					properties: { title: id },
					entitySchemaPluginId: installed.pluginId,
				});
				yield* session.run((db) =>
					db
						.insert(tables.entity)
						.values([shared("second-shared", otherUser), shared("global-shared", null)]),
				);
				const created = yield* write([item("shared")]);
				const [result] = created.results;
				assert(result);
				expect(["second-shared", "global-shared"]).not.toContain(result.entity.id);
				expect(yield* write([item("shared")])).toEqual(created);
				const rows = yield* session.run((db) =>
					db.select().from(tables.entity).where(eq(tables.entity.externalId, "shared")),
				);
				expect(rows.map(({ id }) => id).sort()).toEqual(
					[result.entity.id, "global-shared", "second-shared"].sort(),
				);
				expect(
					yield* session.run((db) =>
						db
							.select()
							.from(tables.entity)
							.where(
								and(
									eq(tables.entity.userId, firstUser),
									eq(tables.entity.entitySchemaPluginId, installed.pluginId),
								),
							),
					),
				).toHaveLength(1);
			}),
	);
});

layer(relationshipDatabaseLayer())((test) => {
	test.effect("scopes batch event updates and deletes to the writer's plugin and user", () =>
		Effect.gen(function* () {
			yield* ensureKernelCollections;
			const session = yield* DatabaseSession;
			const otherUser = UserId.make("batch-event-other-user");
			yield* session.run((db) =>
				db
					.insert(tables.user)
					.values({
						id: otherUser,
						name: "Other",
						email: "batch-event-other@example.test",
						accountGeneration: "test-account-generation",
					}),
			);
			const a = yield* installRevisionPackage(namespacePackage(), firstUser);
			const b = yield* installRevisionPackage(namespacePackage(), firstUser);
			const c = yield* installRevisionPackage(namespacePackage(), otherUser);
			const entities = yield* EntitiesService;
			const events = yield* EventsService;
			const writer = yield* admittedCommand(a, firstUser, "batch-event-a");
			const foreignWriter = yield* admittedCommand(b, firstUser, "batch-event-b");
			const otherWriter = yield* admittedCommand(c, otherUser, "batch-event-c");
			const tasted = EventSchemaSlug.make("tasted");
			const recordEvent = Effect.fnUntraced(function* (
				command: DomainLifecycleCommand,
				userId: UserId,
				entity: { readonly entitySchema: UpsertEntityInput["entitySchema"] } | "collection",
				eventSchemaSlug: EventSchemaSlug,
				identity: string,
			) {
				const created = yield* entities.create({
					userId,
					scope: "user",
					name: identity,
					properties: entity === "collection" ? {} : { title: identity },
					entitySchema:
						entity === "collection"
							? { owner: { kind: "kernel" }, slug: EntitySchemaSlug.make("collection") }
							: entity.entitySchema,
					lifecycle:
						entity === "collection"
							? kernelCollectionLifecycleCommand(nextCommand(command, `${identity}-entity`))
							: nextCommand(command, `${identity}-entity`),
				});
				const eventCommand = nextCommand(command, `${identity}-event`);
				yield* createEvents(
					entity === "collection" ? kernelCollectionLifecycleCommand(eventCommand) : eventCommand,
					userId,
					[{ eventSchemaSlug, entityId: created.entity.id, properties: { text: identity } }],
					`${identity}-workflow`,
				);
				const [row] = yield* session.run((db) =>
					db.select().from(tables.event).where(eq(tables.event.entityId, created.entity.id)),
				);
				assert(row);
				return EventId.make(row.id);
			});
			const ownSchema = (installed: typeof a) => ({
				entitySchema: { slug: bottle, owner: definitionOwner(installed.pluginId) },
			});
			const foreignEvent = yield* recordEvent(
				foreignWriter.command,
				firstUser,
				ownSchema(b),
				tasted,
				"foreign",
			);
			const collectionReview = yield* recordEvent(
				writer.command,
				firstUser,
				"collection",
				EventSchemaSlug.make("review"),
				"collection-review",
			);
			const otherUsersEvent = yield* recordEvent(
				otherWriter.command,
				otherUser,
				ownSchema(c),
				tasted,
				"other-user",
			);
			const storedProperties = session
				.run((db) =>
					db
						.select({ id: tables.event.id, properties: tables.event.properties })
						.from(tables.event)
						.where(inArray(tables.event.id, [foreignEvent, collectionReview, otherUsersEvent])),
				)
				.pipe(Effect.map((rows) => sortBy(rows, "id")));
			const before = yield* storedProperties;
			expect(before).toHaveLength(3);
			for (const eventId of [foreignEvent, collectionReview]) {
				expect(
					yield* Effect.flip(
						events.updateBatch(
							[{ eventId, patch: { properties: { remove: [], set: { text: "Wrong" } } } }],
							firstUser,
							nextCommand(writer.command, `update-${eventId}`),
						),
					),
				).toMatchObject({ reason: { code: "owner-mismatch" } });
				expect(
					yield* Effect.flip(
						events.deleteBatch(
							[eventId],
							firstUser,
							nextCommand(writer.command, `delete-${eventId}`),
						),
					),
				).toMatchObject({ reason: { code: "owner-mismatch" } });
			}
			expect(
				yield* Effect.flip(
					events.updateBatch(
						[
							{
								eventId: otherUsersEvent,
								patch: { properties: { remove: [], set: { text: "Wrong" } } },
							},
						],
						firstUser,
						nextCommand(writer.command, "update-other-user"),
					),
				),
			).toMatchObject({ reason: { code: "event-not-found" } });
			expect(
				yield* events.deleteBatch(
					[otherUsersEvent],
					firstUser,
					nextCommand(writer.command, "delete-other-user"),
				),
			).toMatchObject({ count: 0 });
			expect(yield* storedProperties).toEqual(before);
		}),
	);
});
