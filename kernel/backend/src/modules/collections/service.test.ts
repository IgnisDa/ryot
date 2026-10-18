import { expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	type CollectionField,
	decodeCollectionFields,
} from "@ryot-app/contract/modules/collections/fields";
import {
	CollectionBadRequest,
	CollectionNotFound,
	type CreateMembershipBody,
} from "@ryot-app/contract/modules/collections/schemas";
import {
	EntityBadRequest,
	EntityNotFound,
	EntityStale,
} from "@ryot-app/contract/modules/entities/schemas";
import type { CreateEventsResponse } from "@ryot-app/contract/modules/events/schemas";
import type { EntitySchemaReference } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	AutomationTriggerId,
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginConfigRevisionId,
	PluginId,
	PluginPackageId,
	PluginRevisionId,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Context, Effect, Layer, Ref, Result } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecyclePlanner } from "#modules/automations/lifecycle/planning";
import { RelationshipSchemaReader } from "#modules/definitions/relationship-schemas";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import {
	type DomainLifecycleCommand,
	kernelCollectionLifecycleCommand,
} from "#modules/entities/write-context";
import { mutationAdmissionTestLayer } from "#modules/mutations/admission.test-support";
import { RelationshipsService } from "#modules/relationships/service";
import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { makeWorkflowActivityEngine, type MockOverrides } from "#testing/effect";

import { CollectionMembershipWorkflow } from "./collection-membership-workflow";
import {
	CollectionMembershipWorkflowOperationsLive,
	runCollectionMembershipWorkflow,
} from "./collection-membership-workflow-live";
import { CollectionsRepository } from "./repository";
import { childCollectionLifecycleCommand, CollectionsService } from "./service";

const now = "2026-06-14T00:00:00.000Z";
const user: CurrentUserValue = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { language: null, disableIntegrations: false },
	accountGeneration: { userId: UserId.make("user-id"), token: "test-account-generation" },
};
const collectionId = EntityId.make("collection-id");
const entityId = EntityId.make("entity-id");
const relationshipId = RelationshipId.make("relationship-id");
const warning = {
	omittedHooks: [],
	hasRequiredHooks: false,
	code: "automation-limit-reached",
	triggerId: AutomationTriggerId.make("trigger-id"),
} as const satisfies AutomationWarning;
const collectionEntity = {
	createdAt: now,
	updatedAt: now,
	properties: {},
	id: collectionId,
	externalId: null,
	providerId: null,
	name: "Favorites",
	populatedAt: null,
	entitySchemaPluginId: null,
	entitySchemaSlug: EntitySchemaSlug.make("collection"),
};
const membership = {
	createdAt: now,
	properties: {},
	wasInserted: true,
	id: relationshipId,
	sourceEntityId: entityId,
	targetEntityId: collectionId,
	relationshipSchemaPluginId: null,
	relationshipSchemaSlug: RelationshipSchemaSlug.make("member-of"),
};
const memberOfSchema = {
	pluginId: null,
	isBuiltin: true,
	slug: "member-of",
	name: "Member Of",
	sourceEntitySchemaSlug: null,
	targetEntitySchemaSlug: null,
	id: RelationshipSchemaSlug.make("member-of"),
	propertiesSchema: { fields: {}, unknownKeys: "passthrough" as const },
};
const collectionPropertiesSchema = {
	fields: {
		description: { label: "Description", type: "string" as const, description: "Description" },
		membershipFields: {
			type: "array" as const,
			label: "Membership Fields",
			description: "Membership Fields",
			items: {
				properties: {},
				label: "Field",
				description: "Field",
				type: "object" as const,
				unknownKeys: "passthrough" as const,
			},
		},
	},
} satisfies AppSchema;
const collectionEntitySchema = {
	id: EntitySchemaSlug.make("collection"),
	propertiesSchema: collectionPropertiesSchema,
	entitySchemaSlug: EntitySchemaSlug.make("collection"),
	entitySchema: {
		owner: { kind: "kernel" },
		slug: EntitySchemaSlug.make("collection"),
	} satisfies EntitySchemaReference,
};
const addEventSchema = {
	pluginId: null,
	name: "Add Entity to Collection",
	slug: "add-entity-to-collection",
	propertiesSchema: { fields: {} },
	id: EventSchemaSlug.make("add-event-schema-id"),
};
const removeEventSchema = {
	pluginId: null,
	propertiesSchema: { fields: {} },
	name: "Remove Entity from Collection",
	slug: "remove-entity-from-collection",
	id: EventSchemaSlug.make("remove-event-schema-id"),
};
const noteFields = [{ key: "note", type: "text", label: "Note", required: false }];
const noteCollection = {
	...collectionEntity,
	properties: { description: "Notes", membershipFields: noteFields },
};

const membershipPlan = {
	runs: [],
	blockedReason: null,
	triggerId: AutomationTriggerId.make("membership-trigger"),
};
const committedRelationship: Effect.Success<
	ReturnType<RelationshipsService["Service"]["prepareCreate"]>
> = {
	_tag: "Committed" as const,
	dispatch: [membershipPlan],
	result: { operation: "create", relationship: { ...membership, updatedAt: now } },
};
const committedDeletion: Effect.Success<
	ReturnType<RelationshipsService["Service"]["prepareDeleteUserRelationshipById"]>
