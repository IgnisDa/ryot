import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import {
	EntityEditorRefused,
	type EntityEditorSaveRequest,
	type EntityEditorSaveSubmission,
	type EntityEditorSubmission,
} from "@ryot-app/contract/modules/entities/editor";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	EntityId,
	EntitySchemaSlug,
	PluginId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { column, field, rows, table } from "@ryot-app/ryotql";
import { and, eq } from "drizzle-orm";
import { DateTime, Effect, Layer, Ref, Schema } from "effect";
import { assert, describe } from "vitest";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import type { LifecycleDispatchPlan } from "#modules/automations/lifecycle/planning";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { MutationReceipts } from "#modules/mutations/receipts";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { testPluginPackageId } from "#modules/plugins/test-support";
import {
	command,
	relationshipDatabaseLayer,
	userId,
} from "#modules/relationships/lifecycle.test-support";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { RyotQLService } from "#modules/ryotql/service";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { EntityEditorService } from "./service";

const item = EntitySchemaSlug.make("item");
const part = EntitySchemaSlug.make("part");
const itemPart = RelationshipSchemaSlug.make("item-part");
const otherUser = UserId.make("editor-other-user");
const itemEditor = {
	relationships: [
		{ slug: "item-part", direction: "outgoing" },
		{ slug: "item-link", direction: "outgoing" },
	],
} as const;
const partEditor = {
	deletable: true,
	relationships: [
		{ slug: "item-child", direction: "parent" },
		{ slug: "item-extra", direction: "incoming" },
	],
} as const;

const itemProperties = {
	fields: {
		title: { type: "string", label: "Title", description: "Title" },
		code: { label: "Code", type: "string", immutable: true, description: "Code" },
	},
} as const;
const titleProperties = {
	fields: { title: { type: "string", label: "Title", description: "Title" } },
} as const;
const roleProperties = {
	fields: { role: { label: "Role", type: "string", description: "Role" } },
} as const;

const editorPackage = (options: { readonly policy?: boolean } = {}) => {
	const source = revisionPackage("editor", "one", item, testPluginPackageId());
	const automation = source.scripts.find(({ metadata }) => metadata.kind === "automation");
	assert(automation?.metadata.kind === "automation");
	const policy = {
		...automation,
		slug: "editor.policy",
		contentHash: "editor-policy-hash",
		metadata: {
			...automation.metadata,
			capabilities: [],
			slug: "editor.policy",
			automationType: "policy" as const,
			inputProjection: { entity: { properties: ["code"] } },
		},
	};
	const declaration = (
		slug: string,
		propertiesSchema: typeof itemProperties | typeof titleProperties,
	) => ({ slug, name: slug, icon: "box", propertiesSchema, eventSchemas: [] });
	return {
		...source,
		scripts: options.policy ? [...source.scripts, policy] : source.scripts,
		manifest: {
			...source.manifest,
			scripts: options.policy
				? [...source.manifest.scripts, { ...policy.metadata, entry: "backend/policy.sandbox.ts" }]
				: source.manifest.scripts,
			entitySchemas: [
				{ ...declaration("item", itemProperties), editor: itemEditor },
				{ ...declaration("part", titleProperties), editor: partEditor },
			],
			relationshipSchemas: [
				{
					name: "Parts",
					slug: "item-part",
					sourceEntitySchemaSlug: "item",
					targetEntitySchemaSlug: "part",
					propertiesSchema: roleProperties,
				},
				{
					name: "Links",
					slug: "item-link",
					sourceEntitySchemaSlug: "item",
					targetEntitySchemaSlug: "item",
					propertiesSchema: { fields: {} },
				},
				{
					name: "Children",
					slug: "item-child",
					sourceEntitySchemaSlug: "item",
					targetEntitySchemaSlug: "part",
					propertiesSchema: { fields: {} },
				},
				{
					name: "Extras",
					slug: "item-extra",
					sourceEntitySchemaSlug: "item",
					targetEntitySchemaSlug: "part",
					propertiesSchema: { fields: {} },
				},
				{
					slug: "part-link",
					name: "Part links",
					sourceEntitySchemaSlug: "part",
					targetEntitySchemaSlug: "part",
					propertiesSchema: { fields: {} },
				},
				{
					slug: "loose-link",
					name: "Loose links",
					sourceEntitySchemaSlug: null,
					targetEntitySchemaSlug: null,
					propertiesSchema: { fields: {} },
				},
			],
			hooks: [
				...source.manifest.hooks.map((hook) =>
					Object.assign({}, hook, {
						targets: [
							{ resource: "entity", operation: "create", entitySchemaSlug: "item" },
							{ resource: "entity", operation: "update", entitySchemaSlug: "item" },
							{
								operation: "create",
								resource: "relationship",
								relationshipSchemaSlug: "item-part",
							},
							{
								operation: "delete",
								resource: "relationship",
								relationshipSchemaSlug: "item-part",
							},
							{ operation: "emit", resource: "signal", signalSchemaSlug: "editor.signal" },
						] as const,
					}),
				),
				...(options.policy
					? [
							{
								name: "Policy",
								slug: "editor-policy",
								scriptSlug: policy.slug,
								stage: "before" as const,
								targets: [
									{
										entitySchemaSlug: "item",
										resource: "entity" as const,
										operation: "update" as const,
									},
								],
							},
						]
					: []),
			],
		},
	};
};

const setup = Effect.fnUntraced(function* (options: { readonly policy?: boolean } = {}) {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		db
			.insert(tables.user)
			.values({
				id: otherUser,
				name: "Other",
				email: "other@example.test",
				accountGeneration: "test-account-generation",
			})
			.onConflictDoNothing(),
	);
	const installed = yield* installRevisionPackage(editorPackage(options), userId);
	const owner = PluginId.make(installed.pluginId);
	const entities = yield* EntitiesRepository;
	const insert = (id: string, slug: EntitySchemaSlug, ownerUserId: UserId | null, name = id) =>
		entities
			.insertEntities([
				{
					name,
					populatedAt: null,
					id: EntityId.make(id),
					entitySchemaSlug: slug,
					entitySchemaPluginId: installed.pluginId,
					properties: slug === item ? { code: "c", title: name } : { title: name },
					...(ownerUserId === null
						? { scope: "global" as const }
						: { userId: ownerUserId, scope: "user" as const }),
				},
			])
			.pipe(Effect.map(([entity]) => entity));
	return { owner, insert, installed };
});

