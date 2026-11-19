import { expect } from "bun:test";

import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { DbError } from "@ryot-app/contract/errors";
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
	type ListedEntity,
} from "@ryot-app/contract/modules/entities/schemas";
import type { EntitySchemaReference } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
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
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { scriptsDigestOf } from "@ryot-app/sandbox/host/executor.test-support";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref, Result } from "effect";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import type { Changes } from "#modules/changes/changes";
import type { CommitResult } from "#modules/changes/receipts";
import { ChangeSets } from "#modules/changes/service";
import { RelationshipSchemaReader } from "#modules/definitions/relationship-schemas";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	type DomainLifecycleCommand,
	kernelCollectionLifecycleCommand,
} from "#modules/entities/write-context";
import { mutationAdmissionTestLayer } from "#modules/mutations/admission.test-support";
import type { RelationshipWriteResult } from "#modules/relationships/mutation-support";
import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import type { MockOverrides } from "#testing/effect";

import { CollectionsRepository } from "./repository";
import { childCollectionLifecycleCommand, CollectionsService } from "./service";

const now = "2026-06-14T00:00:00.000Z";
const user: CurrentUserValue = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: {
		weekStart: null,
		interfaceLocale: null,
		contentLanguage: null,
		reportingTimeZone: UTC,
		ratingScale: "hundred",
		disableIntegrations: false,
	},
};
const collectionId = EntityId.make("collection-id");
const entityId = EntityId.make("entity-id");
const relationshipId = RelationshipId.make("relationship-id");
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
	sourceEntitySchemaSlug: null,
	targetEntitySchemaSlug: null,
	id: RelationshipSchemaSlug.make("member-of"),
	name: { namespace: "kernel", key: "test.member-of" },
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
	slug: "add-entity-to-collection",
	propertiesSchema: { fields: {} },
	name: { key: "test.add-entity-to-collection" },
	id: EventSchemaSlug.make("add-event-schema-id"),
};
const removeEventSchema = {
	pluginId: null,
	propertiesSchema: { fields: {} },
	slug: "remove-entity-from-collection",
	id: EventSchemaSlug.make("remove-event-schema-id"),
	name: { key: "test.remove-entity-from-collection" },
};
const noteFields = [{ key: "note", type: "text", label: "Note", required: false }];
const noteCollection = {
	...collectionEntity,
	properties: { description: "Notes", membershipFields: noteFields },
};

const committedRelationship: RelationshipWriteResult = {
	operation: "create",
	relationship: { ...membership, updatedAt: now },
};
const committedDeletion: RelationshipWriteResult = {
	operation: "delete",
	relationship: {
		...membership,
		updatedAt: now,
		wasInserted: false,
		properties: { rank: 3, note: "kept" },
	},
};
const emptyCommit: CommitResult = {
	merged: [],
	cleared: [],
	deleted: [],
	entities: [],
	outcomes: [],
	relationships: [],
	committed: { events: [] },
};

const mockCollections = Layer.mock(CollectionsRepository);
const mockRelationshipSchemas = Layer.mock(RelationshipSchemaReader);

type EventCreateCall = Parameters<ChangeSets["Service"]["commit"]>;
type EntityDeleteCall = readonly [
	NonNullable<NonNullable<Changes["entities"]>["deletes"]>,
	DomainLifecycleCommand,
];
/** A committed collection entity create or update, with the user and command it was committed under. */
type EntityWrite = NonNullable<Changes["entity"]> & {
	readonly userId: Changes["userId"];
	readonly lifecycle: DomainLifecycleCommand;
};

type RelationshipWrite = NonNullable<NonNullable<Changes["relationships"]>["ensures"]>[number] & {
	readonly userId: Changes["userId"];
	readonly mode: "ensure" | "upsert";
};

class CollectionCalls extends Context.Service<
	CollectionCalls,
	{
		readonly createdEntities: Effect.Effect<ReadonlyArray<EntityWrite>>;
		readonly updatedEntities: Effect.Effect<ReadonlyArray<EntityWrite>>;
		readonly eventCreates: Effect.Effect<ReadonlyArray<EventCreateCall>>;
		readonly deletedEntities: Effect.Effect<ReadonlyArray<EntityDeleteCall>>;
		readonly relationshipInputs: Effect.Effect<ReadonlyArray<RelationshipWrite>>;
		readonly lifecycleCommands: Effect.Effect<Readonly<Record<string, DomainLifecycleCommand>>>;
	}