> = {
	_tag: "Committed" as const,
	dispatch: [membershipPlan],
	result: {
		operation: "delete",
		relationship: {
			...membership,
			updatedAt: now,
			wasInserted: false,
			properties: { rank: 3, note: "kept" },
		},
	},
};

const mockCollections = Layer.mock(CollectionsRepository);
const mockEntities = Layer.mock(EntitiesService);
const mockRelationships = Layer.mock(RelationshipsService);
const mockRelationshipSchemas = Layer.mock(RelationshipSchemaReader);

type EntityCreateInput = Parameters<EntitiesService["Service"]["create"]>[0];
type EntityUpdateInput = Parameters<EntitiesService["Service"]["update"]>[0];
type EntityDeleteCall = Parameters<EntitiesService["Service"]["deleteByIds"]>;
type WorkflowDispatch = { readonly payload: unknown; readonly executionId: string };
type RelationshipCreateInput = Parameters<RelationshipsService["Service"]["prepareCreate"]>[0];

class CollectionCalls extends Context.Service<
	CollectionCalls,
	{
		readonly deletedEntities: Effect.Effect<ReadonlyArray<EntityDeleteCall>>;
		readonly createdEntities: Effect.Effect<ReadonlyArray<EntityCreateInput>>;
		readonly updatedEntities: Effect.Effect<ReadonlyArray<EntityUpdateInput>>;
		readonly workflowDispatches: Effect.Effect<ReadonlyArray<WorkflowDispatch>>;
		readonly relationshipInputs: Effect.Effect<ReadonlyArray<RelationshipCreateInput>>;
		readonly lifecycleCommands: Effect.Effect<Readonly<Record<string, DomainLifecycleCommand>>>;
		readonly dispatchedTriggers: Effect.Effect<ReadonlyArray<ReadonlyArray<AutomationTriggerId>>>;
	}
>()("test/CollectionCalls") {}

const membershipWorkflowExecutionId = "membership-workflow-execution-id";

const makeServiceLayer = (
	options: {
		readonly entities?: MockOverrides<typeof mockEntities>;
		readonly collections?: MockOverrides<typeof mockCollections>;
		readonly relationships?: MockOverrides<typeof mockRelationships>;
		readonly workflow?: {
			readonly eventFailure?: unknown;
			readonly eventResult?: CreateEventsResponse;
			readonly warnings?: ReadonlyArray<AutomationWarning>;
		};
	} = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const createdEntities = yield* Ref.make<ReadonlyArray<EntityCreateInput>>([]);
			const updatedEntities = yield* Ref.make<ReadonlyArray<EntityUpdateInput>>([]);
			const deletedEntities = yield* Ref.make<ReadonlyArray<EntityDeleteCall>>([]);
			const relationshipInputs = yield* Ref.make<ReadonlyArray<RelationshipCreateInput>>([]);
			const workflowDispatches = yield* Ref.make<ReadonlyArray<WorkflowDispatch>>([]);
			const lifecycleCommands = yield* Ref.make<Readonly<Record<string, DomainLifecycleCommand>>>(
				{},
			);
			const dispatchedTriggers = yield* Ref.make<ReadonlyArray<ReadonlyArray<AutomationTriggerId>>>(
				[],
			);
			const recordCommand = (operation: string, command: DomainLifecycleCommand) =>
				Ref.update(lifecycleCommands, (all) => ({ ...all, [operation]: command }));
			const entities = {
				deleteByIds: () => Effect.succeed({ warnings: [], deletedCount: 1 }),
				create: () => Effect.succeed({ warnings: [], entity: collectionEntity }),
				update: () => Effect.succeed({ warnings: [], entity: collectionEntity }),
				...options.entities,
			};
			const relationships = {
				prepareCreate: () => Effect.succeed(committedRelationship),
				prepareDeleteUserRelationshipById: () => Effect.succeed(committedDeletion),
				...options.relationships,
			};
			const workflow = options.workflow ?? {};
			const instance = WorkflowInstance.initial(
				CollectionMembershipWorkflow,
				membershipWorkflowExecutionId,
			);
			const engine = makeWorkflowActivityEngine(instance, {
				execute: (_workflow, execution) =>
					Ref.update(workflowDispatches, (all) => [
						...all,
						{ payload: execution.payload, executionId: execution.executionId },
					]).pipe(
						Effect.andThen(
							workflow.eventFailure
								? Effect.fail(workflow.eventFailure)
								: Effect.succeed(
										workflow.eventResult ?? { count: 1, warnings: [], outcomes: [], failure: null },
									),
						),
					),
			});
			const dependencies = Layer.mergeAll(
				Layer.mock(LifecyclePlanner)({ plan: () => Effect.die("unused") }),
				Layer.mock(LifecycleExecution)({
					after: () => Effect.die("unused"),
					executePolicy: () => Effect.die("unused"),
					skipQueuedPolicies: () => Effect.die("unused"),
					dispatch: (plans) =>
						Ref.update(dispatchedTriggers, (all) => [
							...all,
							plans.map(({ triggerId }) => triggerId),
						]).pipe(Effect.as(plans.length > 0 ? (workflow.warnings ?? []) : [])),
				}),
				Layer.mock(EntitiesRepository)({}),
				mockEntities({
					...entities,
					create: (input) =>
						Ref.update(createdEntities, (all) => [...all, input]).pipe(
							Effect.andThen(entities.create(input)),
						),
					update: (input) =>
						Ref.update(updatedEntities, (all) => [...all, input]).pipe(
							Effect.andThen(entities.update(input)),
						),
					deleteByIds: (ids, lifecycle, target) =>
						Ref.update(deletedEntities, (all): ReadonlyArray<EntityDeleteCall> => [
							...all,
							[ids, lifecycle, target],
						]).pipe(Effect.andThen(entities.deleteByIds(ids, lifecycle, target))),
				}),
				mockRelationships({
					...relationships,
					prepareCreate: (input, lifecycle) =>
						Ref.update(relationshipInputs, (all) => [...all, input]).pipe(
							Effect.andThen(recordCommand("relationships.prepareCreate", lifecycle)),
							Effect.andThen(relationships.prepareCreate(input, lifecycle)),
						),
					prepareDeleteUserRelationshipById: (userId, id, lifecycle) =>
						recordCommand("relationships.prepareDeleteUserRelationshipById", lifecycle).pipe(
							Effect.andThen(
								relationships.prepareDeleteUserRelationshipById(userId, id, lifecycle),
							),
						),
				}),
				mockCollections({
					findMembership: () => Effect.succeed(null),
					findLowestMemberRank: () => Effect.succeed(null),
					findCollectionByNameForUser: () => Effect.succeed(null),
					getCollectionById: () => Effect.succeed(collectionEntity),
					getBuiltinCollectionSchema: () => Effect.succeed(collectionEntitySchema),
					findBuiltinEventSchemaBySlug: (reference) =>
						Effect.succeed(
							reference.slug === "add-entity-to-collection" ? addEventSchema : removeEventSchema,
						),
					getEntityForMembership: () =>
						Effect.succeed({
							id: entityId,
							userId: user.id,
							entitySchemaSlug: "record",
							entitySchemaPluginId: "foreign-plugin",
						}),
					...options.collections,
				}),
				mockRelationshipSchemas({ findKernelBySlug: () => Effect.succeed(memberOfSchema) }),
				Layer.succeed(WorkflowEngine, engine),
				Layer.succeed(WorkflowInstance, instance),
				Layer.succeed(CollectionCalls, {
					createdEntities: Ref.get(createdEntities),
					updatedEntities: Ref.get(updatedEntities),
					deletedEntities: Ref.get(deletedEntities),
					lifecycleCommands: Ref.get(lifecycleCommands),
					relationshipInputs: Ref.get(relationshipInputs),
					workflowDispatches: Ref.get(workflowDispatches),
					dispatchedTriggers: Ref.get(dispatchedTriggers),
				}),
			);
			return CollectionMembershipWorkflowOperationsLive.pipe(
				Layer.provideMerge(CollectionsService.layer),
				Layer.provideMerge(dependencies),
				Layer.provideMerge(mutationAdmissionTestLayer),
			);
		}),
	);

