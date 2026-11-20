import { expect } from "bun:test";

import { EntityBadRequest } from "@ryot-app/contract/modules/entities/schemas";
import type { CreateEventItem } from "@ryot-app/contract/modules/events/schemas";
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
import { testPluginPackageId } from "@ryot-app/contract/testing";
import { kernelDefinitionSource } from "@ryot-app/definitions/kernel-definitions";
import { assert } from "@ryot-app/testing/assert";
import { arrayContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { layer } from "@voila.dev/effect-bun-test";
import { and, eq, inArray } from "drizzle-orm";
import { DateTime, Effect, Layer, Schema } from "effect";

import { decidingPolicies } from "#modules/automations/lifecycle.test-support";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecyclePolicies } from "#modules/automations/lifecycle/policies";
import {
	commitEventChanges,
	createEvents,
	entityUpdate,
	eventChangeSets,
	eventDelete,
	eventUpdate,
	userDataChangeSets,
} from "#modules/changes/change-sets.test-support";
import type { Changes, EventChange } from "#modules/changes/changes";
import { savedEntity } from "#modules/changes/receipts";
import { ChangeSets } from "#modules/changes/service";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { EntityImportWorkflowOperations } from "#modules/entities/providers/operations-workflow";
import { runPopulationAttempt } from "#modules/entities/providers/population-job";
import { EventsRepository } from "#modules/events/repository";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import {
	relationshipChangeSetsLayer,
	upsertGlobalRelationship,
	writeRelationship,
} from "#modules/relationships/lifecycle.test-support";
import { principalOwner, ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { EntitiesRepository } from "./repository";
import { EntityUserDataGraphRepository } from "./user-data/graph-repository";
import { EntityUserDataService } from "./user-data/service";
import { type DomainLifecycleCommand, kernelCollectionLifecycleCommand } from "./write-context";

type GlobalUpsert = NonNullable<Changes["globalEntities"]>[number];

const firstUser = UserId.make("relationship-owner");
const secondUser = UserId.make("second-namespace-owner");
const bottle = EntitySchemaSlug.make("bottle");
const titleProperties = {
	fields: { title: { type: "string", description: "Title", label: { key: "test.title" } } },
} as const;
const bottleProperties = {
	fields: {
		...titleProperties.fields,
		code: { type: "string", immutable: true, description: "Code", label: { key: "test.code" } },
	},
} as const;
const namespacePackage = (packageId = testPluginPackageId(), version = "one") => {
	const source = revisionPackage("whiskey", version, bottle, packageId);
	return {
		...source,
		manifest: {
			...source.manifest,
			metadata: { ...source.manifest.metadata, name: { key: "test.whiskey" } },
			entitySchemas: ["bottle", "part", "section"].map((slug) => ({
				slug,
				icon: "box",
				name: { key: `test.${slug}` },
				propertiesSchema: slug === "bottle" ? bottleProperties : titleProperties,
				eventSchemas: [
					{ slug: "tasted", name: { key: "test.tasted" }, propertiesSchema: titleProperties },
				],
			})),
			relationshipSchemas: [
				{
					slug: "link",
					name: { key: "test.link" },
					sourceEntitySchemaSlug: null,
					targetEntitySchemaSlug: null,
					propertiesSchema: { fields: {} },
				},
				{
					slug: "bottle-part",
					name: { key: "test.parts" },
					targetEntitySchemaSlug: "part",
					sourceEntitySchemaSlug: "bottle",
					propertiesSchema: { fields: {} },
				},
				{
					slug: "part-section",
					name: { key: "test.sections" },
					sourceEntitySchemaSlug: "part",
					propertiesSchema: { fields: {} },
					targetEntitySchemaSlug: "section",
				},
				{
					slug: "credits",
					name: { key: "test.credits" },
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
	icon: "box",
	eventSchemas: [],
	name: { key: `test.${slug}` },
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
	const subject = { userId, type: "user" as const };
	const pin = yield* (yield* SandboxRepository.make).getScriptPin(script.id, undefined, subject);
	assert(pin?.pluginRevision);
	const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
	const command: DomainLifecycleCommand = {
		...rootLifecycleCommand({
			source: "api",
			lane: "interactive",
			itemIdentity: "namespace",
			accountUserId: subject.userId,
			occurredAt: "2026-10-13T00:00:00.000Z",
			initiator: { id: userId, kind: "user" },
			executionId: AutomationExecutionId.make(executionId),
		}),
		writeContext: principal,
	};
	return { command, providerId: provider.id };
});

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

type EntityCreate = NonNullable<NonNullable<Changes["entities"]>["creates"]>[number];
const userCreate = (create: EntityCreate, userId: UserId = firstUser) => ({
	userId,
	entities: { creates: [create] },
});

const withEventChangeSets = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		const repository = yield* EventsRepository.make;
		const schemas = yield* EventSchemaReader.make;
		return yield* effect.pipe(
			Effect.provideServiceEffect(
				ChangeSets,
				eventChangeSets().pipe(
					Effect.provideService(EventsRepository, repository),
					Effect.provideService(EventSchemaReader, schemas),
				),
			),
		);
	});

/** Merges user data of the writer's own schema `slug` through `ChangeSets`, answering its result. */
const mergeUserData = (
	userId: UserId,
	merge: { readonly slug: string; readonly mergeFrom: EntityId; readonly mergeInto: EntityId },
	command: DomainLifecycleCommand,
) =>
	Effect.gen(function* () {
		const repository = yield* EventsRepository.make;
		const schemas = yield* EventSchemaReader.make;
		const userData = yield* EntityUserDataService.make.pipe(
			Effect.provideServiceEffect(
				EntityUserDataGraphRepository,
				EntityUserDataGraphRepository.make,
			),
		);
		const sets = yield* userDataChangeSets().pipe(
			Effect.provideService(EventsRepository, repository),
			Effect.provideService(EventSchemaReader, schemas),
			Effect.provideService(EntityUserDataService, userData),
		);
		const committed = yield* sets.commit(
			{
				userId,
				entities: {
					merges: [
						{
							mergeFrom: merge.mergeFrom,
							mergeInto: merge.mergeInto,
							entitySchema: {
								slug: EntitySchemaSlug.make(merge.slug),
								owner: principalOwner(command.writeContext),
							},
						},
					],
				},
			},
			command,
		);
		return committed.merged[0];
	});
const createUserEvents = (
	command: DomainLifecycleCommand,
	userId: UserId,
	payload: ReadonlyArray<CreateEventItem>,
) => withEventChangeSets(createEvents({ userId, command, payload }));

const changeUserEvents = (
	command: DomainLifecycleCommand,
	userId: UserId,
	changes: ReadonlyArray<EventChange>,
) => withEventChangeSets(commitEventChanges(userId, command, changes));

layer(EnrichmentRequests.layer.pipe(Layer.provideMerge(relationshipChangeSetsLayer())))((test) => {
	test.effect(
		"rejects foreign same-name domain writes and unrestricted relationship endpoints",
		() =>
			Effect.gen(function* () {
				const a = yield* installRevisionPackage(namespacePackage(), firstUser);
				const b = yield* installRevisionPackage(namespacePackage(), firstUser);
				const changeSets = yield* ChangeSets;
				const admitted = yield* admittedCommand(a, firstUser, "foreign-writes");
				const ownSchema = { slug: bottle, owner: definitionOwner(a.pluginId) };
				const foreignSchema = { slug: bottle, owner: definitionOwner(b.pluginId) };
				const own = yield* changeSets
					.commit(
						userCreate({ name: "A", entitySchema: ownSchema, properties: { title: "A" } }),
						admitted.command,
					)
					.pipe(Effect.flatMap(savedEntity));
				const foreign = yield* changeSets
					.commit(
						userCreate({ name: "B", properties: { title: "B" }, entitySchema: foreignSchema }),
						{ ...nextCommand(admitted.command, "seed-foreign"), writeContext: null },
					)
					.pipe(Effect.flatMap(savedEntity));
				const create = yield* Effect.flip(
					changeSets.commit(
						userCreate({ name: "Wrong", properties: {}, entitySchema: foreignSchema }),
						nextCommand(admitted.command, "foreign-create"),
					),
				);
				assert(create instanceof EntityBadRequest);
				expect(create.reason).toEqual({
					code: "owner-mismatch",
					expected: ownSchema.owner,
					actual: foreignSchema.owner,
				});
				expect(
					yield* Effect.flip(
						changeSets.commit(
							{
								userId: firstUser,
								entities: {
									updates: [{ ...entityUpdate(foreign, "Wrong", {}), populatedAt: null }],
								},
							},
							nextCommand(admitted.command, "foreign-update"),
						),
					),
				).toMatchObject({ reason: { code: "owner-mismatch" } });
				expect(
					yield* Effect.flip(
						changeSets.commit(
							{
								userId: firstUser,
								entities: { deletes: [{ entityId: foreign.id, entitySchema: foreignSchema }] },
							},
							nextCommand(admitted.command, "foreign-delete"),
						),
					),
				).toMatchObject({ reason: { code: "owner-mismatch" } });
				expect(
					yield* Effect.flip(
						changeSets.commit(
							{
								userId: firstUser,
								entities: {
									ensures: [{ name: "Wrong", properties: {}, entitySchema: foreignSchema }],
								},
							},
							nextCommand(admitted.command, "foreign-ensure"),
						),
					),
				).toMatchObject({ reason: { code: "owner-mismatch" } });
				expect(
					yield* Effect.flip(
						writeRelationship(
							"upsert",
							{
								properties: {},
								userId: firstUser,
								sourceEntityId: own.id,
								targetEntityId: foreign.id,
								relationshipSchema: {
									owner: ownSchema.owner,
									slug: RelationshipSchemaSlug.make("link"),
								},
							},
							nextCommand(admitted.command, "foreign-endpoint"),
						),
					),
				).toMatchObject({ reason: { code: "owner-mismatch" } });
				expect((yield* (yield* EntitiesRepository).getById(foreign.id))?.properties).toEqual({
					title: "B",
				});
			}),
		testTimeout,
	);

	test.effect(
		"rejects private global entities, batches, and relationships",
		() =>
			Effect.gen(function* () {
				const installed = yield* installRevisionPackage(namespacePackage(), firstUser);
				const { command, providerId } = yield* admittedCommand(
					installed,
					firstUser,
					"private-globals",
				);
				const changeSets = yield* ChangeSets;
				const entitySchema = { slug: bottle, owner: definitionOwner(installed.pluginId) };
				expect(
					yield* Effect.flip(
						changeSets.commit(
							{
								userId: null,
								entities: {
									creates: [{ entitySchema, name: "Global", properties: { title: "Global" } }],
								},
							},
							command,
						),
					),
				).toMatchObject({ reason: { code: "global-scope-forbidden" } });
				expect(
					yield* Effect.flip(
						changeSets.commit(
							{
								userId: null,
								globalEntities: [
									{
										entitySchema,
										name: "Global",
										populatedAt: null,
										externalId: "global",
										properties: { title: "Global" },
										provider: { providerId, updateExisting: false },
									},
								],
							},
							nextCommand(command, "global-batch"),
						),
					),
				).toMatchObject({ reason: { code: "global-scope-forbidden" } });
				const own = yield* changeSets
					.commit(
						userCreate({ name: "Own", entitySchema, properties: { title: "Own" } }),
						nextCommand(command, "own"),
					)
					.pipe(Effect.flatMap(savedEntity));
				expect(
					yield* Effect.flip(
						upsertGlobalRelationship(
							{
								properties: {},
								sourceEntityId: own.id,
								targetEntityId: own.id,
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
		testTimeout,
	);

	test.effect(
		"binds entity-local events to the stored owner for creates, updates, and deletes",
		() =>
			Effect.gen(function* () {
				const a = yield* installRevisionPackage(namespacePackage(), firstUser);
				const b = yield* installRevisionPackage(namespacePackage(), firstUser);
				const changeSets = yield* ChangeSets;
				const session = yield* DatabaseSession;
				const first = yield* admittedCommand(a, firstUser, "event-a");
				const second = yield* admittedCommand(b, firstUser, "event-b");
				const own = yield* changeSets
					.commit(
						userCreate({
							name: "A",
							properties: { title: "A" },
							entitySchema: { slug: bottle, owner: definitionOwner(a.pluginId) },
						}),
						first.command,
					)
					.pipe(Effect.flatMap(savedEntity));
				const foreign = yield* changeSets
					.commit(
						userCreate({
							name: "B",
							properties: { title: "B" },
							entitySchema: { slug: bottle, owner: definitionOwner(b.pluginId) },
						}),
						second.command,
					)
					.pipe(Effect.flatMap(savedEntity));

				const localEvent = EventSchemaSlug.make("tasted");
				expect(
					(yield* createUserEvents(nextCommand(first.command, "own-event"), firstUser, [
						{ entityId: own.id, eventSchemaSlug: localEvent, properties: { title: "Own event" } },
					])).count,
				).toBe(1);
				expect(
					(yield* createUserEvents(nextCommand(second.command, "foreign-event"), firstUser, [
						{
							entityId: foreign.id,
							eventSchemaSlug: localEvent,
							properties: { title: "Foreign event" },
						},
					])).count,
				).toBe(1);
				const denied = yield* createUserEvents(
					nextCommand(first.command, "wrong-event"),
					firstUser,
					[{ entityId: foreign.id, eventSchemaSlug: localEvent, properties: { title: "Wrong" } }],
				);
				expect(denied.count).toBe(0);
				const [row] = yield* session.run((db) =>
					db.select().from(tables.event).where(eq(tables.event.entityId, foreign.id)),
				);
				assert(row);
				expect(row.eventSchemaPluginId).toBe(b.pluginId);
				const eventId = EventId.make(row.id);
				expect(
					yield* Effect.flip(
						changeUserEvents(nextCommand(first.command, "wrong-edit"), firstUser, [
							eventUpdate({
								eventId,
								patch: { properties: { remove: [], set: { title: "Wrong" } } },
							}),
						]),
					),
				).toMatchObject({ _tag: "EventCreateItemError", reason: { code: "entity-not-found" } });
				expect(
					yield* Effect.flip(
						changeUserEvents(nextCommand(first.command, "wrong-delete"), firstUser, [
							eventDelete(eventId),
						]),
					),
				).toMatchObject({ _tag: "EventCreateItemError", reason: { code: "entity-not-found" } });
				expect(
					(yield* session.run((db) =>
						db.select().from(tables.event).where(eq(tables.event.id, eventId)),
					))[0]?.properties,
				).toEqual({ title: "Foreign event" });
			}),
		testTimeout,
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
				const changeSets = yield* ChangeSets;
				const collectionSchema = {
					owner: { kind: "kernel" as const },
					slug: EntitySchemaSlug.make("collection"),
				};
				expect(
					yield* Effect.flip(
						changeSets.commit(
							userCreate({ properties: {}, name: "Unmarked", entitySchema: collectionSchema }),
							command,
						),
					),
				).toMatchObject({ reason: { code: "owner-mismatch" } });
				const item = yield* changeSets
					.commit(
						userCreate({
							name: "Item",
							properties: { title: "Item" },
							entitySchema: { slug: bottle, owner: definitionOwner(installed.pluginId) },
						}),
						nextCommand(command, "item"),
					)
					.pipe(Effect.flatMap(savedEntity));
				const container = yield* changeSets
					.commit(
						userCreate({ properties: {}, name: "Collection", entitySchema: collectionSchema }),
						kernelCollectionLifecycleCommand(nextCommand(command, "collection")),
					)
					.pipe(Effect.flatMap(savedEntity));
				const link = yield* writeRelationship(
					"upsert",
					{
						properties: {},
						userId: firstUser,
						sourceEntityId: item.id,
						targetEntityId: container.id,
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
				yield* createUserEvents(
					kernelCollectionLifecycleCommand(nextCommand(command, "collection-event")),
					firstUser,
					[
						{
							entityId: container.id,
							sessionEntityId: item.id,
							eventSchemaSlug: EventSchemaSlug.make("add-entity-to-collection"),
							properties: {
								entityId: item.id,
								entitySchemaSlug: bottle,
								relationshipProperties: {},
							},
						},
					],
				);
				expect(
					(yield* changeSets.commit(
						{
							userId: firstUser,
							entities: {
								deletes: [
									{
										entityId: item.id,
										entitySchema: { slug: bottle, owner: definitionOwner(installed.pluginId) },
									},
								],
							},
						},
						nextCommand(command, "delete-item"),
					)).deleted,
				).toEqual([item.id]);
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
						db.select().from(tables.event).where(eq(tables.event.sessionEntityId, item.id)),
					),
				).toEqual([]);
				expect(
					(yield* (yield* EntitiesRepository).getById(container.id))?.entitySchemaPluginId,
				).toBeNull();
			}),
		testTimeout,
	);

	test.effect(
		"merges plugin entity data and kernel collection memberships under the plugin",
		() =>
			Effect.gen(function* () {
				yield* ensureKernelCollections;
				const installed = yield* installRevisionPackage(namespacePackage(), firstUser);
				const { command } = yield* admittedCommand(installed, firstUser, "merge-plugin");
				const changeSets = yield* ChangeSets;
				const session = yield* DatabaseSession;
				const schema = { slug: bottle, owner: definitionOwner(installed.pluginId) };
				const collectionSchema = {
					owner: { kind: "kernel" as const },
					slug: EntitySchemaSlug.make("collection"),
				};
				const createBottle = (name: string) =>
					changeSets
						.commit(
							userCreate({ name, entitySchema: schema, properties: { title: name } }),
							nextCommand(command, `create-${name}`),
						)
						.pipe(Effect.flatMap(savedEntity));
				const from = yield* createBottle("From");
				const into = yield* createBottle("Into");
				const container = yield* changeSets
					.commit(
						userCreate({
							properties: {},
							name: "Merge collection",
							entitySchema: collectionSchema,
						}),
						kernelCollectionLifecycleCommand(nextCommand(command, "collection")),
					)
					.pipe(Effect.flatMap(savedEntity));
				const link = yield* writeRelationship(
					"upsert",
					{
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
				const tasted = yield* createUserEvents(nextCommand(command, "tasted-event"), firstUser, [
					{
						entityId: from.id,
						properties: { title: "Tasted" },
						eventSchemaSlug: EventSchemaSlug.make("tasted"),
					},
				]);
				const added = yield* createUserEvents(
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
				);
				expect([tasted.count, added.count]).toEqual([1, 1]);
				const merged = yield* mergeUserData(
					firstUser,
					{ slug: bottle, mergeFrom: from.id, mergeInto: into.id },
					nextCommand(command, "merge"),
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
				).toEqual<unknown>(
					arrayContaining([
						{ entityId: into.id, sessionEntityId: null, eventSchemaSlug: "tasted" },
						{
							entityId: container.id,
							sessionEntityId: into.id,
							eventSchemaSlug: "add-entity-to-collection",
						},
					]),
				);
			}),
		testTimeout,
	);

	test.effect(
		"allows global sources but refuses plugin merges outside the plugin's owner and schema",
		() =>
			Effect.gen(function* () {
				yield* ensureKernelCollections;
				const a = yield* installRevisionPackage(namespacePackage(), firstUser);
				const b = yield* installRevisionPackage(namespacePackage(), firstUser);
				const first = yield* admittedCommand(a, firstUser, "merge-refusals-a");
				const second = yield* admittedCommand(b, firstUser, "merge-refusals-b");
				const changeSets = yield* ChangeSets;
				const session = yield* DatabaseSession;
				const eventRows = yield* EventsRepository;
				const createBottle = (name: string, installed: typeof a, base: DomainLifecycleCommand) =>
					changeSets
						.commit(
							userCreate({
								name,
								properties: { title: name },
								entitySchema: { slug: bottle, owner: definitionOwner(installed.pluginId) },
							}),
							nextCommand(base, `create-${name}`),
						)
						.pipe(Effect.flatMap(savedEntity));
				const createCollection = (name: string) =>
					changeSets
						.commit(
							userCreate({
								name,
								properties: {},
								entitySchema: {
									owner: { kind: "kernel" as const },
									slug: EntitySchemaSlug.make("collection"),
								},
							}),
							kernelCollectionLifecycleCommand(nextCommand(first.command, name)),
						)
						.pipe(Effect.flatMap(savedEntity));
				const merge = (
					mergeFrom: string,
					mergeInto: string,
					entitySchemaSlug: EntitySchemaSlug,
					command: DomainLifecycleCommand,
				) =>
					Effect.flip(
						mergeUserData(
							firstUser,
							{
								slug: entitySchemaSlug,
								mergeFrom: EntityId.make(mergeFrom),
								mergeInto: EntityId.make(mergeInto),
							},
							command,
						),
					);
				const from = yield* createBottle("From", a, first.command);
				const into = yield* createBottle("Into", a, first.command);
				const foreignFrom = yield* createBottle("ForeignFrom", b, second.command);
				const foreignInto = yield* createBottle("ForeignInto", b, second.command);
				const left = yield* createCollection("left");
				const right = yield* createCollection("right");
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
					yield* mergeUserData(
						firstUser,
						{ slug: bottle, mergeInto: into.id, mergeFrom: globalSource },
						nextCommand(first.command, "m3"),
					),
				).toMatchObject({ movedEventsCount: 0, movedRelationshipsCount: 0 });
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
						eventSchemaPluginId: b.pluginId,
						propertiesSchema: { fields: {} },
						properties: { title: "Foreign" },
						id: EventId.make("foreign-session-event"),
						eventSchemaSlug: EventSchemaSlug.make("tasted"),
						eventSchemaName: { key: "test.tasted", namespace: b.pluginId },
						occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-13T00:00:00.000Z")),
					}),
				);
				expect(
					yield* merge(from.id, into.id, bottle, nextCommand(first.command, "m5")),
				).toMatchObject({ _tag: "EventCreateItemError", reason: { code: "entity-not-found" } });
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
		testTimeout,
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
										newer: { type: "string", description: "Newer", label: { key: "test.newer" } },
									},
								},
							})),
						},
					},
					firstUser,
				);
				expect(updated.pluginId).toBe(installed.pluginId);
				const changeSets = yield* ChangeSets;
				const entitySchema = { slug: bottle, owner: definitionOwner(installed.pluginId) };
				const continued = yield* changeSets
					.commit(
						userCreate({ entitySchema, name: "Continued", properties: { title: "Old payload" } }),
						command,
					)
					.pipe(Effect.flatMap(savedEntity));
				expect(continued.properties).toEqual({ title: "Old payload" });
				const fresh = yield* admittedCommand(updated, firstUser, "new-writer");
				const newValue = yield* changeSets
					.commit(
						userCreate({
							name: "New",
							entitySchema,
							properties: { newer: "present", title: "New payload" },
						}),
						fresh.command,
					)
					.pipe(Effect.flatMap(savedEntity));
				expect(
					yield* Effect.flip(
						changeSets.commit(
							{
								userId: firstUser,
								entities: {
									updates: [
										{ ...entityUpdate(newValue, "Old", { title: "Overwrite" }), populatedAt: null },
									],
								},
							},
							nextCommand(command, "old-update"),
						),
					),
				).toMatchObject({ reason: { code: "mutation-conflict" } });
				expect(
					yield* Effect.flip(
						changeSets.commit(
							{
								userId: firstUser,
								entities: { deletes: [{ entitySchema, entityId: newValue.id }] },
							},
							nextCommand(command, "old-delete"),
						),
					),
				).toMatchObject({ reason: { code: "mutation-conflict" } });
				expect(
					yield* Effect.flip(
						changeSets.commit(
							userCreate({
								entitySchema,
								name: "Unknown",
								properties: { title: "Old", newer: "unrecognized" },
							}),
							nextCommand(command, "unknown-payload"),
						),
					),
				).toMatchObject({ reason: { paths: [["newer"]], code: "invalid-properties" } });
				expect((yield* (yield* EntitiesRepository).getById(newValue.id))?.properties).toEqual({
					newer: "present",
					title: "New payload",
				});
			}),
		testTimeout,
	);

	test.effect(
		"rejects a newer stored value introduced while before policies run",
		() =>
			Effect.gen(function* () {
				const original = namespacePackage();
				const installed = yield* installRevisionPackage(original, firstUser);
				const { command } = yield* admittedCommand(installed, firstUser, "policy-race");
				const entitySchema = { slug: bottle, owner: definitionOwner(installed.pluginId) };
				const created = yield* (yield* ChangeSets)
					.commit(userCreate({ name: "Old", entitySchema, properties: { title: "Old" } }), command)
					.pipe(Effect.flatMap(savedEntity));
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
										newer: { type: "string", description: "Newer", label: { key: "test.newer" } },
									},
								},
							})),
						},
					},
					firstUser,
				);
				const repository = yield* EntitiesRepository;
				const session = yield* DatabaseSession;
				const oldWriter = yield* ChangeSets.make.pipe(
					Effect.provideService(
						LifecyclePolicies,
						decidingPolicies((yield* LifecyclePolicies).match, () =>
							session
								.transaction(
									repository.updateEntity({
										populatedAt: null,
										name: "Concurrent",
										entityId: created.id,
										properties: { newer: "present", title: "Concurrent" },
									}),
								)
								.pipe(Effect.orDie, Effect.as({ action: "allow" as const })),
						),
					),
				);
				expect(
					yield* Effect.flip(
						oldWriter.commit(
							{
								userId: firstUser,
								entities: {
									updates: [
										{
											...entityUpdate(created, "Overwrite", { title: "Overwrite" }),
											populatedAt: null,
										},
									],
								},
							},
							nextCommand(command, "race-update"),
						),
					),
				).toMatchObject({ reason: { code: "mutation-conflict" } });
				expect((yield* repository.getById(created.id))?.properties).toEqual({
					newer: "present",
					title: "Concurrent",
				});
			}),
		testTimeout,
	);

	test.effect(
		"preserves unknown properties deliberately allowed by the pinned declaration",
		() =>
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
										newer: { type: "string", description: "Newer", label: { key: "test.newer" } },
									},
								},
							})),
						},
					},
					firstUser,
				);
				const changeSets = yield* ChangeSets;
				const entitySchema = { slug: bottle, owner: definitionOwner(installed.pluginId) };
				const properties = { title: "Old", newer: "Allowed", opaque: { value: 1 } };
				const created = yield* changeSets
					.commit(userCreate({ properties, entitySchema, name: "Opaque" }), command)
					.pipe(Effect.flatMap(savedEntity));
				expect(created.properties).toEqual(properties);
				const updated = yield* changeSets
					.commit(
						{
							userId: firstUser,
							entities: {
								updates: [
									{
										...entityUpdate(created, "Updated", { ...properties, title: "Updated" }),
										populatedAt: null,
									},
								],
							},
						},
						nextCommand(command, "passthrough-update"),
					)
					.pipe(Effect.flatMap(savedEntity));
				expect(updated.properties).toEqual({ ...properties, title: "Updated" });
			}),
		testTimeout,
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
				const subject = { userId: firstUser, type: "user" as const };
				const repository = yield* SandboxRepository.make;
				const pin = yield* repository.getScriptPin(script.id, undefined, subject, binding);
				assert(pin?.pluginRevision);
				const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
				const command: DomainLifecycleCommand = {
					...rootLifecycleCommand({
						lane: "background",
						source: "bootstrap",
						itemIdentity: "initialize",
						accountUserId: subject.userId,
						occurredAt: "2026-10-13T00:00:00.000Z",
						initiator: { kind: "user", id: firstUser },
						executionId: AutomationExecutionId.make("namespace-initialization"),
					}),
					writeContext: principal,
				};
				const changeSets = yield* ChangeSets;
				const entitySchema = { slug: bottle, owner: definitionOwner(installed.pluginId) };
				const ensure = (
					name: string,
					properties: Record<string, string>,
					lifecycle: DomainLifecycleCommand,
				) =>
					changeSets.commit(
						{ userId: firstUser, entities: { ensures: [{ name, properties, entitySchema }] } },
						lifecycle,
					);
				yield* ensure("Seed", { title: "Seed" }, command);
				expect(
					yield* session.run((db) =>
						db
							.select({ name: tables.entity.name })
							.from(tables.entity)
							.where(and(eq(tables.entity.userId, firstUser), eq(tables.entity.name, "Seed"))),
					),
				).toEqual([{ name: "Seed" }]);
				expect(
					yield* Effect.flip(
						ensure(
							"Wrong",
							{},
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
					yield* Effect.flip(ensure("Completed", {}, nextCommand(command, "completed-binding"))),
				).toMatchObject({ reason: { code: "mutation-conflict" } });
			}),
		testTimeout,
	);

	test.effect(
		"continues captured ordinary installation work without bypassing quarantine or hidden intent",
		() =>
			Effect.gen(function* () {
				const installed = yield* installRevisionPackage(namespacePackage(), firstUser);
				const { command } = yield* admittedCommand(installed, firstUser, "historical-health");
				const session = yield* DatabaseSession;
				const changeSets = yield* ChangeSets;
				const entitySchema = { slug: bottle, owner: definitionOwner(installed.pluginId) };
				for (const health of ["installing", "needs-configuration"] as const) {
					yield* session.run((db) =>
						db
							.update(tables.pluginInstallation)
							.set({ health })
							.where(eq(tables.pluginInstallation.id, installed.installation.id)),
					);
					const result = yield* changeSets
						.commit(
							userCreate({ entitySchema, name: health, properties: { title: health } }),
							nextCommand(command, health),
						)
						.pipe(Effect.flatMap(savedEntity));
					expect(result.entitySchemaPluginId).toBe<unknown>(installed.pluginId);
				}
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ isHidden: true, health: "ready" })
						.where(eq(tables.pluginInstallation.id, installed.installation.id)),
				);
				expect(
					yield* Effect.flip(
						changeSets.commit(
							userCreate({ entitySchema, name: "Hidden", properties: {} }),
							nextCommand(command, "hidden"),
						),
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
						changeSets.commit(
							userCreate({ entitySchema, properties: {}, name: "Quarantined" }),
							nextCommand(command, "quarantined"),
						),
					),
				).toMatchObject({ reason: { code: "mutation-conflict" } });
			}),
		testTimeout,
	);

	test.effect(
		"rejects pinned declarations missing from the pinned or active revision",
		() =>
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
									slug: "added-link",
									name: { key: "test.added" },
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
										{
											slug: "opened",
											name: { key: "test.opened" },
											propertiesSchema: titleProperties,
										},
									],
								},
								...newerEntities,
								entityDeclaration("added"),
							],
						},
					},
					firstUser,
				);
				const changeSets = yield* ChangeSets;
				const owner = definitionOwner(installed.pluginId);
				const create = (slug: string, itemIdentity: string) =>
					Effect.flip(
						changeSets.commit(
							userCreate({
								name: slug,
								properties: { title: slug },
								entitySchema: { owner, slug: EntitySchemaSlug.make(slug) },
							}),
							nextCommand(command, itemIdentity),
						),
					);
				expect(yield* create("retired", "retired-entity")).toMatchObject({
					reason: { code: "mutation-conflict" },
				});
				expect(yield* create("added", "added-entity")).toMatchObject({
					reason: { code: "mutation-conflict" },
				});
				const own = yield* changeSets
					.commit(
						userCreate({
							name: "Own",
							properties: { title: "Own" },
							entitySchema: { owner, slug: bottle },
						}),
						nextCommand(command, "own-entity"),
					)
					.pipe(Effect.flatMap(savedEntity));
				const eventSchemaSlug = EventSchemaSlug.make("opened");
				const denied = yield* createUserEvents(nextCommand(command, "added-event"), firstUser, [
					{ eventSchemaSlug, entityId: own.id, properties: { title: "Opened" } },
				]);
				expect(denied.count).toBe(0);
				expect(denied.failure).toEqual({
					index: 0,
					reason: { eventSchemaSlug, code: "event-schema-not-found" },
				});
				expect(
					yield* Effect.flip(
						writeRelationship(
							"upsert",
							{
								properties: {},
								userId: firstUser,
								sourceEntityId: own.id,
								targetEntityId: own.id,
								relationshipSchema: { owner, slug: RelationshipSchemaSlug.make("added-link") },
							},
							nextCommand(command, "added-link"),
						),
					),
				).toMatchObject({ reason: { code: "concurrent-relationship-change" } });
			}),
		testTimeout,
	);

	test.effect(
		"lets a user-scope provider upsert change an immutable property",
		() =>
			Effect.gen(function* () {
				const installed = yield* installRevisionPackage(namespacePackage(), firstUser);
				const { command, providerId } = yield* admittedCommand(
					installed,
					firstUser,
					"immutable-upsert",
				);
				const changeSets = yield* ChangeSets;
				const upsert = (properties: object, itemIdentity: string) =>
					changeSets
						.commit(
							userCreate({
								properties,
								name: "Bottle",
								populatedAt: null,
								externalId: "immutable-bottle",
								provider: { providerId, updateExisting: true },
								entitySchema: { slug: bottle, owner: definitionOwner(installed.pluginId) },
							}),
							nextCommand(command, itemIdentity),
						)
						.pipe(Effect.flatMap(savedEntity));
				yield* upsert({ code: "a", title: "Bottle" }, "immutable-create");
				const updated = yield* upsert({ code: "b", title: "Bottle" }, "immutable-update");
				expect(updated.properties).toEqual({ code: "b", title: "Bottle" });
			}),
		testTimeout,
	);

	test.effect(
		"rejects pinned writes after session, plugin, installation, or account changes",
		() =>
			Effect.gen(function* () {
				const installed = yield* installRevisionPackage(namespacePackage(), firstUser);
				const foreignPlugin = yield* installRevisionPackage(namespacePackage(), firstUser);
				const { command } = yield* admittedCommand(installed, firstUser, "authority-changes");
				const foreignCommand = (yield* admittedCommand(foreignPlugin, firstUser, "foreign-session"))
					.command;
				const session = yield* DatabaseSession;
				const changeSets = yield* ChangeSets;
				const own = yield* changeSets
					.commit(
						userCreate({
							name: "Own",
							properties: { title: "Own" },
							entitySchema: { slug: bottle, owner: definitionOwner(installed.pluginId) },
						}),
						nextCommand(command, "own-entity"),
					)
					.pipe(Effect.flatMap(savedEntity));
				const foreign = yield* changeSets
					.commit(
						userCreate({
							name: "Foreign",
							properties: { title: "Foreign" },
							entitySchema: { slug: bottle, owner: definitionOwner(foreignPlugin.pluginId) },
						}),
						foreignCommand,
					)
					.pipe(Effect.flatMap(savedEntity));
				const denied = yield* createUserEvents(
					nextCommand(command, "foreign-session-event"),
					firstUser,
					[
						{
							entityId: own.id,
							sessionEntityId: foreign.id,
							properties: { title: "Tasted" },
							eventSchemaSlug: EventSchemaSlug.make("tasted"),
						},
					],
				);
				expect(denied.count).toBe(0);
				expect(denied.failure).toEqual({
					index: 0,
					reason: { entityId: foreign.id, code: "session-entity-not-found" },
				});
				const rejected = (itemIdentity: string) =>
					Effect.gen(function* () {
						expect(
							yield* Effect.flip(
								changeSets.commit(
									userCreate({
										name: itemIdentity,
										properties: { title: itemIdentity },
										entitySchema: { slug: bottle, owner: definitionOwner(installed.pluginId) },
									}),
									nextCommand(command, itemIdentity),
								),
							),
						).toMatchObject({ reason: { code: "mutation-conflict" } });
					});
				const setInstallation = (values: Partial<typeof tables.pluginInstallation.$inferInsert>) =>
					session.run((db) =>
						db
							.update(tables.pluginInstallation)
							.set(values)
							.where(eq(tables.pluginInstallation.id, installed.installation.id)),
					);
				yield* setInstallation({ ingestionRetiring: true });
				yield* rejected("retiring");
				yield* setInstallation({ ingestionRetiring: false, uninstalledAt: retiredAt });
				yield* rejected("uninstalled");
				yield* setInstallation({ uninstalledAt: null });
				yield* session.run((db) =>
					db
						.update(tables.user)
						.set({ retiringAt: new Date() })
						.where(eq(tables.user.id, firstUser)),
				);
				expect(
					yield* Effect.flip(
						changeSets.commit(
							userCreate({
								name: "retiring-account",
								properties: { title: "retiring-account" },
								entitySchema: { slug: bottle, owner: definitionOwner(installed.pluginId) },
							}),
							nextCommand(command, "retiring-account"),
						),
					),
				).toMatchObject({ message: "Mutation command account is being retired" });
				yield* session.run((db) =>
					db.update(tables.user).set({ retiringAt: null }).where(eq(tables.user.id, firstUser)),
				);
				yield* session.run((db) =>
					db
						.update(tables.plugin)
						.set({ status: "disabled" })
						.where(eq(tables.plugin.id, installed.pluginId)),
				);
				yield* rejected("disabled-plugin");
			}),
		testTimeout,
	);

	test.effect(
		"keeps complete private provider graphs and reconciliation isolated by user and local owner",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({ id: secondUser, name: "Second", email: "second-namespace@example.test" }),
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
							coverage: { status: "complete" },
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
				const populationRequests = yield* EnrichmentRequests;
				const populate = (
					installed: typeof first,
					admission: typeof firstAdmission,
					userId: UserId,
					value: unknown,
					executionId: string,
					mode: "ensure" | "refresh",
				) => {
					return runPopulationAttempt(
						{
							mode,
							executionId,
							level: "full",
							requestAttempt: 1,
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
						Effect.provideService(EnrichmentRequests, {
							...populationRequests,
							recordBaseCheck: () => Effect.void,
							ownsPopulation: () => Effect.succeed(true),
						}),
						Effect.provideService(EntityImportWorkflowOperations, {
							processRelatedPage: () => Effect.die("unused"),
							completeProviderEntityImport: () => Effect.void,
							resolveRelatedInputs: () => Effect.die("unused"),
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
		testTimeout,
	);
});

layer(relationshipChangeSetsLayer())((test) => {
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
				const changeSets = yield* ChangeSets;
				const session = yield* DatabaseSession;
				const otherUser = UserId.make("batch-scope-owner");
				const ownSchema = { slug: bottle, owner: definitionOwner(installed.pluginId) };
				const item = (externalId: string): GlobalUpsert => ({
					externalId,
					name: externalId,
					populatedAt: null,
					entitySchema: ownSchema,
					properties: { title: externalId },
					provider: { providerId, updateExisting: false },
				});
				const write = (
					items: ReadonlyArray<GlobalUpsert>,
					userId: null | UserId = firstUser,
					lifecycle = command,
				) => changeSets.commit({ userId, globalEntities: items }, lifecycle);
				const kernelSchema = { slug: bottle, owner: { kind: "kernel" as const } };
				const foreignSchema = { slug: bottle, owner: definitionOwner(foreign.pluginId) };
				for (const [failed, reason] of [
					[
						write([item("own"), { ...item("foreign"), entitySchema: foreignSchema }]),
						"owner-mismatch",
					],
					[write([item("global")], null), "global-scope-forbidden"],
					[write([item("other-user")], otherUser), "mutation-conflict"],
					[
						write(
							[
								{ ...item("collection"), entitySchema: kernelSchema },
								{ ...item("kernel"), entitySchema: kernelSchema },
							],
							firstUser,
							kernelCollectionLifecycleCommand(nextCommand(command, "collection")),
						),
						"owner-mismatch",
					],
				] as const) {
					expect(yield* Effect.flip(failed)).toMatchObject({ reason: { code: reason } });
				}
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ ingestionRetiring: true })
						.where(eq(tables.pluginInstallation.id, installed.installation.id)),
				);
				expect(yield* Effect.flip(write([item("retiring")]))).toMatchObject({
					reason: { code: "mutation-conflict" },
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
						.values({ id: otherUser, name: "Other", email: "batch-scope@example.test" }),
				);
				const shared = (id: string, userId: null | UserId) => ({
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
				const [result] = created.entities;
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
		testTimeout,
	);
});

layer(relationshipChangeSetsLayer())((test) => {
	test.effect(
		"scopes batch event updates and deletes to the writer's plugin and user",
		() =>
			Effect.gen(function* () {
				yield* ensureKernelCollections;
				const session = yield* DatabaseSession;
				const otherUser = UserId.make("batch-event-other-user");
				yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({ id: otherUser, name: "Other", email: "batch-event-other@example.test" }),
				);
				const a = yield* installRevisionPackage(namespacePackage(), firstUser);
				const b = yield* installRevisionPackage(namespacePackage(), firstUser);
				const c = yield* installRevisionPackage(namespacePackage(), otherUser);
				const changeSets = yield* ChangeSets;
				const writer = yield* admittedCommand(a, firstUser, "batch-event-a");
				const foreignWriter = yield* admittedCommand(b, firstUser, "batch-event-b");
				const otherWriter = yield* admittedCommand(c, otherUser, "batch-event-c");
				const tasted = EventSchemaSlug.make("tasted");
				const recordEvent = Effect.fnUntraced(function* (
					command: DomainLifecycleCommand,
					userId: UserId,
					entity: "collection" | { readonly entitySchema: GlobalUpsert["entitySchema"] },
					eventSchemaSlug: EventSchemaSlug,
					identity: string,
				) {
					const created = yield* changeSets
						.commit(
							userCreate(
								{
									name: identity,
									properties: entity === "collection" ? {} : { title: identity },
									entitySchema:
										entity === "collection"
											? { owner: { kind: "kernel" }, slug: EntitySchemaSlug.make("collection") }
											: entity.entitySchema,
								},
								userId,
							),
							entity === "collection"
								? kernelCollectionLifecycleCommand(nextCommand(command, `${identity}-entity`))
								: nextCommand(command, `${identity}-entity`),
						)
						.pipe(Effect.flatMap(savedEntity));
					const eventCommand = nextCommand(command, `${identity}-event`);
					yield* createUserEvents(
						entity === "collection" ? kernelCollectionLifecycleCommand(eventCommand) : eventCommand,
						userId,
						[{ eventSchemaSlug, entityId: created.id, properties: { text: identity } }],
					);
					const [row] = yield* session.run((db) =>
						db.select().from(tables.event).where(eq(tables.event.entityId, created.id)),
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
							changeUserEvents(nextCommand(writer.command, `update-${eventId}`), firstUser, [
								eventUpdate({
									eventId,
									patch: { properties: { remove: [], set: { text: "Wrong" } } },
								}),
							]),
						),
					).toMatchObject({ _tag: "EventCreateItemError", reason: { code: "entity-not-found" } });
					expect(
						yield* Effect.flip(
							changeUserEvents(nextCommand(writer.command, `delete-${eventId}`), firstUser, [
								eventDelete(eventId),
							]),
						),
					).toMatchObject({ _tag: "EventCreateItemError", reason: { code: "entity-not-found" } });
				}
				expect(
					yield* Effect.flip(
						changeUserEvents(nextCommand(writer.command, "update-other-user"), firstUser, [
							eventUpdate({
								eventId: otherUsersEvent,
								patch: { properties: { remove: [], set: { text: "Wrong" } } },
							}),
						]),
					),
				).toMatchObject({ reason: { code: "event-not-found" } });
				expect(
					yield* Effect.flip(
						changeUserEvents(nextCommand(writer.command, "delete-other-user"), firstUser, [
							eventDelete(otherUsersEvent),
						]),
					),
				).toMatchObject({ reason: { code: "event-not-found" } });
				expect(yield* storedProperties).toEqual(before);
			}),
		testTimeout,
	);
});