>()("@ryot-app/kernel-backend/modules/collections/service.test/CollectionCalls") {}

const membershipExecutionId = "membership-execution-id";

const membershipEvent = (item: Record<string, unknown>) => ({
	userId: user.id,
	events: { creates: [{ ...item, entity: { kind: "existing", entityId: collectionId } }] },
});

const makeServiceLayer = (
	options: {
		readonly workflow?: { readonly eventFailure?: unknown };
		readonly collections?: MockOverrides<typeof mockCollections>;
		readonly relationships?: {
			readonly write?: Effect.Effect<RelationshipWriteResult>;
			readonly deleteById?: Effect.Effect<RelationshipWriteResult>;
		};
		readonly entities?: {
			readonly deleteByIds?: () => Effect.Effect<ReadonlyArray<EntityId>, EntityNotFound>;
			readonly create?: (input: EntityWrite) => Effect.Effect<ListedEntity, EntityBadRequest>;
			readonly update?: (
				input: EntityWrite,
			) => Effect.Effect<ListedEntity, EntityStale | EntityBadRequest>;
		};
	} = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const createdEntities = yield* Ref.make<ReadonlyArray<EntityWrite>>([]);
			const updatedEntities = yield* Ref.make<ReadonlyArray<EntityWrite>>([]);
			const deletedEntities = yield* Ref.make<ReadonlyArray<EntityDeleteCall>>([]);
			const relationshipInputs = yield* Ref.make<ReadonlyArray<RelationshipWrite>>([]);
			const eventCreates = yield* Ref.make<ReadonlyArray<EventCreateCall>>([]);
			const lifecycleCommands = yield* Ref.make<Readonly<Record<string, DomainLifecycleCommand>>>(
				{},
			);
			const recordCommand = (operation: string, command: DomainLifecycleCommand) =>
				Ref.update(lifecycleCommands, (all) => ({ ...all, [operation]: command }));
			const entities = {
				deleteByIds: () => Effect.succeed([collectionId]),
				create: (_input: EntityWrite) => Effect.succeed<ListedEntity>(collectionEntity),
				update: (_input: EntityWrite) => Effect.succeed<ListedEntity>(collectionEntity),
				...options.entities,
			};
			const commitEntity = (changes: Changes, lifecycle: DomainLifecycleCommand) => {
				if (changes.entity) {
					const write = { ...changes.entity, lifecycle, userId: changes.userId };
					const created = changes.entity.target.kind === "create";
					return Ref.update(created ? createdEntities : updatedEntities, (all) => [
						...all,
						write,
					]).pipe(
						Effect.andThen(created ? entities.create(write) : entities.update(write)),
						Effect.map((entity): CommitResult => ({
							...emptyCommit,
							entities: [{ entity, itemIdentity: lifecycle.itemIdentity }],
						})),
					);
				}
				const deletes = changes.entities?.deletes ?? [];
				return Ref.update(deletedEntities, (all): ReadonlyArray<EntityDeleteCall> => [
					...all,
					[deletes, lifecycle],
				]).pipe(
					Effect.andThen(entities.deleteByIds()),
					Effect.map((deleted): CommitResult => ({ ...emptyCommit, deleted })),
				);
			};
			const relationships = {
				write: Effect.succeed(committedRelationship),
				deleteById: Effect.succeed(committedDeletion),
				...options.relationships,
			};
			const commitRelationships = (
				changes: Changes,
				part: NonNullable<Changes["relationships"]>,
				lifecycle: DomainLifecycleCommand,
			) => {
				const ensured = part.ensures?.[0];
				const write = ensured ?? part.upserts?.[0];
				const committed = write
					? Ref.update(relationshipInputs, (all) => [
							...all,
							{
								...write,
								userId: changes.userId,
								mode: ensured ? ("ensure" as const) : ("upsert" as const),
							},
						]).pipe(
							Effect.andThen(recordCommand("relationships.write", lifecycle)),
							Effect.andThen(relationships.write),
						)
					: recordCommand("relationships.deleteById", lifecycle).pipe(
							Effect.andThen(relationships.deleteById),
						);
				return Effect.map(committed, (result): CommitResult => ({
					...emptyCommit,
					relationships: [{ ...result, itemIdentity: lifecycle.itemIdentity }],
				}));
			};
			const workflow = options.workflow ?? {};
			const dependencies = Layer.mergeAll(
				Layer.mock(EntitiesRepository)({}),
				mockCollections({
					findMembership: () => Effect.succeed(null),
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
				Layer.mock(ChangeSets)({
					commit: (...call) => {
						if (call[0].relationships) {
							return commitRelationships(call[0], call[0].relationships, call[1]);
						}
						if (call[0].entity || call[0].entities) {
							return commitEntity(call[0], call[1]);
						}
						return Ref.update(eventCreates, (all): ReadonlyArray<EventCreateCall> => [
							...all,
							call,
						]).pipe(
							Effect.andThen(
								workflow.eventFailure
									? Effect.fail(new DbError({ message: "event creation failed" }))
									: Effect.succeed(emptyCommit),
							),
						);
					},
				}),
				Layer.succeed(CollectionCalls, {
					eventCreates: Ref.get(eventCreates),
					createdEntities: Ref.get(createdEntities),
					updatedEntities: Ref.get(updatedEntities),
					deletedEntities: Ref.get(deletedEntities),
					lifecycleCommands: Ref.get(lifecycleCommands),
					relationshipInputs: Ref.get(relationshipInputs),
				}),
			);
			return CollectionsService.layer.pipe(
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
		accountUserId: user.id,
		initiator: { id: user.id, kind: "user" },
		executionId: AutomationExecutionId.make(executionId),
	}),
	writeContext: null,
});

