import { describe, expect, it, layer } from "@effect/vitest";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import type { WorkflowDurableCallRequest } from "@ryot-app/sandbox-sdk/workflow";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Ref, Schema } from "effect";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { SandboxPluginRevision } from "#lib/infrastructure/sandbox-runtime/execution-principal";

import { isWorkflowCallTargetKind, SandboxRepository } from "./repository";

const activity = {
	index: 0,
	name: "activity",
	kind: "activity",
	args: { input: {}, scriptSlug: "activity.test" },
} satisfies WorkflowDurableCallRequest;

describe("workflow call script resolution", () => {
	it("dispatches activity requests to scripts", () => {
		expect(isWorkflowCallTargetKind(activity, "script")).toBe(true);
		for (const kind of ["operation", "workflow", "provider", "automation"] as const) {
			expect(isWorkflowCallTargetKind(activity, kind)).toBe(false);
		}
	});

	it("dispatches children only to workflow scripts", () => {
		const child = {
			index: 0,
			name: "child",
			kind: "child",
			args: { input: {}, workflowSlug: "workflow.test" },
		} satisfies WorkflowDurableCallRequest;
		expect(isWorkflowCallTargetKind(child, "workflow")).toBe(true);
		expect(isWorkflowCallTargetKind(child, "script")).toBe(false);
	});
});

const manifest = {
	entitySchemas: [],
	relationshipSchemas: [],
	configSchema: { fields: {}, unknownKeys: "strict" },
	scripts: [{ kind: "script", slug: "plugin.script" }],
	workflows: [{ slug: "plugin-workflow", scriptSlug: "plugin.workflow" }],
	userBootstrap: [{ slug: "bootstrap", description: "Bootstrap", scriptSlug: "plugin.script" }],
};

const pluginPinRow = {
	id: "script-id",
	pluginOwnerId: null,
	pluginSlug: "plugin",
	pluginId: "plugin-id",
	slug: "plugin.script",
	pluginStatus: "active",
	pluginManifest: manifest,
	providerId: "provider-id",
	contentHash: "current-hash",
	providerPluginId: "plugin-id",
	pluginRevisionId: "revision-1",
	activeRevisionId: "revision-1",
	pluginScope: "system" as const,
	metadata: { kind: "script" as const },
	compiledHashes: { "plugin.script": "current-hash" },
	environmentConfigRevisionId: "config-1" as string | null,
};

const config = {
	ownerUserId: null,
	scope: "environment",
	encryptedPayload: "encrypted",
	pluginRevisionId: "revision-1",
};

type SQLCondition = { getSQL: () => SQL };
type PinRows = (table: unknown, condition?: SQLCondition) => readonly unknown[];

class PinDatabase extends Context.Service<
	PinDatabase,
	{
		readonly conditions: Effect.Effect<ReadonlyArray<SQLCondition>>;
		readonly respondWith: (rows: PinRows) => Effect.Effect<void>;
	}
>()("test/PinDatabase") {}

const pinDatabaseLayer = (rows: PinRows) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const conditions = yield* Ref.make<ReadonlyArray<SQLCondition>>([]);
			const response = yield* Ref.make(rows);
			const query = (table: unknown, condition: SQLCondition) =>
				Ref.update(conditions, (all) => [...all, condition]).pipe(
					Effect.andThen(Ref.get(response)),
					Effect.map((current) => current(table, condition)),
				);
			const database = Object.assign(Object.create(null), {
				select: () => ({
					from: (table: unknown) => {
						const builder = {
							leftJoin: () => builder,
							where: (condition: SQLCondition) =>
								Object.assign(query(table, condition), { limit: () => query(table, condition) }),
						};
						return builder;
					},
				}),
			});
			return Layer.merge(
				Layer.mock(DatabaseSession)({ current: Effect.succeed(database) }),
				Layer.succeed(PinDatabase, {
					conditions: Ref.get(conditions),
					respondWith: (next) => Ref.set(response, next),
				}),
			);
		}),
	);

const pinRows =
	(row: typeof pluginPinRow | null, storedConfig = config): PinRows =>
	(table) => {
		if (table === tables.pluginConfigRevision) {
			return [storedConfig];
		}
		return row ? [row] : [];
	};

const pinRepositoryLayer = SandboxRepository.layer.pipe(
	Layer.provideMerge(pinDatabaseLayer(pinRows(null))),
);

const getPin = Effect.fnUntraced(function* (
	row: typeof pluginPinRow | null,
	expectedRevision?: Pick<SandboxPluginRevision, "id" | "revisionId" | "configRevisionId">,
	storedConfig = config,
) {
	yield* (yield* PinDatabase).respondWith(pinRows(row, storedConfig));
	return yield* (yield* SandboxRepository).getScriptPin(
		SandboxScriptId.make("script-id"),
		expectedRevision,
	);
});

layer(pinRepositoryLayer)((test) => {
	test.effect("pins active current plugin identity and exact bootstrap declaration", () =>
		Effect.gen(function* () {
			expect(yield* getPin(pluginPinRow)).toMatchObject({
				scriptSlug: "plugin.script",
				pluginRevision: {
					ownerId: null,
					id: "plugin-id",
					scope: "system",
					revisionId: "revision-1",
					configRevisionId: "config-1",
					userBootstrapScriptSlugs: ["plugin.script"],
					workflowScripts: { "plugin-workflow": "plugin.workflow" },
				},
			});
		}),
	);
});

