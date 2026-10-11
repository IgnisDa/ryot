import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type { EntityEditorSubmission } from "@ryot-app/contract/modules/entities/editor";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Effect, Layer, Ref, Schema } from "effect";
import { assert, describe } from "vitest";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import type { LifecycleDispatchPlan } from "#modules/automations/lifecycle/planning";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { MutationReceipts } from "#modules/mutations/receipts";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { testPluginPackageId } from "#modules/plugins/test-support";
import { relationshipDatabaseLayer, userId } from "#modules/relationships/lifecycle.test-support";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { EntityEditorRefused, EntityEditorService } from "./service";

const item = EntitySchemaSlug.make("item");
const part = EntitySchemaSlug.make("part");
const itemPart = RelationshipSchemaSlug.make("item-part");
const otherUser = UserId.make("editor-other-user");

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
			entitySchemas: [declaration("item", itemProperties), declaration("part", titleProperties)],
			scripts: options.policy
				? [...source.manifest.scripts, { ...policy.metadata, entry: "backend/policy.sandbox.ts" }]
				: source.manifest.scripts,
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

const principalFor = Effect.fnUntraced(function* (
	installed: Effect.Success<ReturnType<typeof installRevisionPackage>>,
	owner: UserId,
) {
	const runtime = yield* PluginRuntimeResolver;
	const provider = yield* runtime.findProviderAvailableToUserByReference(owner, {
		slug: "editor-provider",
		owner: definitionOwner(installed.pluginId),
	});
	assert(provider);
	const script = yield* runtime.resolveUserDetailsScript(owner, provider.id);
	const subject = {
		userId: owner,
		type: "user" as const,
		accountGeneration: { userId: owner, token: "test-account-generation" },
	};
	const pin = yield* (yield* SandboxRepository.make).getScriptPin(script.id, undefined, subject);
	assert(pin?.pluginRevision);
	return yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
});

const commandFor = (principal: ScriptExecutionPrincipal, executionId: string) => {
	const command: DomainLifecycleCommand = {
		...rootLifecycleCommand({
			source: "api",
			lane: "interactive",
			itemIdentity: "saveUserEntity",
			occurredAt: "2026-10-13T00:00:00.000Z",
			initiator: { id: userId, kind: "user" },
			executionId: AutomationExecutionId.make(executionId),
			accountGeneration: { userId, token: "test-account-generation" },
		}),
		writeContext: principal,
	};
	return command;
};

const setup = Effect.fnUntraced(function* (options: { readonly policy?: boolean } = {}) {
	const installed = yield* installRevisionPackage(editorPackage(options), userId);
	const principal = yield* principalFor(installed, userId);
	const entities = yield* EntitiesRepository;
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
	const insert = (id: string, slug: EntitySchemaSlug, owner: UserId | null, name = id) =>
		entities
			.insertEntities([
				{
					name,
					populatedAt: null,
					id: EntityId.make(id),
					entitySchemaSlug: slug,
					entitySchemaPluginId: installed.pluginId,
					properties: slug === item ? { code: "c", title: name } : { title: name },
					...(owner === null
						? { scope: "global" as const }
						: { userId: owner, scope: "user" as const }),
				},
			])
			.pipe(Effect.map(([entity]) => entity));
	return { insert, installed, principal };
});

const makeEditor = Effect.fnUntraced(function* (
	overrides: {
		readonly execution?: Partial<LifecycleExecution["Service"]>;
		readonly entities?: Partial<EntitiesService["Service"]>;
		readonly relationships?: Partial<RelationshipsService["Service"]>;
		readonly relationshipsRepository?: Partial<RelationshipsRepository["Service"]>;
	} = {},
) {
	const execution = { ...(yield* LifecycleExecution), ...overrides.execution };
	const entities = {
		...(yield* EntitiesService.make.pipe(Effect.provideService(LifecycleExecution, execution))),
		...overrides.entities,
	};
	const relationships = { ...(yield* RelationshipsService), ...overrides.relationships };
	const repository = { ...(yield* RelationshipsRepository), ...overrides.relationshipsRepository };
	return yield* EntityEditorService.make.pipe(
		Effect.provideService(LifecycleExecution, execution),
		Effect.provideService(EntitiesService, entities),
		Effect.provideService(RelationshipsService, relationships),
		Effect.provideService(RelationshipsRepository, repository),
	);
});