const sandboxWriteContext = {
	providerId: null,
	scriptSlug: "collection",
	contentHash: "collection-hash",
	subject: { type: "user", userId: user.id },
	metadata: { kind: "workflow", runtimeImports: [] },
	scriptId: SandboxScriptId.make("collection-script"),
	pluginRevision: {
		scope: "user",
		ownerId: user.id,
		configSchema: { fields: {} },
		userBootstrapScriptSlugs: [],
		id: PluginId.make("collection-plugin"),
		workflowScripts: { collection: "collection-hash" },
		packageId: PluginPackageId.make("test/collections"),
		revisionId: PluginRevisionId.make("collection-revision"),
		scriptsDigest: scriptsDigestOf({ collection: "collection-hash" }),
		configRevisionId: PluginConfigRevisionId.make("collection-config"),
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
	Effect.flatMap(CollectionsService, (collections) =>
		collections.writeMembership({
			entityId,
			collectionId,
			userId: user.id,
			operation: options.operation ?? "add",
			command: options.lifecycle ?? command(membershipExecutionId),
			...(options.mode === undefined ? {} : { mode: options.mode }),
			...(options.properties === undefined ? {} : { properties: options.properties }),
		}),
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
							Effect.as<ListedEntity>(collectionEntity),
						),
					update: (input) =>
						Ref.set(properties, propertyRecord(input.properties)).pipe(
							Effect.as<ListedEntity>(collectionEntity),
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
		testTimeout,
	);
});

const updatePayload = {
	collectionId,
	name: "Renamed",
	description: "Fresh description",
	fields: [{ label: "Rating", required: false, type: "number" as const }],
};