const command = (
	executionId: string,
	itemIdentity = "collection:add-membership",
): DomainLifecycleCommand => ({
	...rootLifecycleCommand({
		itemIdentity,
		source: "api",
		occurredAt: now,
		lane: "interactive",
		initiator: { id: user.id, kind: "user" },
		accountGeneration: user.accountGeneration,
		executionId: AutomationExecutionId.make(executionId),
	}),
	writeContext: null,
});

const sandboxWriteContext = {
	providerId: null,
	scriptSlug: "collection",
	contentHash: "collection-hash",
	metadata: { kind: "workflow", runtimeImports: [] },
	scriptId: SandboxScriptId.make("collection-script"),
	subject: { type: "user", userId: user.id, accountGeneration: user.accountGeneration },
	pluginRevision: {
		scope: "user",
		ownerId: user.id,
		configSchema: { fields: {} },
		userBootstrapScriptSlugs: [],
		id: PluginId.make("collection-plugin"),
		compiledHashes: { collection: "collection-hash" },
		workflowScripts: { collection: "collection-hash" },
		packageId: PluginPackageId.make("test/collections"),
		revisionId: PluginRevisionId.make("collection-revision"),
		configRevisionId: PluginConfigRevisionId.make("collection-config"),
		schemaScope: {
			eventSchemas: [],
			signalSchemaSlugs: [],
			entitySchemaSlugs: [],
			relationshipSchemaSlugs: [],
		},
	},
} satisfies ScriptExecutionPrincipal;

const runMembershipWorkflow = (
	options: {
		readonly properties?: unknown;
		readonly operation?: "add" | "remove";
		readonly lifecycle?: DomainLifecycleCommand;
		readonly mode?: CreateMembershipBody["mode"];
	} = {},
) =>
	runCollectionMembershipWorkflow(
		{
			entityId,
			collectionId,
			userId: user.id,
			operation: options.operation ?? "add",
			executionId: membershipWorkflowExecutionId,
			command: options.lifecycle ?? command(membershipWorkflowExecutionId),
			...(options.mode === undefined ? {} : { mode: options.mode }),
			...(options.properties === undefined ? {} : { properties: options.properties }),
		},
		membershipWorkflowExecutionId,
	);

const createCommand = command("collection:create", "collection:create");
const updateCommand = command("collection:update", "collection:update");
const deleteCommand = command("collection:delete", "collection:delete");