const submission = (
	input: Partial<EntityEditorSubmission> & Pick<EntityEditorSubmission, "target">,
): EntityEditorSubmission => ({
	name: "Item",
	relationships: [],
	entitySchemaSlug: "item",
	properties: { code: "c", title: "Item" },
	...input,
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

const expectedOf = (entity: { name: string; updatedAt: string; properties: unknown }) => ({
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
			const { insert, principal } = yield* setup();
			yield* insert("part-a", part, userId);
			yield* insert("part-b", part, userId);
			const log = yield* dispatched;
			const editor = yield* makeEditor({ execution: { dispatch: log.dispatch } });
			const command = commandFor(principal, "create-with-relationships");
			const input = submission({
				target: { kind: "create" },
				relationships: [
					{
						relationshipSchemaSlug: "item-part",
						targets: [target("part-a", "main"), target("part-b", "side")],
					},
				],
			});
			const first = yield* editor.save({ userId, submission: input, lifecycle: command });
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

			const replay = yield* editor.save({ userId, submission: input, lifecycle: command });
			expect(replay.output).toEqual(first.output);
			const after = yield* tablesState;
			expect(after.entityRows).toHaveLength(state.entityRows.length);
			expect(after.relationshipRows).toHaveLength(state.relationshipRows.length);
			const calls = yield* log.calls;
			expect(calls).toHaveLength(2);
			expect(calls[1]).toEqual(calls[0]);
			expect(calls[0]?.length).toBeGreaterThan(0);

			const conflict = yield* editor
				.save({ userId, lifecycle: command, submission: { ...input, name: "Different" } })
				.pipe(Effect.flip);
			expect(conflict).toBeInstanceOf(EntityEditorRefused);
		}),
	);

	editorCase(
		"applies the relationship diff on update, replacing properties of kept targets",
		Effect.gen(function* () {
			const { insert, principal } = yield* setup();
			const entity = yield* insert("diff-item", item, userId, "Diff");
			assert(entity);
			for (const id of ["diff-a", "diff-b", "diff-c"]) {
				yield* insert(id, part, userId);
			}
			const editor = yield* makeEditor();
			const created = yield* editor.save({
				userId,
				lifecycle: commandFor(principal, "diff-seed"),
				submission: submission({
					target: { kind: "create" },
					relationships: [
						{
							relationshipSchemaSlug: "item-part",
							targets: [target("diff-a", "one"), target("diff-b", "two")],
						},
					],
				}),
			});
			assert(created.output.kind === "saved");
			const session = yield* DatabaseSession;
			const sourceId = created.output.entityId;
			const [stored] = yield* session.run((db) =>
				db.select().from(tables.entity).where(eq(tables.entity.id, sourceId)),
			);
			assert(stored);
			const updated = yield* editor.save({
				userId,
				lifecycle: commandFor(principal, "diff-update"),
				submission: submission({
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
						expected: expectedOf({
							name: stored.name,
							properties: stored.properties,
							updatedAt: stored.updatedAt.toISOString(),
						}),
					},
				}),
			});
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
			const { insert, principal } = yield* setup();
			const entity = yield* insert("stale-item", item, userId, "Stale");
			assert(entity);
			const editor = yield* makeEditor();
			const result = yield* editor.save({
				userId,
				lifecycle: commandFor(principal, "stale-update"),
				submission: submission({
					target: {
						kind: "update",
						entityId: entity.id,
						expected: { name: "Old", properties: { code: "c" }, updatedAt: entity.updatedAt },
					},
				}),
			});
			expect(result.output).toEqual({ kind: "stale" });
			expect((yield* tablesState).editorReceipts).toHaveLength(0);
		}),
	);

	editorCase(
		"rejects a changed or omitted immutable property as invalid",
		Effect.gen(function* () {
			const { insert, principal } = yield* setup();
			const entity = yield* insert("immutable-item", item, userId, "Immutable");
			assert(entity);
			const editor = yield* makeEditor();
			const update = (id: string, properties: Record<string, unknown>) =>
				editor.save({
					userId,
					lifecycle: commandFor(principal, id),
					submission: submission({
						properties,
						target: { kind: "update", entityId: entity.id, expected: expectedOf(entity) },
					}),
				});
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
		"refuses foreign entity and relationship schemas",
		Effect.gen(function* () {
			const { principal } = yield* setup();
			const editor = yield* makeEditor();
			const run = (id: string, input: EntityEditorSubmission) =>
				editor
					.save({ userId, submission: input, lifecycle: commandFor(principal, id) })
					.pipe(Effect.flip);
			expect(
				yield* run(
					"foreign-entity",
					submission({ entitySchemaSlug: "nope", target: { kind: "create" } }),
				),
			).toBeInstanceOf(EntityEditorRefused);
			for (const slug of ["nope", "part-link", "loose-link"]) {
				expect(
					yield* run(
						`foreign-${slug}`,
						submission({
							target: { kind: "create" },
							relationships: [{ targets: [], relationshipSchemaSlug: slug }],
						}),
					),
				).toBeInstanceOf(EntityEditorRefused);
			}
		}),
	);

	editorCase(
		"refuses non-user-owned, other-schema, and other-user entities identically",
		Effect.gen(function* () {
			const { insert, principal } = yield* setup();
			const global = yield* insert("global-item", item, null);
			const wrongSchema = yield* insert("wrong-schema", part, userId);
			const foreign = yield* insert("foreign-item", item, otherUser);
			assert(global && wrongSchema && foreign);
			const editor = yield* makeEditor();
			const run = (id: string, entityId: EntityId, expected: ReturnType<typeof expectedOf>) =>
				editor
					.save({
						userId,
						lifecycle: commandFor(principal, id),
						submission: submission({ target: { entityId, expected, kind: "update" } }),
					})
					.pipe(Effect.flip);
			for (const entity of [global, wrongSchema]) {
				const error = yield* run(`refused-${entity.id}`, entity.id, expectedOf(entity));
				expect(error).toMatchObject({ _tag: "EntityNotFound" });
			}
			const matching = yield* run("foreign-match", foreign.id, expectedOf(foreign));
			const mismatching = yield* run("foreign-mismatch", foreign.id, {
				name: "x",
				properties: {},
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
			const { insert, principal } = yield* setup();
			const editor = yield* makeEditor();
			const run = (id: string, input: EntityEditorSubmission) =>
				editor.save({ userId, submission: input, lifecycle: commandFor(principal, id) });
			const many = Array.from({ length: 201 }, (_, index) => target(`cap-${index}`));
			const overCap = yield* run(
				"over-cap",
				submission({
					target: { kind: "create" },
					relationships: [{ targets: many, relationshipSchemaSlug: "item-part" }],
				}),
			);
			expect(overCap.output).toMatchObject({ kind: "invalid" });
			const duplicate = yield* run(
				"duplicate",
				submission({
					target: { kind: "create" },
					relationships: [
						{ relationshipSchemaSlug: "item-part", targets: [target("dup"), target("dup")] },
					],
				}),
			);
			expect(duplicate.output).toMatchObject({ kind: "invalid" });
			const duplicateGroup = yield* run(
				"duplicate-group",
				submission({
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
				submission({
					relationships: [{ targets: [], relationshipSchemaSlug: "item-part" }],
					target: { kind: "update", entityId: entity.id, expected: expectedOf(entity) },
				}),
			);
			expect(deletes.output).toMatchObject({ kind: "invalid" });
			expect((yield* tablesState).relationshipRows).toHaveLength(101);
		}),
	);

	editorCase(
		"leaves incoming relationships and unlisted slugs untouched",
		Effect.gen(function* () {
			const { insert, installed, principal } = yield* setup();
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
			const result = yield* editor.save({
				userId,
				lifecycle: commandFor(principal, "incoming"),
				submission: submission({
					relationships: [{ targets: [], relationshipSchemaSlug: "item-link" }],
					target: { kind: "update", entityId: entity.id, expected: expectedOf(entity) },
				}),
			});
			expect(result.output.kind).toBe("saved");
			const rows = (yield* tablesState).relationshipRows.map(
				({ sourceEntityId, targetEntityId, relationshipSchemaSlug }) =>
					[sourceEntityId, targetEntityId, relationshipSchemaSlug].join(":"),
			);
			expect(rows.sort()).toEqual([
				"incoming-item:incoming-part:item-part",
				"incoming-peer:incoming-item:item-link",
			]);
		}),
	);

	editorCase(
		"rolls back the entity when relationship persistence fails after it",
		Effect.gen(function* () {
			const { insert, principal } = yield* setup();
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
			const create = submission({
				name: "Created",
				target: { kind: "create" },
				relationships: [{ targets: [target("atomic-part")], relationshipSchemaSlug: "item-part" }],
			});
			expect(
				yield* failing
					.save({ userId, submission: create, lifecycle: commandFor(principal, "atomic-create") })
					.pipe(Effect.flip),
			).toMatchObject({ message: "injected create failure" });
			const update = submission({
				name: "After",
				properties: { code: "c", title: "After" },
				target: { kind: "update", entityId: entity.id, expected: expectedOf(entity) },
				relationships: [{ targets: [target("atomic-part")], relationshipSchemaSlug: "item-part" }],
			});
			expect(
				yield* failing
					.save({ userId, submission: update, lifecycle: commandFor(principal, "atomic-update") })
					.pipe(Effect.flip),
			).toMatchObject({ message: expect.stringContaining("injected") });
			const after = yield* tablesState;
			expect(after.entityRows).toEqual(before.entityRows);
			expect(after.relationshipRows).toEqual(before.relationshipRows);
			expect(after.editorReceipts).toEqual([]);
			expect(after.entityReceipts).toEqual(before.entityReceipts);
			expect(yield* log.calls).toEqual([]);
		}),
	);

	editorCase(
		"reports stale when the relationship set drifts before the commit re-read",
		Effect.gen(function* () {
			const { insert, installed, principal } = yield* setup();
			const entity = yield* insert("drift-item", item, userId, "Drift");
			assert(entity);
			yield* insert("drift-part", part, userId);
			const repository = yield* RelationshipsRepository;
			const editor = yield* makeEditor({
				relationshipsRepository: {
					listUserOutgoingRelationships: (input) =>
						repository
							.listUserOutgoingRelationships(input)
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
			const result = yield* editor.save({
				userId,
				lifecycle: commandFor(principal, "drift"),
				submission: submission({
					name: "Drifted",
					properties: { code: "c", title: "Drifted" },
					relationships: [{ targets: [], relationshipSchemaSlug: "item-part" }],
					target: { kind: "update", entityId: entity.id, expected: expectedOf(entity) },
				}),
			});
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
			const { insert, principal } = yield* setup();
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
			const command = commandFor(principal, "crash-replay");
			const input = submission({
				target: { kind: "create" },
				relationships: [{ targets: [target("crash-part")], relationshipSchemaSlug: "item-part" }],
			});
			expect(
				yield* editor.save({ userId, submission: input, lifecycle: command }).pipe(Effect.flip),
			).toMatchObject({ message: "crashed" });
			const committed = yield* tablesState;
			expect(committed.editorReceipts).toHaveLength(1);
			const replay = yield* editor.save({ userId, submission: input, lifecycle: command });
			expect(replay.output.kind).toBe("saved");
			const calls = yield* log.calls;
			expect(calls).toHaveLength(2);
			expect(calls[1]).toEqual(calls[0]);
			expect((yield* tablesState).entityRows).toEqual(committed.entityRows);
		}),
	);

	editorCase(
		"keeps the principal as the write context and never marks a kernel collection",
		Effect.gen(function* () {
			const { insert, principal } = yield* setup();
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
					prepareUserCreate: (input, command, created) =>
						Ref.update(seen, (all) => [...all, command]).pipe(
							Effect.andThen(relationships.prepareUserCreate(input, command, created)),
						),
				},
			});
			yield* editor.save({
				userId,
				lifecycle: commandFor(principal, "context"),
				submission: submission({
					target: { kind: "create" },
					relationships: [
						{ targets: [target("context-part")], relationshipSchemaSlug: "item-part" },
					],
				}),
			});
			const commands = yield* Ref.get(seen);
			expect(commands).toHaveLength(2);
			for (const command of commands) {
				expect(command.writeContext).toBe(principal);
				expect(command.kernelCollection).toBeUndefined();
			}
		}),
	);

	editorCase(
		"refuses a relationship target the user cannot see",
		Effect.gen(function* () {
			const { insert, principal } = yield* setup();
			yield* insert("hidden-part", part, otherUser);
			const editor = yield* makeEditor();
			const result = yield* editor.save({
				userId,
				lifecycle: commandFor(principal, "hidden-target"),
				submission: submission({
					target: { kind: "create" },
					relationships: [
						{ targets: [target("hidden-part")], relationshipSchemaSlug: "item-part" },
					],
				}),
			});
			expect(result.output).toMatchObject({ kind: "invalid" });
			expect((yield* tablesState).entityRows.filter(({ name }) => name === "Item")).toEqual([]);
		}),
	);

	editorCase(
		"refuses a target of the wrong schema",
		Effect.gen(function* () {
			const { insert, principal } = yield* setup();
			yield* insert("wrong-target", item, userId);
			const editor = yield* makeEditor();
			const result = yield* editor.save({
				userId,
				lifecycle: commandFor(principal, "wrong-target"),
				submission: submission({
					target: { kind: "create" },
					relationships: [
						{ targets: [target("wrong-target")], relationshipSchemaSlug: "item-part" },
					],
				}),
			});
			expect(result.output).toMatchObject({ kind: "invalid" });
		}),
	);

	editorCase(
		"rejects a before-stage policy that removes an immutable property inside the commit",
		Effect.gen(function* () {
			const { insert, principal } = yield* setup({ policy: true });
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
			const result = yield* editor.save({
				userId,
				lifecycle: commandFor(principal, "policy-immutable"),
				submission: submission({
					target: { kind: "update", entityId: entity.id, expected: expectedOf(entity) },
				}),
			});
			expect(result.output).toEqual({
				kind: "invalid",
				message: "code cannot be changed after creation",
			});
			expect((yield* tablesState).entityRows).toEqual(before.entityRows);
		}),
	);

	editorCase(
		"refuses a principal without a pinned plugin",
		Effect.gen(function* () {
			const { principal } = yield* setup();
			const editor = yield* makeEditor();
			const error = yield* editor
				.save({
					userId,
					submission: submission({ target: { kind: "create" } }),
					lifecycle: commandFor({ ...principal, pluginRevision: null }, "no-plugin"),
				})
				.pipe(Effect.flip);
			expect(error).toBeInstanceOf(EntityEditorRefused);
			expect((yield* tablesState).entityRows.filter(({ name }) => name === "Item")).toEqual([]);
		}),
	);
});