layer(makeServiceLayer())((test) => {
	test.effect(
		"rejects creating a collection with an empty name",
		() =>
			Effect.gen(function* () {
				const service = yield* CollectionsService;
				const exit = yield* Effect.exit(service.create(user, { name: "  " }, createCommand));
				assertExitFails(
					exit,
					new CollectionBadRequest({ reason: { field: "name", code: "name-required" } }),
				);
			}),
		testTimeout,
	);

	test.effect(
		"persists normalized ordered member fields on create",
		() =>
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
		testTimeout,
	);

	test.effect(
		"rejects reserved, invented, and unsupported member fields on create",
		() =>
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
					yield* create([
						{ label: "Count", type: "number", required: false, defaultValue: "many" },
					]),
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
		testTimeout,
	);

	test.effect(
		"writes API add-membership commands with their caller context",
		() =>
			Effect.gen(function* () {
				const service = yield* CollectionsService;
				yield* service.addToCollection(
					user,
					{ entityId, collectionId, mode: "add-if-absent" },
					command("membership-execution", "collection:add-membership"),
				);
				const [add] = yield* (yield* CollectionCalls).eventCreates;
				expect(add).toMatchObject([
					membershipEvent({ eventSchemaSlug: addEventSchema.id }),
					{ writeContext: null, causation: { executionId: "membership-execution" } },
					{ events: { independent: true } },
				]);
			}),
		testTimeout,
	);

	test.effect(
		"preserves sandbox authority for membership definition writes",
		() =>
			Effect.gen(function* () {
				const calls = yield* CollectionCalls;
				yield* runMembershipWorkflow({
					lifecycle: {
						...command("sandbox-membership-execution", "collection:add-membership"),
						writeContext: sandboxWriteContext,
					},
				});
				const relationshipCommand = (yield* calls.lifecycleCommands)["relationships.write"];
				expect(relationshipCommand).toMatchObject({
					kernelCollection: true,
					writeContext: sandboxWriteContext,
				});
			}),
		testTimeout,
	);

	test.effect(
		"preserves sandbox authority in collection workflow children",
		() =>
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
		testTimeout,
	);

	test.effect(
		"rejects client ranks and unknown member keys, including without fields",
		() =>
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
		testTimeout,
	);

	test.effect(
		"places a new member first with rank 0 in an empty collection",
		() =>
			Effect.gen(function* () {
				yield* runMembershipWorkflow();
				const relationshipInput = (yield* (yield* CollectionCalls).relationshipInputs).at(-1);
				expect(relationshipInput?.properties).toEqual({ rank: 0 });
			}),
		testTimeout,
	);
});