const allFields: ReadonlyArray<CollectionField> = [
	{ type: "text", label: "Text", required: true, description: "Text", defaultValue: "kept" },
	{ type: "number", label: "Number", required: false, defaultValue: 4.5 },
	{ type: "boolean", required: false, label: "Boolean", defaultValue: false },
	{ type: "date", label: "Date", required: false, defaultValue: "2026-01-01" },
	{ required: false, type: "datetime", label: "Datetime", defaultValue: "2026-01-01T00:00:00Z" },
	{ type: "choice", label: "Choice", required: false, defaultValue: "B", choices: ["A", "B"] },
	{
		label: "Multi",
		required: false,
		choices: ["A", "B"],
		defaultValue: ["B"],
		type: "multi-choice",
	},
	{ label: "List", required: false, type: "text-list", defaultValue: ["kept"] },
];

const propertyRecord = (properties: unknown): Record<string, unknown> =>
	isObjectRecord(properties) ? properties : {};

layer(
	Layer.unwrap(
		Effect.gen(function* () {
			const properties = yield* Ref.make<Record<string, unknown>>({});
			return makeServiceLayer({
				collections: {
					getCollectionById: () =>
						Ref.get(properties).pipe(
							Effect.map((stored) => ({ ...collectionEntity, properties: stored })),
						),
				},
				entities: {
					create: (input) =>
						Ref.set(properties, propertyRecord(input.properties)).pipe(
							Effect.as({ warnings: [], entity: collectionEntity }),
						),
					update: (input) =>
						Ref.set(properties, propertyRecord(input.properties)).pipe(
							Effect.as({ warnings: [], entity: collectionEntity }),
						),
				},
			});
		}),
	),
)((test) => {
	test.effect(
		"reloads and edits every persisted field type, retaining order, defaults and description intent",
		() =>
			Effect.gen(function* () {
				const service = yield* CollectionsService;
				const calls = yield* CollectionCalls;
				yield* service.create(user, { fields: allFields, name: "All fields" }, createCommand);
				const [created] = yield* calls.createdEntities;
				const stored = Result.getOrThrow(
					decodeCollectionFields(propertyRecord(created?.properties)["membershipFields"]),
				);
				expect(stored).toEqual(
					allFields.map((field) => Object.assign({ key: field.label.toLowerCase() }, field)),
				);
				yield* service.update(
					user,
					{ collectionId, description: null, name: "All fields", fields: stored.toReversed() },
					updateCommand,
				);
				const [updated] = yield* calls.updatedEntities;
				expect(updated?.properties).toEqual({ membershipFields: stored.toReversed() });
				yield* runMembershipWorkflow();
				const [member] = yield* calls.relationshipInputs;
				expect(member?.properties).toEqual({
					rank: 0,
					number: 4.5,
					choice: "B",
					text: "kept",
					multi: ["B"],
					boolean: false,
					list: ["kept"],
					date: "2026-01-01",
					datetime: "2026-01-01T00:00:00Z",
				});
			}),
	);
});

const updatePayload = {
	collectionId,
	name: "Renamed",
	description: "Fresh description",
	fields: [{ label: "Rating", required: false, type: "number" as const }],
};