const makeEditor = Effect.fnUntraced(function* (
	overrides: {
		readonly execution?: Partial<LifecycleExecution["Service"]>;
		readonly entities?: Partial<EntitiesService["Service"]>;
		readonly relationships?: Partial<RelationshipsService["Service"]>;
		readonly relationshipsRepository?: Partial<RelationshipsRepository["Service"]>;
		readonly receipts?: Partial<MutationReceipts["Service"]>;
	} = {},
) {
	const execution = { ...(yield* LifecycleExecution), ...overrides.execution };
	const entities = {
		...(yield* EntitiesService.make.pipe(Effect.provideService(LifecycleExecution, execution))),
		...overrides.entities,
	};
	const relationships = { ...(yield* RelationshipsService), ...overrides.relationships };
	const repository = { ...(yield* RelationshipsRepository), ...overrides.relationshipsRepository };
	const receipts = { ...(yield* MutationReceipts), ...overrides.receipts };
	return yield* EntityEditorService.make.pipe(
		Effect.provideService(MutationReceipts, receipts),
		Effect.provideService(LifecycleExecution, execution),
		Effect.provideService(EntitiesService, entities),
		Effect.provideService(RelationshipsService, relationships),
		Effect.provideService(RelationshipsRepository, repository),
	);
});

const submission = (
	owner: PluginId,
	input: Partial<EntityEditorSaveSubmission> & Pick<EntityEditorSaveSubmission, "target">,
): EntityEditorSaveSubmission => ({
	action: "save",
	name: "Item",
	relationships: [],
	properties: { code: "c", title: "Item" },
	entitySchema: { slug: item, owner: definitionOwner(owner) },
	...input,
});

const submitEdit = (
	editor: EntityEditorService["Service"],
	idempotencyKey: string,
	input: EntityEditorSubmission,
) =>
	editor.submit({
		userId,
		accountGeneration: { userId, token: "test-account-generation" },
		request: { idempotencyKey, submission: input, submittedAt: "2026-10-13T00:00:00.000Z" },
	});

const partSubmission = (
	owner: PluginId,
	input: Partial<EntityEditorSaveSubmission> & Pick<EntityEditorSaveSubmission, "target">,
) =>
	submission(owner, {
		name: "Part",
		properties: { title: "Part" },
		entitySchema: { slug: part, owner: definitionOwner(owner) },
		...input,
	});

const childGroup = (id: string) => ({
	relationshipSchemaSlug: "item-child",
	targets: [target(id)],
});

const extraGroup = (...ids: ReadonlyArray<string>) => ({
	relationshipSchemaSlug: "item-extra",
	targets: ids.map((id) => target(id)),
});

const storedExpected = Effect.fnUntraced(function* (
	entityId: string,
	relationships: EntityEditorSaveSubmission["relationships"] = [],
) {
	const session = yield* DatabaseSession;
	const [stored] = yield* session.run((db) =>
		db.select().from(tables.entity).where(eq(tables.entity.id, entityId)),
	);
	assert(stored);
	return expectedOf(
		{ name: stored.name, properties: stored.properties, updatedAt: stored.updatedAt.toISOString() },
		relationships,
	);
});

const submitDelete = (
	editor: EntityEditorService["Service"],
	idempotencyKey: string,
	input: { owner: PluginId; entityId: string; expectedUpdatedAt: string; slug?: EntitySchemaSlug },
	user: UserId = userId,
) =>
	editor.submit({
		userId: user,
		accountGeneration: { userId: user, token: "test-account-generation" },
		request: {
			idempotencyKey,
			submittedAt: "2026-10-13T00:00:00.000Z",
			submission: {
				action: "delete",
				entityId: EntityId.make(input.entityId),
				expectedUpdatedAt: input.expectedUpdatedAt,
				entitySchema: { slug: input.slug ?? part, owner: definitionOwner(input.owner) },
			},
		},
	});

const target = (id: string, role?: string) => ({
	entityId: EntityId.make(id),
	properties: role === undefined ? {} : { role },
});

const tablesState = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	const entityRows = yield* session.run((db) => db.select().from(tables.entity));
	const relationshipRows = yield* session.run((db) => db.select().from(tables.relationship));
	const receipts = yield* session.run((db) => db.select().from(tables.mutationReceipt));
	return {
		entityRows,
		relationshipRows,
		entityReceipts: receipts.filter(({ commandKind }) => commandKind.startsWith("entity:")),
		editorReceipts: receipts.filter(({ commandKind }) => commandKind === "entity-editor:save"),
	};
});

const expectedOf = (
	entity: { name: string; updatedAt: string; properties: unknown },
	relationships: EntityEditorSaveSubmission["relationships"] = [],
) => ({
	relationships,
	name: entity.name,
	updatedAt: entity.updatedAt,
	properties: Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
		entity.properties,
	),
});

const dispatched = Effect.gen(function* () {
	const calls = yield* Ref.make<ReadonlyArray<ReadonlyArray<LifecycleDispatchPlan>>>([]);
	return {
		calls: Ref.get(calls),
		dispatch: (plans: ReadonlyArray<LifecycleDispatchPlan>) =>
			Ref.update(calls, (all) => [...all, plans]).pipe(Effect.as([])),
	};
});

const editorCase = (
	name: string,
	body: Effect.Effect<void, unknown, Layer.Success<ReturnType<typeof freshLayer>>>,
) => layer(freshLayer())((test) => test.effect(name, () => body));

const freshLayer = () =>
	MutationReceipts.layer.pipe(Layer.provideMerge(relationshipDatabaseLayer()));

