import { expect as effectExpect, it as effectIt } from "@effect/vitest";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import type { WorkflowDurableCallRequest } from "@ryot-app/sandbox-sdk/workflow";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database } from "#lib/infrastructure/db/service";
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

const pinDatabase = (
	rows: (table: unknown, condition?: { getSQL: () => SQL }) => readonly unknown[],
) =>
	Object.assign(Object.create(null), {
		select: () => ({
			from: (table: unknown) => {
				const query = {
					leftJoin: () => query,
					where: (condition: { getSQL: () => SQL }) =>
						Object.assign(
							Effect.sync(() => rows(table, condition)),
							{ limit: () => Effect.sync(() => rows(table, condition)) },
						),
				};
				return query;
			},
		}),
	});

const getPin = (
	row: typeof pluginPinRow | null,
	expectedRevision?: Pick<SandboxPluginRevision, "id" | "revisionId" | "configRevisionId">,
	storedConfig = config,
) =>
	Effect.flatMap(SandboxRepository, (repository) =>
		repository.getScriptPin(SandboxScriptId.make("script-id"), expectedRevision),
	).pipe(
		Effect.provide(
			SandboxRepository.layer.pipe(
				Layer.provideMerge(
					Layer.succeed(
						Database,
						pinDatabase((table) => {
							if (table === tables.pluginConfigRevision) {
								return [storedConfig];
							}
							return row ? [row] : [];
						}),
					),
				),
			),
		),
	);

effectIt.effect("pins active current plugin identity and exact bootstrap declaration", () =>
	Effect.gen(function* () {
		effectExpect(yield* getPin(pluginPinRow)).toMatchObject({
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

effectIt.effect("rejects inactive, stale, and foreign-provider plugin pins", () =>
	Effect.gen(function* () {
		for (const row of [
			{ ...pluginPinRow, pluginStatus: "inactive" },
			{ ...pluginPinRow, activeRevisionId: "revision-2" },
			{ ...pluginPinRow, providerPluginId: "foreign-plugin-id" },
		]) {
			effectExpect(yield* getPin(row)).toBeNull();
		}
	}),
);

effectIt.effect("rejects system plugin pins before environment configuration resolves", () =>
	Effect.gen(function* () {
		effectExpect(yield* getPin({ ...pluginPinRow, environmentConfigRevisionId: null })).toBeNull();
	}),
);

effectIt.effect(
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
			const pin = yield* Schema.decodeEffect(Schema.fromJsonString(SandboxPluginRevision))(encoded);
			effectExpect(pin).toMatchObject({ revisionId: "revision-1", configRevisionId: "config-1" });
			effectExpect(
				yield* getPin(
					{ ...pluginPinRow, pluginStatus: "inactive", activeRevisionId: "revision-2" },
					pin,
				),
			).toMatchObject({
				pluginRevision: { revisionId: "revision-1", configRevisionId: "config-1" },
			});
			effectExpect(
				yield* getPin(pluginPinRow, pin, { ...config, pluginRevisionId: "revision-2" }),
			).toBeNull();
			effectExpect(
				yield* getPin(pluginPinRow, pin, { ...config, encryptedPayload: "" }),
			).toBeNull();
		}),
);

effectIt.effect("resolves first-observed children from the pinned plugin revision", () => {
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
	let selectedPinRow = root;
	const dialect = new PgDialect();
	type SQLCondition = { getSQL: () => SQL };
	const targetConditions: SQLCondition[] = [];
	const database = pinDatabase((table, condition) => {
		if (table === tables.pluginConfigRevision) {
			return [config];
		}
		const params = condition ? dialect.sqlToQuery(condition.getSQL()).params : [];
		if (params.includes("plugin.child")) {
			if (condition) {
				targetConditions.push(condition);
			}
			return [{ id: "child-v1-id", metadata: { kind: "workflow" as const } }];
		}
		if (params.length === 1 && params[0] === "revision-1") {
			return [
				{ slug: "plugin.child", contentHash: "child-v1" },
				{ slug: "plugin.workflow", contentHash: "workflow-v1" },
			];
		}
		return [selectedPinRow];
	});
	const layer = SandboxRepository.layer.pipe(Layer.provideMerge(Layer.succeed(Database, database)));

	return Effect.gen(function* () {
		const repository = yield* SandboxRepository;
		const pin = yield* repository.getScriptPin(rootId);
		effectExpect(pin?.pluginRevision).not.toBeNull();

		root.pluginManifest = {
			...originalManifest,
			workflows: [{ slug: "child", scriptSlug: "plugin.replacement" }],
			entitySchemas: [{ eventSchemas: [], slug: "replacement-entity" }],
		};
		root.compiledHashes = { "plugin.child": "child-v2", "plugin.workflow": "workflow-v2" };
		effectExpect(pin?.pluginRevision?.schemaScope.entitySchemaSlugs).toEqual(["original-entity"]);

		effectExpect(
			yield* repository.resolveWorkflowCallScript(pin?.pluginRevision ?? null, {
				index: 0,
				name: "child",
				kind: "child",
				args: { input: {}, workflowSlug: "child" },
			}),
		).toEqual({ kind: "workflow", scriptId: "child-v1-id" });
		const condition = targetConditions[0];
		if (condition === undefined) {
			throw new Error("Expected workflow target condition");
		}
		effectExpect(dialect.sqlToQuery(condition.getSQL()).params).toEqual(
			effectExpect.arrayContaining(["revision-1", "plugin.child", "child-v1"]),
		);

		selectedPinRow = {
			...root,
			slug: "plugin.child",
			contentHash: "child-v1",
			id: SandboxScriptId.make("child-v1-id"),
		};
		effectExpect(
			yield* repository.getScriptPin(
				SandboxScriptId.make("child-v1-id"),
				pin?.pluginRevision ?? undefined,
			),
		).toMatchObject({
			scriptId: "child-v1-id",
			contentHash: "child-v1",
			pluginRevision: { compiledHashes: { "plugin.child": "child-v1" } },
		});
	}).pipe(Effect.provide(layer));
});