layer(makeServiceLayer())((test) => {
	test.effect("rejects creating a collection with an empty name", () =>
		Effect.gen(function* () {
			const service = yield* CollectionsService;
			const exit = yield* Effect.exit(service.create(user, { name: "  " }, createCommand));
			assertExitFails(
				exit,
				new CollectionBadRequest({ reason: { field: "name", code: "name-required" } }),
			);
		}),
	);

	test.effect("persists normalized ordered member fields on create", () =>
		Effect.gen(function* () {
			yield* (yield* CollectionsService).create(
				user,
				{
					name: "  Wishlist  ",
					description: "Things to get",
					fields: [
						{ type: "date", required: true, label: "Owned On" },
						{
							type: "choice",
							label: "Format",
							required: false,
							defaultValue: "Vinyl",
							choices: [" Vinyl ", "CD"],
						},
					],
				},
				createCommand,
			);
			const [input] = yield* (yield* CollectionCalls).createdEntities;
			expect(input?.name).toBe("Wishlist");
			expect(input?.properties).toEqual({
				description: "Things to get",
				membershipFields: [
					{ type: "date", required: true, key: "owned-on", label: "Owned On" },
					{
						key: "format",
						type: "choice",
						label: "Format",
						required: false,
						defaultValue: "Vinyl",
						choices: ["Vinyl", "CD"],
					},
				],
			});
		}),
	);

	test.effect("rejects reserved, invented, and unsupported member fields on create", () =>
		Effect.gen(function* () {
			const service = yield* CollectionsService;
			const calls = yield* CollectionCalls;
			const before = yield* calls.createdEntities;
			const create = (fields: Parameters<typeof service.create>[1]["fields"]) =>
				Effect.exit(service.create(user, { fields, name: "Fields" }, createCommand));
			assertExitFails(
				yield* create([{ key: "rank", label: "Rank", type: "number", required: false }]),
				new CollectionBadRequest({
					reason: { code: "reserved-field-key", paths: [["fields", "0", "key"]] },
				}),
			);
			assertExitFails(
				yield* create([{ type: "text", label: "Note", key: "invented", required: false }]),
				new CollectionBadRequest({
					reason: { code: "invalid-fields", paths: [["fields", "0", "key"]] },
				}),
			);
			assertExitFails(
				yield* create([
					{ type: "choice", label: "Format", required: false },
					{ type: "text", label: "Note", choices: ["a"], required: false },
					{ type: "text", required: false, label: "x".repeat(101) },
					{ label: "Tags", required: false, type: "multi-choice", choices: ["a", " a"] },
					{ label: "Count", type: "number", required: false, defaultValue: "many" },
				]),
				new CollectionBadRequest({
					reason: {
						code: "invalid-fields",
						paths: [
							["fields", "0", "choices"],
							["fields", "1", "choices"],
							["fields", "2", "label"],
							["fields", "3", "choices"],
						],
					},
				}),
			);
			assertExitFails(
				yield* create([{ label: "Count", type: "number", required: false, defaultValue: "many" }]),
				new CollectionBadRequest({
					reason: { code: "invalid-fields", paths: [["fields", "0", "defaultValue"]] },
				}),
			);
			assertExitFails(
				yield* create(
					Array.from({ length: 51 }, (_, index) => ({
						required: false,
						type: "text" as const,
						label: `Field ${index}`,
					})),
				),
				new CollectionBadRequest({ reason: { paths: [["fields"]], code: "invalid-fields" } }),
			);
			expect(yield* calls.createdEntities).toEqual(before);
		}),
	);

	test.effect("dispatches API membership commands with their caller context", () =>
		Effect.gen(function* () {
			const service = yield* CollectionsService;
			yield* service.addToCollection(
				user,
				{ entityId, collectionId, mode: "add-if-absent" },
				command("membership-execution", "collection:add-membership"),
			);
			yield* service.removeFromCollection(
				user,
				{ entityId, collectionId },
				command("removal-execution", "collection:remove-membership"),
			);
			const [add, remove] = yield* (yield* CollectionCalls).workflowDispatches;
			expect(add?.payload).toMatchObject({
				operation: "add",
				mode: "add-if-absent",
				command: { writeContext: null },
			});
			expect(remove).toMatchObject({
				executionId: "removal-execution",
				payload: { entityId, collectionId, operation: "remove" },
			});
		}),
	);

	test.effect("preserves sandbox authority for membership definition writes", () =>
		Effect.gen(function* () {
			const calls = yield* CollectionCalls;
			yield* runMembershipWorkflow({
				lifecycle: {
					...command("sandbox-membership-execution", "collection:add-membership"),
					writeContext: sandboxWriteContext,
				},
			});
			const relationshipCommand = (yield* calls.lifecycleCommands)["relationships.prepareCreate"];
			expect(relationshipCommand).toMatchObject({
				kernelCollection: true,
				writeContext: sandboxWriteContext,
			});
		}),
	);

	test.effect("preserves sandbox authority in collection workflow children", () =>
		Effect.gen(function* () {
			yield* Effect.void;
			const lifecycle = kernelCollectionLifecycleCommand({
				...command("sandbox-membership-execution", "collection:add-membership"),
				writeContext: sandboxWriteContext,
			});
			const child = childCollectionLifecycleCommand(lifecycle, "event:relationship-id");
			expect(child).toMatchObject({
				kernelCollection: true,
				writeContext: sandboxWriteContext,
				itemIdentity: stableStringify(["collection:add-membership", "event:relationship-id"]),
			});
		}),
	);

	test.effect("rejects client ranks and unknown member keys, including without fields", () =>
		Effect.gen(function* () {
			const calls = yield* CollectionCalls;
			const before = yield* calls.relationshipInputs;
			for (const properties of [{ rank: -100 }, { anything: "value" }]) {
				assertExitFails(
					yield* Effect.exit(runMembershipWorkflow({ properties })),
					new CollectionBadRequest({
						reason: {
							code: "invalid-membership-properties",
							paths: [[Object.keys(properties)[0] ?? ""]],
						},
					}),
				);
			}
			expect(yield* calls.relationshipInputs).toEqual(before);
		}),
	);

	test.effect("places a new member first with rank 0 in an empty collection", () =>
		Effect.gen(function* () {
			yield* runMembershipWorkflow();
			const relationshipInput = (yield* (yield* CollectionCalls).relationshipInputs).at(-1);
			expect(relationshipInput?.properties).toEqual({ rank: 0 });
		}),
	);
});

layer(
	makeServiceLayer({
		entities: { create: () => Effect.succeed({ warnings: [warning], entity: collectionEntity }) },
	}),
)((test) => {
	test.effect("creates a collection with one API root command and propagates warnings", () =>
		Effect.gen(function* () {
			const result = yield* (yield* CollectionsService).create(
				user,
				{ name: "Favorites" },
				createCommand,
			);
			const [input] = yield* (yield* CollectionCalls).createdEntities;
			const { populatedAt: _populatedAt, ...expected } = collectionEntity;
			expect(result).toEqual({ ...expected, warnings: [warning] });
			expect(input?.properties).toEqual({ membershipFields: [] });
			expect(input?.lifecycle.causation).toMatchObject({
				depth: 0,
				source: "api",
				initiator: { id: user.id, kind: "user" },
			});
			expect(input?.lifecycle.itemIdentity).toBe("collection:create");
			expect(input?.lifecycle).toMatchObject({ writeContext: null, kernelCollection: true });
			expect(input?.entitySchema).toEqual({
				owner: { kind: "kernel" },
				slug: EntitySchemaSlug.make("collection"),
			});
		}),
	);
});