layer(pinRepositoryLayer)((test) => {
	test.effect("rejects inactive, stale, and foreign-provider plugin pins", () =>
		Effect.gen(function* () {
			for (const row of [
				{ ...pluginPinRow, pluginStatus: "inactive" },
				{ ...pluginPinRow, activeRevisionId: "revision-2" },
				{ ...pluginPinRow, providerPluginId: "foreign-plugin-id" },
			]) {
				expect(yield* getPin(row)).toBeNull();
			}
		}),
	);
});

layer(pinRepositoryLayer)((test) => {
	test.effect("rejects system plugin pins before environment configuration resolves", () =>
		Effect.gen(function* () {
			expect(yield* getPin({ ...pluginPinRow, environmentConfigRevisionId: null })).toBeNull();
		}),
	);
});

layer(pinRepositoryLayer)((test) => {
	test.effect(
		"retains revision/config pins across serialization and ignores active state for explicit pins",
		() =>
			Effect.gen(function* () {
				const original = yield* getPin(pluginPinRow);
				if (!original?.pluginRevision) {
					throw new Error("Expected plugin pin");
				}
				const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(SandboxPluginRevision))(
					original.pluginRevision,
				);
				const pin = yield* Schema.decodeEffect(Schema.fromJsonString(SandboxPluginRevision))(
					encoded,
				);
				expect(pin).toMatchObject({ revisionId: "revision-1", configRevisionId: "config-1" });
				expect(
					yield* getPin(
						{ ...pluginPinRow, pluginStatus: "inactive", activeRevisionId: "revision-2" },
						pin,
					),
				).toMatchObject({
					pluginRevision: { revisionId: "revision-1", configRevisionId: "config-1" },
				});
				expect(
					yield* getPin(pluginPinRow, pin, { ...config, pluginRevisionId: "revision-2" }),
				).toBeNull();
				expect(yield* getPin(pluginPinRow, pin, { ...config, encryptedPayload: "" })).toBeNull();
			}),
	);
});

const dialect = new PgDialect();
const rootId = SandboxScriptId.make("workflow-script-id");
const originalManifest = {
	...manifest,
	entitySchemas: [{ eventSchemas: [], slug: "original-entity" }],
	scripts: [
		{ kind: "workflow", slug: "plugin.workflow" },
		{ kind: "workflow", slug: "plugin.child" },
	],
	workflows: [
		{ slug: "root", scriptSlug: "plugin.workflow" },
		{ slug: "child", scriptSlug: "plugin.child" },
	],
};
const root = {
	...pluginPinRow,
	id: rootId,
	providerId: null,
	providerPluginId: null,
	slug: "plugin.workflow",
	contentHash: "workflow-v1",
	pluginManifest: originalManifest,
	metadata: { kind: "workflow" as const },
	compiledHashes: { "plugin.child": "child-v1", "plugin.workflow": "workflow-v1" },
};
const replacedRoot = {
	...root,
	compiledHashes: { "plugin.child": "child-v2", "plugin.workflow": "workflow-v2" },
	pluginManifest: {
		...originalManifest,
		workflows: [{ slug: "child", scriptSlug: "plugin.replacement" }],
		entitySchemas: [{ eventSchemas: [], slug: "replacement-entity" }],
	},
};
const isChildTarget = (condition: SQLCondition) =>
	dialect.sqlToQuery(condition.getSQL()).params.includes("plugin.child");
const workflowRows =
	(selectedPinRow: typeof root): PinRows =>
	(table, condition) => {
		if (table === tables.pluginConfigRevision) {
			return [config];
		}
		const params = condition ? dialect.sqlToQuery(condition.getSQL()).params : [];
		if (params.includes("plugin.child")) {
			return [{ id: "child-v1-id", metadata: { kind: "workflow" as const } }];
		}
		if (params.length === 1 && params[0] === "revision-1") {
			return [
				{ slug: "plugin.child", contentHash: "child-v1" },
				{ slug: "plugin.workflow", contentHash: "workflow-v1" },
			];
		}
		return [selectedPinRow];
	};

layer(SandboxRepository.layer.pipe(Layer.provideMerge(pinDatabaseLayer(workflowRows(root)))))(
	(test) => {
		test.effect("resolves first-observed children from the pinned plugin revision", () =>
			Effect.gen(function* () {
				const repository = yield* SandboxRepository;
				const database = yield* PinDatabase;
				const pin = yield* repository.getScriptPin(rootId);
				expect(pin?.pluginRevision).not.toBeNull();

				yield* database.respondWith(workflowRows(replacedRoot));
				expect(pin?.pluginRevision?.schemaScope.entitySchemaSlugs).toEqual(["original-entity"]);

				expect(
					yield* repository.resolveWorkflowCallScript(pin?.pluginRevision ?? null, {
						index: 0,
						name: "child",
						kind: "child",
						args: { input: {}, workflowSlug: "child" },
					}),
				).toEqual({ kind: "workflow", scriptId: "child-v1-id" });
				const condition = (yield* database.conditions).find(isChildTarget);
				if (condition === undefined) {
					throw new Error("Expected workflow target condition");
				}
				expect(dialect.sqlToQuery(condition.getSQL()).params).toEqual(
					expect.arrayContaining(["revision-1", "plugin.child", "child-v1"]),
				);

				yield* database.respondWith(
					workflowRows({
						...replacedRoot,
						slug: "plugin.child",
						contentHash: "child-v1",
						id: SandboxScriptId.make("child-v1-id"),
					}),
				);
				expect(
					yield* repository.getScriptPin(
						SandboxScriptId.make("child-v1-id"),
						pin?.pluginRevision ?? undefined,
					),
				).toMatchObject({
					scriptId: "child-v1-id",
					contentHash: "child-v1",
					pluginRevision: { compiledHashes: { "plugin.child": "child-v1" } },
				});
			}),
		);
	},
);