layer(makeServiceLayer())((test) => {
	test.effect(
		"creates a collection with one API root command",
		() =>
			Effect.gen(function* () {
				const result = yield* (yield* CollectionsService).create(
					user,
					{ name: "Favorites" },
					createCommand,
				);
				const [input] = yield* (yield* CollectionCalls).createdEntities;
				const { populatedAt: _populatedAt, ...expected } = collectionEntity;
				expect(result).toEqual(expected);
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
		testTimeout,
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
	test.effect(
		"rejects duplicate names on create and update before writing",
		() =>
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
		testTimeout,
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
	test.effect(
		"maps a concurrent duplicate-name write to name-taken",
		() =>
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
		testTimeout,
	);
});

layer(makeServiceLayer({ collections: { getCollectionById: () => Effect.succeed(null) } }))(
	(test) => {
		test.effect(
			"treats global, non-collection, and foreign ids as missing on update",
			() =>
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
			testTimeout,
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
	test.effect(
		"replaces fields wholesale with an owner guard and the read as the expectation",
		() =>
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
					userId: user.id,
					lifecycle: { kernelCollection: true },
					entitySchema: collectionEntitySchema.entitySchema,
					target: {
						kind: "update",
						entityId: collectionId,
						expected: { updatedAt: now, name: "Favorites", properties: noteCollection.properties },
					},
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
		testTimeout,
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
	test.effect(
		"reports a collection changed since it was read as stale",
		() =>
			Effect.gen(function* () {
				assertExitFails(
					yield* Effect.exit(
						(yield* CollectionsService).update(user, updatePayload, updateCommand),
					),
					new CollectionBadRequest({ reason: { collectionId, code: "collection-stale" } }),
				);
			}),
		testTimeout,
	);
});

layer(makeServiceLayer())((test) => {
	test.effect(
		"deletes only the caller's kernel collection through the entity delete path",
		() =>
			Effect.gen(function* () {
				const result = yield* (yield* CollectionsService).delete(
					user,
					{ collectionId },
					deleteCommand,
				);
				expect(result).toEqual({ id: collectionId });
				const [[deletes, lifecycle] = []] = yield* (yield* CollectionCalls).deletedEntities;
				expect(deletes).toEqual([
					{ entityId: collectionId, entitySchema: collectionEntitySchema.entitySchema },
				]);
				expect(lifecycle).toMatchObject({
					kernelCollection: true,
					itemIdentity: "collection:delete",
				});
			}),
		testTimeout,
	);
});

layer(makeServiceLayer({ entities: { deleteByIds: () => Effect.succeed([]) } }))((test) => {
	test.effect(
		"reports a missing collection when nothing was deleted",
		() =>
			Effect.gen(function* () {
				assertExitFails(
					yield* Effect.exit(
						(yield* CollectionsService).delete(user, { collectionId }, deleteCommand),
					),
					new CollectionNotFound({ reason: { collectionId, code: "collection-not-found" } }),
				);
			}),
		testTimeout,
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
	test.effect(
		"reports foreign, global, and non-collection ids as missing on delete",
		() =>
			Effect.gen(function* () {
				assertExitFails(
					yield* Effect.exit(
						(yield* CollectionsService).delete(user, { collectionId }, deleteCommand),
					),
					new CollectionNotFound({ reason: { collectionId, code: "collection-not-found" } }),
				);
			}),
		testTimeout,
	);
});

layer(
	makeServiceLayer({
		relationships: {
			write: Effect.succeed({
				operation: "noop" as const,
				relationship: { ...membership, updatedAt: now, wasInserted: false },
			}),
		},
	}),
)((test) => {
	test.effect(
		"does not dispatch an added event for an existing membership",
		() =>
			Effect.gen(function* () {
				const result = yield* runMembershipWorkflow({ mode: "add-if-absent" });
				const [relationshipInput] = yield* (yield* CollectionCalls).relationshipInputs;
				expect(result.memberOf.id).toBe(relationshipId);
				expect(relationshipInput?.mode).toBe("ensure");
				expect(yield* (yield* CollectionCalls).eventCreates).toEqual([]);
			}),
		testTimeout,
	);
});

layer(makeServiceLayer())((test) => {
	test.effect(
		"accepts cross-plugin collection members with the kernel membership schema",
		() =>
			Effect.gen(function* () {
				const calls = yield* CollectionCalls;
				yield* runMembershipWorkflow();
				const membershipCommand = (yield* calls.lifecycleCommands)["relationships.write"];
				const [relationshipInput] = yield* calls.relationshipInputs;
				expect(relationshipInput?.relationshipSchema).toEqual({
					owner: { kind: "kernel" },
					slug: RelationshipSchemaSlug.make("member-of"),
				});
				const [created] = yield* calls.eventCreates;
				expect(created).toMatchObject([
					membershipEvent({ properties: { entitySchemaSlug: "record" } }),
					{
						writeContext: null,
						kernelCollection: true,
						causation: membershipCommand?.causation,
						occurredAt: membershipCommand?.occurredAt,
						itemIdentity: stableStringify(["collection:add-membership", "event:relationship-id"]),
					},
					{ events: { independent: true } },
				]);
			}),
		testTimeout,
	);
});

layer(makeServiceLayer({ workflow: { eventFailure: new Error("failed") } }))((test) => {
	test.effect(
		"compensates with a stable identity derived from the original lifecycle fact",
		() =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(runMembershipWorkflow());
				assertExitFails(
					exit,
					new CollectionBadRequest({ reason: { code: "membership-event-failed" } }),
				);
				const commands = yield* (yield* CollectionCalls).lifecycleCommands;
				expect(commands["relationships.deleteById"]).toMatchObject({
					occurredAt: now,
					itemIdentity: stableStringify([
						"collection:add-membership",
						"compensation:relationship-id",
					]),
					causation: {
						executionId: "membership-execution-id",
						rootExecutionId: "membership-execution-id",
					},
				});
			}),
		testTimeout,
	);
});

layer(
	makeServiceLayer({
		collections: { findMembership: () => Effect.succeed({ properties: {}, id: relationshipId }) },
	}),
)((test) => {
	test.effect(
		"removes a membership durably and records the removal event",
		() =>
			Effect.gen(function* () {
				const lifecycle = command(membershipExecutionId, "collection:remove-membership");
				const result = yield* runMembershipWorkflow({ lifecycle, operation: "remove" });
				const calls = yield* CollectionCalls;
				const commands = yield* calls.lifecycleCommands;
				const relationshipCommand = commands["relationships.deleteById"];
				expect(result).toEqual<unknown>({
					operation: "delete",
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
				const [created] = yield* calls.eventCreates;
				expect(created).toMatchObject([
					membershipEvent({
						eventSchemaSlug: removeEventSchema.id,
						properties: { relationshipProperties: { rank: 3, note: "kept" } },
					}),
					{
						kernelCollection: true,
						causation: relationshipCommand?.causation,
						occurredAt: relationshipCommand?.occurredAt,
						itemIdentity: stableStringify([
							"collection:remove-membership",
							"event:relationship-id",
						]),
					},
					{ events: { independent: true } },
				]);
			}),
		testTimeout,
	);

	test.effect(
		"writes API remove-membership commands with their caller context",
		() =>
			Effect.gen(function* () {
				const service = yield* CollectionsService;
				yield* service.removeFromCollection(
					user,
					{ entityId, collectionId },
					command("removal-execution", "collection:remove-membership"),
				);
				const remove = (yield* (yield* CollectionCalls).eventCreates).at(-1);
				expect(remove).toMatchObject([
					membershipEvent({ eventSchemaSlug: removeEventSchema.id }),
					{ causation: { executionId: "removal-execution" } },
					{ events: { independent: true } },
				]);
			}),
		testTimeout,
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
						lifecycle: command(membershipExecutionId, "collection:remove-membership"),
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
					source: { entityId },
					target: { entityId: collectionId },
					properties: { rank: 3, note: "kept" },
				});
				expect((yield* calls.lifecycleCommands)["relationships.write"]).toMatchObject({
					itemIdentity: stableStringify([
						"collection:remove-membership",
						"compensation:relationship-id",
					]),
				});
			}),
		testTimeout,
	);
});

layer(makeServiceLayer())((test) => {
	test.effect(
		"reports a missing membership on removal without deleting",
		() =>
			Effect.gen(function* () {
				assertExitFails(
					yield* Effect.exit(runMembershipWorkflow({ operation: "remove" })),
					new CollectionNotFound({
						reason: { entityId, collectionId, code: "membership-not-found" },
					}),
				);
				const commands = yield* (yield* CollectionCalls).lifecycleCommands;
				expect(commands["relationships.deleteById"]).toBeUndefined();
			}),
		testTimeout,
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
	test.effect(
		"keeps the stored rank when member fields of an existing membership change",
		() =>
			Effect.gen(function* () {
				yield* runMembershipWorkflow({ properties: { note: "new" } });
				const [relationshipInput] = yield* (yield* CollectionCalls).relationshipInputs;
				expect(relationshipInput?.properties).toEqual({ rank: 5, note: "new" });
			}),
		testTimeout,
	);
});

layer(
	makeServiceLayer({ collections: { getCollectionById: () => Effect.succeed(noteCollection) } }),
)((test) => {
	test.effect(
		"defers new member rank allocation to commit during preparation",
		() =>
			Effect.gen(function* () {
				yield* runMembershipWorkflow({ properties: { note: "first" } });
				const [relationshipInput] = yield* (yield* CollectionCalls).relationshipInputs;
				expect(relationshipInput?.properties).toEqual({ rank: 0, note: "first" });
			}),
		testTimeout,
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
		test.effect(
			`rejects members of a stored schema with ${name} without evaluating it`,
			() =>
				Effect.gen(function* () {
					assertExitFails(
						yield* Effect.exit(
							runMembershipWorkflow({ properties: { format: "x", note: `${"a".repeat(64)}!` } }),
						),
						new CollectionBadRequest({ reason: { code: "invalid-collection-schema" } }),
					);
					expect(yield* (yield* CollectionCalls).relationshipInputs).toEqual([]);
				}),
			testTimeout,
		);
		test.effect(
			`rejects editing stored fields with ${name}`,
			() =>
				Effect.gen(function* () {
					assertExitFails(
						yield* Effect.exit(
							(yield* CollectionsService).update(user, updatePayload, updateCommand),
						),
						new CollectionBadRequest({ reason: { code: "invalid-collection-schema" } }),
					);
					expect(yield* (yield* CollectionCalls).updatedEntities).toEqual([]);
				}),
			testTimeout,
		);
	});
}