layer(
	makeServiceLayer({
		collections: {
			findCollectionByNameForUser: () =>
				Effect.succeed({ ...collectionEntity, id: EntityId.make("other-collection") }),
		},
	}),
)((test) => {
	test.effect("rejects duplicate names on create and update before writing", () =>
		Effect.gen(function* () {
			const service = yield* CollectionsService;
			const taken = new CollectionBadRequest({ reason: { field: "name", code: "name-taken" } });
			assertExitFails(
				yield* Effect.exit(service.create(user, { name: "Favorites" }, createCommand)),
				taken,
			);
			assertExitFails(
				yield* Effect.exit(service.update(user, updatePayload, updateCommand)),
				taken,
			);
			const calls = yield* CollectionCalls;
			expect(yield* calls.createdEntities).toEqual([]);
			expect(yield* calls.updatedEntities).toEqual([]);
		}),
	);
});

layer(
	makeServiceLayer({
		entities: {
			create: () =>
				Effect.fail(new EntityBadRequest({ reason: { code: "duplicate-collection-name" } })),
			update: () =>
				Effect.fail(new EntityBadRequest({ reason: { code: "duplicate-collection-name" } })),
		},
	}),
)((test) => {
	test.effect("maps a concurrent duplicate-name write to name-taken", () =>
		Effect.gen(function* () {
			const service = yield* CollectionsService;
			const taken = new CollectionBadRequest({ reason: { field: "name", code: "name-taken" } });
			assertExitFails(
				yield* Effect.exit(service.create(user, { name: "Favorites" }, createCommand)),
				taken,
			);
			assertExitFails(
				yield* Effect.exit(service.update(user, updatePayload, updateCommand)),
				taken,
			);
		}),
	);
});

layer(makeServiceLayer({ collections: { getCollectionById: () => Effect.succeed(null) } }))(
	(test) => {
		test.effect("treats global, non-collection, and foreign ids as missing on update", () =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(
					(yield* CollectionsService).update(user, updatePayload, updateCommand),
				);
				assertExitFails(
					exit,
					new CollectionNotFound({ reason: { collectionId, code: "collection-not-found" } }),
				);
				expect(yield* (yield* CollectionCalls).updatedEntities).toEqual([]);
			}),
		);
	},
);

layer(
	makeServiceLayer({
		collections: {
			getCollectionById: () => Effect.succeed(noteCollection),
			findCollectionByNameForUser: () => Effect.succeed(noteCollection),
		},
	}),
)((test) => {
	test.effect("replaces fields wholesale with an owner guard and the read as the expectation", () =>
		Effect.gen(function* () {
			yield* (yield* CollectionsService).update(
				user,
				{
					collectionId,
					name: "Favorites",
					description: null,
					fields: [
						{ key: "note", type: "text", required: true, label: "Comment" },
						{ label: "Note", type: "boolean", required: false },
					],
				},
				updateCommand,
			);
			const calls = yield* CollectionCalls;
			const [input] = yield* calls.updatedEntities;
			expect(input).toMatchObject({
				scope: "user",
				userId: user.id,
				entityId: collectionId,
				requireUserOwned: true,
				lifecycle: { kernelCollection: true },
				expected: { updatedAt: now, name: "Favorites", properties: noteCollection.properties },
				properties: {
					membershipFields: [
						{ key: "note", type: "text", required: true, label: "Comment" },
						{ key: "note-2", label: "Note", type: "boolean", required: false },
					],
				},
			});
			expect(input?.properties).not.toHaveProperty("description");
			expect(yield* calls.relationshipInputs).toEqual([]);
		}),
	);
});