describe("EntityEditorService", () => {
	editorCase(
		"creates an entity with relationships in one commit and replays idempotently",
		Effect.gen(function* () {
			const { owner, insert } = yield* setup();
			yield* insert("part-a", part, userId);
			yield* insert("part-b", part, userId);
			const log = yield* dispatched;
			const editor = yield* makeEditor({ execution: { dispatch: log.dispatch } });
			const input = submission(owner, {
				target: { kind: "create" },
				relationships: [
					{
						relationshipSchemaSlug: "item-part",
						targets: [target("part-a", "main"), target("part-b", "side")],
					},
				],
			});
			const first = yield* submitEdit(editor, "create-with-relationships", input);
			assert(first.output.kind === "saved");
			const savedId = first.output.entityId;
			const state = yield* tablesState;
			const created = state.entityRows.find(({ id }) => id === savedId);
			expect(created?.userId).toBe(userId);
			expect(created?.properties).toEqual({ code: "c", title: "Item" });
			expect(
				state.relationshipRows
					.filter(({ sourceEntityId }) => sourceEntityId === savedId)
					.map(({ properties, targetEntityId }) => ({ properties, targetEntityId }))
					.sort((left, right) => left.targetEntityId.localeCompare(right.targetEntityId)),
			).toEqual([
				{ targetEntityId: "part-a", properties: { role: "main" } },
				{ targetEntityId: "part-b", properties: { role: "side" } },
			]);
			expect(state.editorReceipts).toHaveLength(1);

			const replay = yield* submitEdit(editor, "create-with-relationships", input);
			expect(replay.output).toEqual(first.output);
			const after = yield* tablesState;
			expect(after.entityRows).toHaveLength(state.entityRows.length);
			expect(after.relationshipRows).toHaveLength(state.relationshipRows.length);
			const calls = yield* log.calls;
			expect(calls).toHaveLength(2);
			expect(calls[1]).toEqual(calls[0]);
			expect(calls[0]?.length).toBeGreaterThan(0);

			const conflict = yield* submitEdit(editor, "create-with-relationships", {
				...input,
				name: "Different",
			}).pipe(Effect.flip);
			expect(conflict).toBeInstanceOf(EntityEditorRefused);
		}),
	);

	editorCase(
		"applies the relationship diff on update, replacing properties of kept targets",
		Effect.gen(function* () {
			const { owner, insert } = yield* setup();
			const entity = yield* insert("diff-item", item, userId, "Diff");
			assert(entity);
			for (const id of ["diff-a", "diff-b", "diff-c"]) {
				yield* insert(id, part, userId);
			}
			const editor = yield* makeEditor();
			const created = yield* submitEdit(
				editor,
				"diff-seed",
				submission(owner, {
					target: { kind: "create" },
					relationships: [
						{
							relationshipSchemaSlug: "item-part",
							targets: [target("diff-a", "one"), target("diff-b", "two")],
						},
					],
				}),
			);
			assert(created.output.kind === "saved");
			const session = yield* DatabaseSession;
			const sourceId = created.output.entityId;
			const [stored] = yield* session.run((db) =>
				db.select().from(tables.entity).where(eq(tables.entity.id, sourceId)),
			);
			assert(stored);
			const updated = yield* submitEdit(
				editor,
				"diff-update",
				submission(owner, {
					name: "Renamed",
					properties: { code: "c", title: "Renamed" },
					relationships: [
						{
							relationshipSchemaSlug: "item-part",
							targets: [target("diff-a", "changed"), target("diff-c", "new")],
						},
					],
					target: {
						kind: "update",
						entityId: sourceId,
						expected: expectedOf(
							{
								name: stored.name,
								properties: stored.properties,
								updatedAt: stored.updatedAt.toISOString(),
							},
							[
								{
									relationshipSchemaSlug: "item-part",
									targets: [target("diff-b", "two"), target("diff-a", "one")],
								},
							],
						),
					},
				}),
			);
			expect(updated.output).toEqual({ kind: "saved", entityId: sourceId });
			const state = yield* tablesState;
			expect(state.entityRows.find(({ id }) => id === sourceId)?.name).toBe("Renamed");
			expect(
				state.relationshipRows
					.filter(({ sourceEntityId }) => sourceEntityId === sourceId)
					.map(({ properties, targetEntityId }) => ({ properties, targetEntityId }))
					.sort((left, right) => left.targetEntityId.localeCompare(right.targetEntityId)),
			).toEqual([
				{ targetEntityId: "diff-a", properties: { role: "changed" } },
				{ targetEntityId: "diff-c", properties: { role: "new" } },
			]);
		}),
	);

	editorCase(
		"reports stale when the expected snapshot differs",
		Effect.gen(function* () {
			const { owner, insert } = yield* setup();
			const entity = yield* insert("stale-item", item, userId, "Stale");
			assert(entity);
			const editor = yield* makeEditor();
			const result = yield* submitEdit(
				editor,
				"stale-update",
				submission(owner, {
					target: {
						kind: "update",
						entityId: entity.id,
						expected: {
							name: "Old",
							relationships: [],
							properties: { code: "c" },
							updatedAt: entity.updatedAt,
						},
					},
				}),
			);
			expect(result.output).toEqual({ kind: "stale" });
			expect((yield* tablesState).editorReceipts).toHaveLength(0);
		}),
	);

	editorCase(
		"rejects a changed or omitted immutable property as invalid",
		Effect.gen(function* () {
			const { owner, insert } = yield* setup();
			const entity = yield* insert("immutable-item", item, userId, "Immutable");
			assert(entity);
			const editor = yield* makeEditor();
			const update = (id: string, properties: Record<string, unknown>) =>
				submitEdit(
					editor,
					id,
					submission(owner, {
						properties,
						target: { kind: "update", entityId: entity.id, expected: expectedOf(entity) },
					}),
				);
			for (const [id, properties] of [
				["immutable-changed", { title: "x", code: "other" }],
				["immutable-omitted", { title: "x" }],
			] as const) {
				const result = yield* update(id, properties);
				expect(result.output).toEqual({
					kind: "invalid",
					message: "code cannot be changed after creation",
				});
			}
			const kept = yield* update("immutable-kept", { code: "c", title: "changed" });
			expect(kept.output).toEqual({ kind: "saved", entityId: entity.id });
		}),
	);

	editorCase(
		"refuses schemas without an editor and relationships the editor does not declare",
		Effect.gen(function* () {
			const { owner } = yield* setup();
			const editor = yield* makeEditor();
			const run = (id: string, input: EntityEditorSubmission) => submitEdit(editor, id, input);
			for (const slug of ["nope", "loose"]) {
				const result = yield* run(
					`schema-${slug}`,
					submission(owner, {
						target: { kind: "create" },
						properties: { title: "Part" },
						entitySchema: { owner: definitionOwner(owner), slug: EntitySchemaSlug.make(slug) },
					}),
				);
				expect(result.output).toEqual({
					kind: "invalid",
					message: "This entity schema cannot be edited here",
				});
			}
			for (const slug of ["nope", "item-extra", "part-link", "loose-link"]) {
				const result = yield* run(
					`relationship-${slug}`,
					submission(owner, {
						target: { kind: "create" },
						relationships: [{ targets: [], relationshipSchemaSlug: slug }],
					}),
				);
				expect(result.output).toEqual({
					kind: "invalid",
					message: `Relationship ${slug} is not editable here`,
				});
			}
			const kernel = yield* run(
				"kernel-owner",
				submission(owner, {
					target: { kind: "create" },
					entitySchema: { slug: item, owner: { kind: "kernel" } },
				}),
			);
			expect(kernel.output).toMatchObject({ kind: "invalid" });
			expect((yield* tablesState).entityRows.filter(({ name }) => name === "Item")).toEqual([]);
		}),
	);

	editorCase(
		"refuses non-user-owned, other-schema, and other-user entities identically",
		Effect.gen(function* () {
			const { owner, insert } = yield* setup();
			const global = yield* insert("global-item", item, null);
			const wrongSchema = yield* insert("wrong-schema", part, userId);
			const foreign = yield* insert("foreign-item", item, otherUser);
			assert(global && wrongSchema && foreign);
			const editor = yield* makeEditor();
			const run = (id: string, entityId: EntityId, expected: ReturnType<typeof expectedOf>) =>
				submitEdit(
					editor,
					id,
					submission(owner, { target: { entityId, expected, kind: "update" } }),
				).pipe(Effect.flip);
			for (const entity of [global, wrongSchema]) {
				const error = yield* run(`refused-${entity.id}`, entity.id, expectedOf(entity));
				expect(error).toMatchObject({ _tag: "EntityNotFound" });
			}
			const matching = yield* run("foreign-match", foreign.id, expectedOf(foreign));
			const mismatching = yield* run("foreign-mismatch", foreign.id, {
				name: "x",
				properties: {},
				relationships: [],
				updatedAt: "2020-01-01T00:00:00.000Z",
			});
			expect(matching).toMatchObject({ _tag: "EntityNotFound" });
			expect(mismatching).toEqual(matching);
			const missing = yield* run("missing", EntityId.make("missing-entity"), expectedOf(foreign));
			expect(missing).toMatchObject({ _tag: "EntityNotFound" });
		}),
	);

	editorCase(
		"rejects over-cap, duplicate, and oversized relationship changes",
		Effect.gen(function* () {
			const { owner, insert } = yield* setup();
			const editor = yield* makeEditor();
			const run = (id: string, input: EntityEditorSubmission) => submitEdit(editor, id, input);
			const many = Array.from({ length: 201 }, (_, index) => target(`cap-${index}`));
			const overCap = yield* run(
				"over-cap",
				submission(owner, {
					target: { kind: "create" },
					relationships: [{ targets: many, relationshipSchemaSlug: "item-part" }],
				}),
			);
			expect(overCap.output).toMatchObject({ kind: "invalid" });
			const duplicate = yield* run(
				"duplicate",
				submission(owner, {
					target: { kind: "create" },
					relationships: [
						{ relationshipSchemaSlug: "item-part", targets: [target("dup"), target("dup")] },
					],
				}),
			);
			expect(duplicate.output).toMatchObject({ kind: "invalid" });
			const duplicateGroup = yield* run(
				"duplicate-group",
				submission(owner, {
					target: { kind: "create" },
					relationships: [
						{ targets: [], relationshipSchemaSlug: "item-part" },
						{ targets: [], relationshipSchemaSlug: "item-part" },
					],
				}),
			);
			expect(duplicateGroup.output).toMatchObject({ kind: "invalid" });

			const entity = yield* insert("many-deletes", item, userId);
			assert(entity);
			const session = yield* DatabaseSession;
			for (let index = 0; index < 101; index += 1) {
				const partId = `delete-part-${index}`;
				yield* insert(partId, part, userId);
				yield* session.run((db) =>
					db
						.insert(tables.relationship)
						.values({
							userId,
							properties: {},
							targetEntityId: partId,
							sourceEntityId: entity.id,
							relationshipSchemaSlug: "item-part",
							relationshipSchemaPluginId: entity.entitySchemaPluginId,
						}),
				);
			}
			const deletes = yield* run(
				"deletes",
				submission(owner, {
					relationships: [{ targets: [], relationshipSchemaSlug: "item-part" }],
					target: {
						kind: "update",
						entityId: entity.id,
						expected: expectedOf(entity, [
							{
								relationshipSchemaSlug: "item-part",
								targets: Array.from({ length: 101 }, (_, index) => target(`delete-part-${index}`)),
							},
						]),
					},
				}),
			);
			expect(deletes.output).toMatchObject({ kind: "invalid" });
			expect((yield* tablesState).relationshipRows).toHaveLength(101);
		}),
	);

	editorCase(
		"leaves incoming relationships and unlisted slugs untouched",
		Effect.gen(function* () {
			const { owner, insert, installed } = yield* setup();
			const entity = yield* insert("incoming-item", item, userId);
			const peer = yield* insert("incoming-peer", item, userId);
			assert(entity && peer);
			yield* insert("incoming-part", part, userId);
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db.insert(tables.relationship).values([
					{
						userId,
						properties: {},
						sourceEntityId: peer.id,
						targetEntityId: entity.id,
						relationshipSchemaSlug: "item-link",
						relationshipSchemaPluginId: installed.pluginId,
					},
					{
						userId,
						properties: {},
						targetEntityId: peer.id,
						sourceEntityId: entity.id,
						relationshipSchemaSlug: "item-link",
						relationshipSchemaPluginId: installed.pluginId,
					},
					{
						userId,
						sourceEntityId: entity.id,
						properties: { role: "kept" },
						targetEntityId: "incoming-part",
						relationshipSchemaSlug: "item-part",
						relationshipSchemaPluginId: installed.pluginId,
					},
				]),
			);
			const editor = yield* makeEditor();
			const result = yield* submitEdit(
				editor,
				"incoming",
				submission(owner, {
					relationships: [{ targets: [], relationshipSchemaSlug: "item-link" }],
					target: {
						kind: "update",
						entityId: entity.id,
						expected: expectedOf(entity, [
							{ targets: [target("incoming-peer")], relationshipSchemaSlug: "item-link" },
						]),
					},
				}),
			);
			expect(result.output.kind).toBe("saved");
			const links = (yield* tablesState).relationshipRows.map(
				({ sourceEntityId, targetEntityId, relationshipSchemaSlug }) =>
					[sourceEntityId, targetEntityId, relationshipSchemaSlug].join(":"),
			);
			expect(links.sort()).toEqual([
				"incoming-item:incoming-part:item-part",
				"incoming-peer:incoming-item:item-link",
			]);
		}),
	);

	editorCase(
		"rolls back the entity when relationship persistence fails after it",
		Effect.gen(function* () {
			const { owner, insert } = yield* setup();
			yield* insert("atomic-part", part, userId);
			const entity = yield* insert("atomic-item", item, userId, "Before");
			assert(entity);
			yield* insert("atomic-old", part, userId);
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db
					.insert(tables.relationship)
					.values({
						userId,
						properties: {},
						sourceEntityId: entity.id,
						targetEntityId: "atomic-old",
						relationshipSchemaSlug: "item-part",
						relationshipSchemaPluginId: entity.entitySchemaPluginId,
					}),
			);
			const log = yield* dispatched;
			const failing = yield* makeEditor({
				execution: { dispatch: log.dispatch },
				relationships: {
					persistPreparedUserCreate: () => new DbError({ message: "injected create failure" }),
					persistPreparedUserDelete: () => new DbError({ message: "injected delete failure" }),
				},
			});
			const before = yield* tablesState;
			const create = submission(owner, {
				name: "Created",
				target: { kind: "create" },
				relationships: [{ targets: [target("atomic-part")], relationshipSchemaSlug: "item-part" }],
			});
			expect(yield* submitEdit(failing, "atomic-create", create).pipe(Effect.flip)).toMatchObject({
				message: "injected create failure",
			});
			const update = submission(owner, {
				name: "After",
				properties: { code: "c", title: "After" },
				relationships: [{ targets: [target("atomic-part")], relationshipSchemaSlug: "item-part" }],
				target: {
					kind: "update",
					entityId: entity.id,
					expected: expectedOf(entity, [
						{ targets: [target("atomic-old")], relationshipSchemaSlug: "item-part" },
					]),
				},
			});
			expect(yield* submitEdit(failing, "atomic-update", update).pipe(Effect.flip)).toMatchObject({
				message: expect.stringContaining("injected"),
			});
			const after = yield* tablesState;
			expect(after.entityRows).toEqual(before.entityRows);
			expect(after.relationshipRows).toEqual(before.relationshipRows);
			expect(after.editorReceipts).toEqual([]);
			expect(after.entityReceipts).toEqual(before.entityReceipts);
			expect(yield* log.calls).toEqual([]);
		}),
	);

	editorCase(
		"rejects relationship changes made after loading without changing the entity or newer links",
		Effect.gen(function* () {
			const { owner, insert } = yield* setup();
			const relationships = yield* RelationshipsService;
			const editor = yield* makeEditor();
			for (const change of ["added", "updated", "deleted"] as const) {
				const entity = yield* insert(`loaded-${change}`, item, userId);
				const partEntity = yield* insert(`loaded-part-${change}`, part, userId);
				assert(entity && partEntity);
				const identity = {
					sourceEntityId: entity.id,
					targetEntityId: partEntity.id,
					relationshipSchema: { slug: itemPart, owner: definitionOwner(owner) },
				};
				if (change !== "added") {
					yield* relationships.createUser(
						userId,
						{ ...identity, properties: { role: "old" } },
						command(`loaded-seed-${change}`),
					);
				}
				const baseline = [
					{
						relationshipSchemaSlug: "item-part",
						targets: change === "added" ? [] : [target(partEntity.id, "old")],
					},
				];
				if (change === "deleted") {
					yield* relationships.delete(
						{ ...identity, userId, scope: "user" },
						command(`loaded-change-${change}`),
					);
				} else {
					yield* relationships.createUser(
						userId,
						{ ...identity, properties: { role: "new" } },
						command(`loaded-change-${change}`),
					);
				}
				const before = yield* tablesState;
				const input = submission(owner, {
					name: "Should not save",
					relationships: baseline,
					target: { kind: "update", entityId: entity.id, expected: expectedOf(entity, baseline) },
				});
				for (let attempt = 0; attempt < 2; attempt += 1) {
					expect((yield* submitEdit(editor, `loaded-save-${change}`, input)).output).toEqual({
						kind: "stale",
					});
				}
				const after = yield* tablesState;
				expect(after.entityRows).toEqual(before.entityRows);
				expect(after.relationshipRows).toEqual(before.relationshipRows);
				expect(after.editorReceipts).toEqual([]);
			}
		}),
	);

	editorCase(
		"rejects missing or duplicate relationship baselines",
		Effect.gen(function* () {
			const { owner, insert } = yield* setup();
			const entity = yield* insert("invalid-baseline", item, userId);
			assert(entity);
			const editor = yield* makeEditor();
			for (const [index, baseline] of [
				[],
				[
					{
						relationshipSchemaSlug: "item-part",
						targets: [target("duplicate"), target("duplicate")],
					},
				],
			].entries()) {
				const result = yield* submitEdit(
					editor,
					`invalid-baseline-${index}`,
					submission(owner, {
						relationships: [{ targets: [], relationshipSchemaSlug: "item-part" }],
						target: { kind: "update", entityId: entity.id, expected: expectedOf(entity, baseline) },
					}),
				);
				expect(result.output).toMatchObject({ kind: "invalid" });
			}
			expect((yield* tablesState).editorReceipts).toEqual([]);
		}),
	);

	editorCase(
		"reports stale when the relationship set drifts before the commit re-read",
		Effect.gen(function* () {
			const { owner, insert, installed } = yield* setup();
			const entity = yield* insert("drift-item", item, userId, "Drift");
			assert(entity);
			yield* insert("drift-part", part, userId);
			const repository = yield* RelationshipsRepository;
			const editor = yield* makeEditor({
				relationshipsRepository: {
					listUserEditorRelationships: (input) =>
						repository
							.listUserEditorRelationships(input)
							.pipe(
								Effect.tap(() =>
									input.lock
										? Effect.void
										: repository.createRelationship({
												userId,
												scope: "user",
												properties: {},
												sourceEntityId: entity.id,
												relationshipSchemaSlug: itemPart,
												targetEntityId: EntityId.make("drift-part"),
												relationshipSchemaPluginId: installed.pluginId,
											}),
								),
							),
				},
			});
			const before = yield* tablesState;
			const result = yield* submitEdit(
				editor,
				"drift",
				submission(owner, {
					name: "Drifted",
					properties: { code: "c", title: "Drifted" },
					relationships: [{ targets: [], relationshipSchemaSlug: "item-part" }],
					target: {
						kind: "update",
						entityId: entity.id,
						expected: expectedOf(entity, [{ targets: [], relationshipSchemaSlug: "item-part" }]),
					},
				}),
			);
			expect(result.output).toEqual({ kind: "stale" });
			const after = yield* tablesState;
			expect(after.entityRows).toEqual(before.entityRows);
			expect(after.relationshipRows).toHaveLength(before.relationshipRows.length + 1);
			expect(after.editorReceipts).toEqual([]);
		}),
	);

	editorCase(
		"re-dispatches the stored list when a commit is replayed after a crash",
		Effect.gen(function* () {
			const { owner, insert } = yield* setup();
			yield* insert("crash-part", part, userId);
			const log = yield* dispatched;
			const crashing = yield* Ref.make(true);
			const editor = yield* makeEditor({
				execution: {
					dispatch: (plans) =>
						Ref.getAndSet(crashing, false).pipe(
							Effect.flatMap((crash) =>
								crash
									? log.dispatch(plans).pipe(Effect.andThen(new DbError({ message: "crashed" })))
									: log.dispatch(plans),
							),
						),
				},
			});
			const input = submission(owner, {
				target: { kind: "create" },
				relationships: [{ targets: [target("crash-part")], relationshipSchemaSlug: "item-part" }],
			});
			expect(yield* submitEdit(editor, "crash-replay", input).pipe(Effect.flip)).toMatchObject({
				message: "crashed",
			});
			const committed = yield* tablesState;
			expect(committed.editorReceipts).toHaveLength(1);
			const replay = yield* submitEdit(editor, "crash-replay", input);
			expect(replay.output.kind).toBe("saved");
			const calls = yield* log.calls;
			expect(calls).toHaveLength(2);
			expect(calls[1]).toEqual(calls[0]);
			expect((yield* tablesState).entityRows).toEqual(committed.entityRows);
		}),
	);

	editorCase(
		"saves as an api command without a write context or kernel collection",
		Effect.gen(function* () {
			const { owner, insert } = yield* setup();
			yield* insert("context-part", part, userId);
			const entities = yield* EntitiesService;
			const relationships = yield* RelationshipsService;
			const seen = yield* Ref.make<ReadonlyArray<DomainLifecycleCommand>>([]);
			const editor = yield* makeEditor({
				entities: {
					prepareUserSave: (input) =>
						Ref.update(seen, (all) => [...all, input.lifecycle]).pipe(
							Effect.andThen(entities.prepareUserSave(input)),
						),
				},
				relationships: {
					prepareUserCreate: (input, lifecycle, created) =>
						Ref.update(seen, (all) => [...all, lifecycle]).pipe(
							Effect.andThen(relationships.prepareUserCreate(input, lifecycle, created)),
						),
				},
			});
			yield* submitEdit(
				editor,
				"context",
				submission(owner, {
					target: { kind: "create" },
					relationships: [
						{ targets: [target("context-part")], relationshipSchemaSlug: "item-part" },
					],
				}),
			);
			const commands = yield* Ref.get(seen);
			expect(commands).toHaveLength(2);
			for (const lifecycle of commands) {
				expect(lifecycle.writeContext).toBeNull();
				expect(lifecycle.causation.source).toBe("api");
				expect(lifecycle.causation.initiator).toEqual({ id: userId, kind: "user" });
				expect(lifecycle.kernelCollection).toBeUndefined();
			}
		}),
	);

	editorCase(
		"refuses a relationship target the user cannot see",
		Effect.gen(function* () {
			const { owner, insert } = yield* setup();
			yield* insert("hidden-part", part, otherUser);
			const editor = yield* makeEditor();
			const result = yield* submitEdit(
				editor,
				"hidden-target",
				submission(owner, {
					target: { kind: "create" },
					relationships: [
						{ targets: [target("hidden-part")], relationshipSchemaSlug: "item-part" },
					],
				}),
			);
			expect(result.output).toMatchObject({ kind: "invalid" });
			expect((yield* tablesState).entityRows.filter(({ name }) => name === "Item")).toEqual([]);
		}),
	);

	editorCase(
		"refuses a target of the wrong schema",
		Effect.gen(function* () {
			const { owner, insert } = yield* setup();
			yield* insert("wrong-target", item, userId);
			const editor = yield* makeEditor();
			const result = yield* submitEdit(
				editor,
				"wrong-target",
				submission(owner, {
					target: { kind: "create" },
					relationships: [
						{ targets: [target("wrong-target")], relationshipSchemaSlug: "item-part" },
					],
				}),
			);
			expect(result.output).toMatchObject({ kind: "invalid" });
		}),
	);

	editorCase(
		"rejects a before-stage policy that removes an immutable property inside the commit",
		Effect.gen(function* () {
			const { owner, insert } = yield* setup({ policy: true });
			const entity = yield* insert("policy-item", item, userId, "Policy");
			assert(entity);
			const editor = yield* makeEditor({
				execution: {
					executePolicy: () =>
						Effect.succeed({
							action: "transform" as const,
							patch: {
								resource: "entity" as const,
								draft: { properties: { set: {}, remove: ["code"] } },
							},
						}),
				},
			});
			const before = yield* tablesState;
			const result = yield* submitEdit(
				editor,
				"policy-immutable",
				submission(owner, {
					target: { kind: "update", entityId: entity.id, expected: expectedOf(entity) },
				}),
			);
			expect(result.output).toEqual({
				kind: "invalid",
				message: "code cannot be changed after creation",
			});
			expect((yield* tablesState).entityRows).toEqual(before.entityRows);
		}),
	);

	editorCase(
		"refuses owners that are unavailable to the user, even inside the commit",
		Effect.gen(function* () {
			const { owner, installed } = yield* setup();
			const session = yield* DatabaseSession;
			const foreign = yield* installRevisionPackage(editorPackage(), otherUser);
			const editor = yield* makeEditor();
			const foreignOwner = PluginId.make(foreign.pluginId);
			const run = (id: string, pluginId: PluginId) =>
				submitEdit(editor, id, submission(pluginId, { target: { kind: "create" } }));
			expect((yield* run("foreign-private", foreignOwner)).output).toMatchObject({
				kind: "invalid",
			});

			const installation = and(
				eq(tables.pluginInstallation.userId, userId),
				eq(tables.pluginInstallation.pluginId, installed.pluginId),
			);
			const setInstallation = (values: Partial<typeof tables.pluginInstallation.$inferInsert>) =>
				session.run((db) => db.update(tables.pluginInstallation).set(values).where(installation));
			for (const [id, values] of [
				["incompatible", { health: "incompatible" }],
				[
					"quarantined",
					{ health: "incompatible", incompatibilityReason: "package-identity-conflict" },
				],
				["not-ready", { health: "installing" }],
				["uninstalled", { uninstalledAt: DateTime.toDateUtc(yield* DateTime.now) }],
			] as const) {
				yield* setInstallation(values);
				expect((yield* run(id, owner)).output).toMatchObject({ kind: "invalid" });
				yield* setInstallation({
					health: "ready",
					uninstalledAt: null,
					incompatibilityReason: null,
				});
			}

			const receipts = yield* MutationReceipts;
			const uninstalling = yield* makeEditor({
				receipts: {
					lookup: (identity, result) =>
						setInstallation({ health: "incompatible" }).pipe(
							Effect.andThen(receipts.lookup(identity, result)),
						),
				},
			});
			yield* (yield* EntitiesRepository).insertEntities([
				{
					userId,
					name: "Late",
					scope: "user",
					populatedAt: null,
					entitySchemaSlug: part,
					properties: { title: "Late" },
					id: EntityId.make("late-part"),
					entitySchemaPluginId: installed.pluginId,
				},
			]);
			const late = yield* submitEdit(
				uninstalling,
				"late-unavailable",
				submission(owner, {
					target: { kind: "create" },
					relationships: [{ targets: [target("late-part")], relationshipSchemaSlug: "item-part" }],
				}),
			);
			expect(late.output).toMatchObject({ kind: "invalid" });
			const state = yield* tablesState;
			expect(state.entityRows.filter(({ name }) => name === "Item")).toEqual([]);
			expect(state.editorReceipts).toEqual([]);
		}),
	);

	editorCase(
		"submits with a derived execution identity that replays, conflicts, and isolates users",
		Effect.gen(function* () {
			const { owner, installed } = yield* setup();
			const installations = yield* PluginInstallationRepository;
			yield* (yield* DatabaseSession).run((db) =>
				db
					.insert(tables.user)
					.values({
						id: "owner",
						name: "Owner",
						email: "owner@example.test",
						accountGeneration: "test-account-generation",
					}),
			);
			const system = yield* installRevisionPackage(editorPackage());
			for (const user of [userId, otherUser]) {
				yield* installations.upsertState({
					config: {},
					sortOrder: 1,
					userId: user,
					health: "ready",
					isHidden: false,
					pluginId: system.pluginId,
				});
			}
			const entities = yield* EntitiesService;
			const seen = yield* Ref.make<ReadonlyArray<DomainLifecycleCommand>>([]);
			const editor = yield* makeEditor({
				entities: {
					prepareUserSave: (input) =>
						Ref.update(seen, (all) => [...all, input.lifecycle]).pipe(
							Effect.andThen(entities.prepareUserSave(input)),
						),
				},
			});
			const request = (
				pluginId: PluginId,
				overrides: Partial<EntityEditorSaveSubmission> = {},
			): EntityEditorSaveRequest => ({
				idempotencyKey: "form-submission",
				submittedAt: "2026-10-14T00:00:00.000Z",
				submission: submission(pluginId, { target: { kind: "create" }, ...overrides }),
			});
			const submitAs = (user: UserId, value: EntityEditorSaveRequest) =>
				editor.submit({
					userId: user,
					request: value,
					accountGeneration: { userId: user, token: "test-account-generation" },
				});

			const first = yield* submitAs(userId, request(owner));
			assert(first.output.kind === "saved");
			const retry = yield* submitAs(userId, request(owner));
			expect(retry.output).toEqual(first.output);
			const [lifecycle] = yield* Ref.get(seen);
			expect(lifecycle?.writeContext).toBeNull();
			expect(lifecycle?.occurredAt).toBe("2026-10-14T00:00:00.000Z");
			expect(lifecycle?.causation).toMatchObject({
				source: "api",
				initiator: { id: userId, kind: "user" },
			});
			expect(lifecycle?.causation.executionId).toMatch(/^entity-editor-/);
			expect(
				yield* submitAs(userId, request(owner, { name: "Changed" })).pipe(Effect.flip),
			).toBeInstanceOf(EntityEditorRefused);

			const systemOwner = PluginId.make(system.pluginId);
			const mine = yield* submitAs(userId, request(systemOwner));
			const theirs = yield* submitAs(otherUser, request(systemOwner));
			assert(mine.output.kind === "saved" && theirs.output.kind === "saved");
			expect(theirs.output.entityId).not.toBe(mine.output.entityId);
			expect((yield* tablesState).editorReceipts).toHaveLength(3);

			expect(
				(yield* submitAs(userId, {
					...request(owner),
					idempotencyKey: "kernel",
					submission: submission(owner, {
						target: { kind: "create" },
						entitySchema: { slug: item, owner: { kind: "kernel" } },
					}),
				})).output,
			).toEqual({ kind: "invalid", message: "This entity schema cannot be edited here" });
			expect(
				(yield* submitAs(otherUser, { ...request(owner), idempotencyKey: "foreign" })).output,
			).toEqual({ kind: "invalid", message: "This entity schema cannot be edited here" });
			const invalidProperties = yield* submitAs(userId, {
				...request(owner, { properties: { title: 7, code: "c" } }),
				idempotencyKey: "invalid-properties",
			});
			expect(invalidProperties.output).toEqual({
				kind: "invalid",
				message: "The entity properties are invalid",
			});
			expect(installed.pluginId).toBe(owner);
		}),
	);

	editorCase(
		"reads the persisted editor through the catalog and enforces it on save",
		Effect.gen(function* () {
			const { owner, insert } = yield* setup();
			yield* insert("catalog-part", part, userId);
			const ryotql = yield* RyotQLService.make;
			const source = table("entitySchema", "source");
			const response = yield* ryotql.executeForUser(userId, null, "plugin", {
				queries: {
					rows: rows(source, {
						fields: ["slug", "editor"].map((name) => field(name, column(source, name))),
					}),
				},
			});
			const result = response.data["rows"];
			assert(result?.type === "rows");
			expect(
				result.items
					.filter((row) => row["slug"] === "item" || row["slug"] === "part")
					.sort((left, right) => String(left["slug"]).localeCompare(String(right["slug"]))),
			).toEqual([
				{ slug: "item", editor: itemEditor },
				{ slug: "part", editor: partEditor },
			]);
			const editor = yield* makeEditor();
			const save = (id: string, relationshipSchemaSlug: string) =>
				submitEdit(
					editor,
					id,
					submission(owner, {
						target: { kind: "create" },
						relationships: [{ relationshipSchemaSlug, targets: [target("catalog-part")] }],
					}),
				);
			expect((yield* save("catalog-declared", "item-part")).output).toMatchObject({
				kind: "saved",
			});
			expect((yield* save("catalog-undeclared", "item-extra")).output).toEqual({
				kind: "invalid",
				message: "Relationship item-extra is not editable here",
			});
		}),
	);
	editorCase(
		"edits incoming relationships and fixes one parent at creation",
		Effect.gen(function* () {
			const { owner, insert } = yield* setup();
			for (const id of ["parent-a", "parent-b", "extra-a"]) {
				yield* insert(id, item, userId);
			}
			const editor = yield* makeEditor();
			const parentRefusal = {
				kind: "invalid",
				message: "Relationship item-child needs one parent set at creation",
			};
			expect(
				(yield* submitEdit(
					editor,
					"orphan",
					partSubmission(owner, { target: { kind: "create" }, relationships: [extraGroup()] }),
				)).output,
			).toEqual(parentRefusal);
			const created = yield* submitEdit(
				editor,
				"child",
				partSubmission(owner, {
					target: { kind: "create" },
					relationships: [childGroup("parent-a"), extraGroup("extra-a")],
				}),
			);
			assert(created.output.kind === "saved");
			const partId = created.output.entityId;
			const incoming = Effect.map(tablesState, (state) =>
				state.relationshipRows
					.filter(({ targetEntityId }) => targetEntityId === partId)
					.map((row) => [row.relationshipSchemaSlug, row.sourceEntityId, row.userId])
					.sort(),
			);
			expect(yield* incoming).toEqual([
				["item-child", "parent-a", userId],
				["item-extra", "extra-a", userId],
			]);
			const expected = yield* storedExpected(partId, [
				childGroup("parent-a"),
				extraGroup("extra-a"),
			]);
			const update = { expected, entityId: partId, kind: "update" as const };
			expect(
				(yield* submitEdit(
					editor,
					"move",
					partSubmission(owner, {
						target: update,
						relationships: [childGroup("parent-b"), extraGroup("extra-a")],
					}),
				)).output,
			).toEqual(parentRefusal);
			expect(
				(yield* submitEdit(
					editor,
					"keep",
					partSubmission(owner, {
						target: update,
						relationships: [childGroup("parent-a"), extraGroup()],
					}),
				)).output,
			).toEqual({ kind: "saved", entityId: partId });
			expect(yield* incoming).toEqual([["item-child", "parent-a", userId]]);
		}),
	);

	editorCase(
		"deletes declared entities only without history or unmanaged links",
		Effect.gen(function* () {
			const { owner, insert } = yield* setup();
			const parent = yield* insert("delete-parent", item, userId);
			assert(parent);
			const foreign = yield* insert("delete-foreign", part, otherUser);
			assert(foreign);
			const editor = yield* makeEditor();
			const session = yield* DatabaseSession;
			const createChild = Effect.fnUntraced(function* (key: string) {
				const created = yield* submitEdit(
					editor,
					key,
					partSubmission(owner, {
						target: { kind: "create" },
						relationships: [childGroup("delete-parent")],
					}),
				);
				assert(created.output.kind === "saved");
				const entityId = created.output.entityId;
				return { entityId, expectedUpdatedAt: (yield* storedExpected(entityId)).updatedAt };
			});

			const clean = yield* createChild("clean-child");
			expect(
				(yield* submitDelete(editor, "stale-delete", {
					owner,
					entityId: clean.entityId,
					expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
				})).output,
			).toEqual({ kind: "stale" });
			expect((yield* submitDelete(editor, "clean-delete", { owner, ...clean })).output).toEqual({
				kind: "deleted",
			});
			expect((yield* submitDelete(editor, "clean-delete", { owner, ...clean })).output).toEqual({
				kind: "deleted",
			});
			const afterDelete = yield* tablesState;
			expect(afterDelete.entityRows.some(({ id }) => id === clean.entityId)).toBe(false);
			expect(
				afterDelete.relationshipRows.some(({ targetEntityId }) => targetEntityId === clean.entityId),
			).toBe(false);

			const historied = yield* createChild("historied-child");
			yield* session.run((db) =>
				db.insert(tables.event).values({
					userId,
					id: "history-event",
					occurredAt: new Date(),
					eventSchemaSlug: "unknown",
					entityId: historied.entityId,
				}),
			);
			expect(
				(yield* submitDelete(editor, "historied-delete", { owner, ...historied })).output,
			).toEqual({ kind: "invalid", message: "Remove this entity's history before deleting it" });
			const afterHistory = yield* session.run((db) =>
				db.select().from(tables.event).where(eq(tables.event.id, "history-event")),
			);
			expect(afterHistory).toHaveLength(1);

			const linked = yield* createChild("linked-child");
			yield* session.run((db) =>
				db.insert(tables.relationship).values({
					userId,
					sourceEntityId: linked.entityId,
					targetEntityId: linked.entityId,
					relationshipSchemaSlug: "part-link",
					relationshipSchemaPluginId: owner,
				}),
			);
			expect((yield* submitDelete(editor, "linked-delete", { owner, ...linked })).output).toEqual({
				kind: "invalid",
				message: "Remove this entity's linked items before deleting it",
			});

			expect(
				(yield* submitDelete(editor, "item-delete", {
					owner,
					slug: item,
					entityId: parent.id,
					expectedUpdatedAt: parent.updatedAt,
				})).output,
			).toEqual({ kind: "invalid", message: "This entity cannot be deleted here" });
			expect(
				yield* submitDelete(editor, "foreign-delete", {
					owner,
					entityId: foreign.id,
					expectedUpdatedAt: foreign.updatedAt,
				}).pipe(Effect.flip),
			).toMatchObject({ _tag: "EntityNotFound" });
		}),
	);
});