layer(
	makeServiceLayer({
		entities: {
			update: () =>
				Effect.fail(new EntityStale({ reason: { code: "entity-stale", entityId: collectionId } })),
		},
	}),
)((test) => {
	test.effect("reports a collection changed since it was read as stale", () =>
		Effect.gen(function* () {
			assertExitFails(
				yield* Effect.exit((yield* CollectionsService).update(user, updatePayload, updateCommand)),
				new CollectionBadRequest({ reason: { collectionId, code: "collection-stale" } }),
			);
		}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect("deletes only the caller's kernel collection through the entity delete path", () =>
		Effect.gen(function* () {
			const result = yield* (yield* CollectionsService).delete(
				user,
				{ collectionId },
				deleteCommand,
			);
			expect(result).toEqual({ warnings: [], id: collectionId });
			const [[ids, lifecycle, target] = []] = yield* (yield* CollectionCalls).deletedEntities;
			expect(ids).toEqual([collectionId]);
			expect(lifecycle).toMatchObject({
				kernelCollection: true,
				itemIdentity: "collection:delete",
			});
			expect(target).toEqual({
				userId: user.id,
				entitySchema: collectionEntitySchema.entitySchema,
			});
		}),
	);
});

layer(
	makeServiceLayer({
		entities: { deleteByIds: () => Effect.succeed({ warnings: [], deletedCount: 0 }) },
	}),
)((test) => {
	test.effect("reports a missing collection when nothing was deleted", () =>
		Effect.gen(function* () {
			assertExitFails(
				yield* Effect.exit(
					(yield* CollectionsService).delete(user, { collectionId }, deleteCommand),
				),
				new CollectionNotFound({ reason: { collectionId, code: "collection-not-found" } }),
			);
		}),
	);
});

layer(
	makeServiceLayer({
		entities: {
			deleteByIds: () =>
				Effect.fail(
					new EntityNotFound({ reason: { entityId: collectionId, code: "entity-not-found" } }),
				),
		},
	}),
)((test) => {
	test.effect("reports foreign, global, and non-collection ids as missing on delete", () =>
		Effect.gen(function* () {
			assertExitFails(
				yield* Effect.exit(
					(yield* CollectionsService).delete(user, { collectionId }, deleteCommand),
				),
				new CollectionNotFound({ reason: { collectionId, code: "collection-not-found" } }),
			);
		}),
	);
});

const eventWarning = { ...warning, triggerId: AutomationTriggerId.make("event-trigger") };

layer(
	makeServiceLayer({
		relationships: {
			prepareCreate: () =>
				Effect.succeed({
					...committedRelationship,
					result: {
						operation: "noop" as const,
						relationship: { ...membership, updatedAt: now, wasInserted: false },
					},
				}),
		},
	}),
)((test) => {
	test.effect("does not dispatch an added event for an existing membership", () =>
		Effect.gen(function* () {
			const result = yield* runMembershipWorkflow({ mode: "add-if-absent" });
			const [relationshipInput] = yield* (yield* CollectionCalls).relationshipInputs;
			expect(result.memberOf.id).toBe(relationshipId);
			expect(relationshipInput?.ifAbsent).toBe(true);
			expect(yield* (yield* CollectionCalls).workflowDispatches).toEqual([]);
		}),
	);
});

layer(
	makeServiceLayer({
		workflow: {
			warnings: [warning],
			eventResult: { count: 1, outcomes: [], failure: null, warnings: [eventWarning] },
		},
	}),
)((test) => {
	test.effect("accepts cross-plugin collection members with the kernel membership schema", () =>
		Effect.gen(function* () {
			const calls = yield* CollectionCalls;
			const result = yield* runMembershipWorkflow();
			const membershipCommand = (yield* calls.lifecycleCommands)["relationships.prepareCreate"];
			const [relationshipInput] = yield* calls.relationshipInputs;
			expect(result.warnings).toEqual([warning, eventWarning]);
			expect(yield* calls.dispatchedTriggers).toEqual([[membershipPlan.triggerId]]);
			expect(relationshipInput?.relationshipSchema).toEqual({
				owner: { kind: "kernel" },
				slug: RelationshipSchemaSlug.make("member-of"),
			});
			const [dispatch] = yield* calls.workflowDispatches;
			expect(dispatch?.executionId).toBe("collection-membership-added-relationship-id");
			expect(dispatch?.payload).toMatchObject({
				payload: [{ properties: { entitySchemaSlug: "record" } }],
				command: {
					writeContext: null,
					kernelCollection: true,
					causation: membershipCommand?.causation,
					occurredAt: membershipCommand?.occurredAt,
					itemIdentity: stableStringify(["collection:add-membership", "event:relationship-id"]),
				},
			});
		}),
	);
});

layer(makeServiceLayer({ workflow: { eventFailure: new Error("failed") } }))((test) => {
	test.effect("compensates with a stable identity derived from the original lifecycle fact", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(runMembershipWorkflow());
			assertExitFails(
				exit,
				new CollectionBadRequest({ reason: { code: "membership-event-failed" } }),
			);
			const commands = yield* (yield* CollectionCalls).lifecycleCommands;
			expect(commands["relationships.prepareDeleteUserRelationshipById"]).toMatchObject({
				occurredAt: now,
				itemIdentity: stableStringify([
					"collection:add-membership",
					"compensation:relationship-id",
				]),
				causation: {
					executionId: "membership-workflow-execution-id",
					rootExecutionId: "membership-workflow-execution-id",
				},
			});
		}),
	);
});

layer(
	makeServiceLayer({
		collections: { findMembership: () => Effect.succeed({ properties: {}, id: relationshipId }) },
		workflow: {
			warnings: [warning],
			eventResult: { count: 1, outcomes: [], failure: null, warnings: [eventWarning] },
		},
	}),
)((test) => {
	test.effect("removes a membership durably and records the removal event", () =>
		Effect.gen(function* () {
			const lifecycle = command(membershipWorkflowExecutionId, "collection:remove-membership");
			const result = yield* runMembershipWorkflow({ lifecycle, operation: "remove" });
			const calls = yield* CollectionCalls;
			const commands = yield* calls.lifecycleCommands;
			const relationshipCommand = commands["relationships.prepareDeleteUserRelationshipById"];
			expect(result).toEqual({
				operation: "delete",
				warnings: [warning, eventWarning],
				memberOf: {
					createdAt: now,
					updatedAt: now,
					id: relationshipId,
					sourceEntityId: entityId,
					targetEntityId: collectionId,
					relationshipSchemaPluginId: null,
					properties: { rank: 3, note: "kept" },
					relationshipSchemaSlug: RelationshipSchemaSlug.make("member-of"),
				},
			});
			expect(relationshipCommand).toMatchObject({ writeContext: null, kernelCollection: true });
			const [dispatch] = yield* calls.workflowDispatches;
			expect(dispatch?.executionId).toBe("collection-membership-removed-relationship-id");
			expect(dispatch?.payload).toMatchObject({
				payload: [
					{
						entityId: collectionId,
						eventSchemaSlug: removeEventSchema.id,
						properties: { relationshipProperties: { rank: 3, note: "kept" } },
					},
				],
				command: {
					kernelCollection: true,
					causation: relationshipCommand?.causation,
					occurredAt: relationshipCommand?.occurredAt,
					itemIdentity: stableStringify(["collection:remove-membership", "event:relationship-id"]),
				},
			});
		}),
	);
});

layer(
	makeServiceLayer({
		workflow: { eventFailure: new Error("failed") },
		collections: { findMembership: () => Effect.succeed({ properties: {}, id: relationshipId }) },
	}),
)((test) => {
	test.effect(
		"restores the removed membership with its prior properties when the event fails",
		() =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(
					runMembershipWorkflow({
						operation: "remove",
						lifecycle: command(membershipWorkflowExecutionId, "collection:remove-membership"),
					}),
				);
				assertExitFails(
					exit,
					new CollectionBadRequest({ reason: { code: "membership-event-failed" } }),
				);
				const calls = yield* CollectionCalls;
				const [restored] = yield* calls.relationshipInputs;
				expect(restored).toMatchObject({
					userId: user.id,
					sourceEntityId: entityId,
					targetEntityId: collectionId,
					properties: { rank: 3, note: "kept" },
				});
				expect((yield* calls.lifecycleCommands)["relationships.prepareCreate"]).toMatchObject({
					itemIdentity: stableStringify([
						"collection:remove-membership",
						"compensation:relationship-id",
					]),
				});
			}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect("reports a missing membership on removal without deleting", () =>
		Effect.gen(function* () {
			assertExitFails(
				yield* Effect.exit(runMembershipWorkflow({ operation: "remove" })),
				new CollectionNotFound({
					reason: { entityId, collectionId, code: "membership-not-found" },
				}),
			);
			const commands = yield* (yield* CollectionCalls).lifecycleCommands;
			expect(commands["relationships.prepareDeleteUserRelationshipById"]).toBeUndefined();
		}),
	);
});

layer(
	makeServiceLayer({
		collections: {
			getCollectionById: () => Effect.succeed(noteCollection),
			findMembership: () =>
				Effect.succeed({ id: relationshipId, properties: { rank: 5, note: "old" } }),
		},
	}),
)((test) => {
	test.effect("keeps the stored rank when member fields of an existing membership change", () =>
		Effect.gen(function* () {
			yield* runMembershipWorkflow({ properties: { note: "new" } });
			const [relationshipInput] = yield* (yield* CollectionCalls).relationshipInputs;
			expect(relationshipInput?.properties).toEqual({ rank: 5, note: "new" });
		}),
	);
});

layer(
	makeServiceLayer({
		collections: {
			findLowestMemberRank: () => Effect.succeed(-2),
			getCollectionById: () => Effect.succeed(noteCollection),
		},
	}),
)((test) => {
	test.effect("places a new member before the current first member", () =>
		Effect.gen(function* () {
			yield* runMembershipWorkflow({ properties: { note: "first" } });
			const [relationshipInput] = yield* (yield* CollectionCalls).relationshipInputs;
			expect(relationshipInput?.properties).toEqual({ rank: -3, note: "first" });
		}),
	);
});

const catastrophicPattern = "^(a+)+$";

for (const [name, membershipFields] of [
	[
		"a user-supplied pattern",
		[
			{
				key: "note",
				type: "text",
				label: "Note",
				required: false,
				validation: { pattern: catastrophicPattern },
			},
		],
	],
	[
		"dynamic choices",
		[
			{
				key: "format",
				type: "choice",
				label: "Format",
				required: false,
				choices: { kind: "dynamic", source: "formats" },
			},
		],
	],
	["an undecodable value", { fields: "not-an-object" }],
] as const) {
	layer(
		makeServiceLayer({
			collections: {
				getCollectionById: () =>
					Effect.succeed({ ...collectionEntity, properties: { membershipFields } }),
			},
		}),
	)((test) => {
		test.effect(`rejects members of a stored schema with ${name} without evaluating it`, () =>
			Effect.gen(function* () {
				assertExitFails(
					yield* Effect.exit(
						runMembershipWorkflow({ properties: { format: "x", note: `${"a".repeat(64)}!` } }),
					),
					new CollectionBadRequest({ reason: { code: "invalid-collection-schema" } }),
				);
				expect(yield* (yield* CollectionCalls).relationshipInputs).toEqual([]);
			}),
		);
		test.effect(`rejects editing stored fields with ${name}`, () =>
			Effect.gen(function* () {
				assertExitFails(
					yield* Effect.exit(
						(yield* CollectionsService).update(user, updatePayload, updateCommand),
					),
					new CollectionBadRequest({ reason: { code: "invalid-collection-schema" } }),
				);
				expect(yield* (yield* CollectionCalls).updatedEntities).toEqual([]);
			}),
		);
	});
}
