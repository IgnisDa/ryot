import { expect as effectExpect, it as effectIt } from "@effect/vitest";
import type { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import type { WorkflowDurableCallRequest } from "@ryot/sandbox-sdk/workflow";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { Database } from "#lib/infrastructure/db/service";

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
	workflows: [{ slug: "plugin-workflow", scriptSlug: "plugin.workflow" }],
	configSchema: { fields: {}, unknownKeys: "strict" },
	entitySchemas: [],
	relationshipSchemas: [],
	scripts: [{ slug: "plugin.script", kind: "script" }],
	userBootstrap: [{ slug: "bootstrap", scriptSlug: "plugin.script", description: "Bootstrap" }],
} as unknown as PluginManifest;

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
	pluginScope: "system" as const,
	metadata: { kind: "script" as const },
	compiledHashes: { "plugin.script": "current-hash" },
};

const getPin = (row: typeof pluginPinRow | null) =>
	Effect.flatMap(SandboxRepository, (repository) =>
		repository.getScriptPin(SandboxScriptId.make("script-id")),
	).pipe(
		Effect.provide(
			Layer.mergeAll(
				SandboxRepository.layer,
				Layer.succeed(
					Database,
					Object.assign(Object.create(null), {
						select: () => ({
							from: () => ({
								leftJoin: () => ({
									leftJoin: () => ({
										where: () => ({ limit: () => Effect.succeed(row ? [row] : []) }),
									}),
								}),
							}),
						}),
					}),
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
			{ ...pluginPinRow, contentHash: "stale-hash" },
			{ ...pluginPinRow, providerPluginId: "foreign-plugin-id" },
		]) {
			effectExpect(yield* getPin(row)).toBeNull();
		}
	}),
);

effectIt.effect("resolves first-observed children from the pinned plugin revision", () => {
	const rootId = SandboxScriptId.make("workflow-script-id");
	const originalManifest = {
		...manifest,
		entitySchemas: [{ slug: "original-entity", eventSchemas: [] }],
		scripts: [
			{ slug: "plugin.workflow", kind: "workflow" },
			{ slug: "plugin.child", kind: "workflow" },
		],
		workflows: [
			{ slug: "root", scriptSlug: "plugin.workflow" },
			{ slug: "child", scriptSlug: "plugin.child" },
		],
	} as unknown as PluginManifest;
	const root = {
		...pluginPinRow,
		id: rootId,
		providerId: null,
		providerPluginId: null,
		slug: "plugin.workflow",
		contentHash: "workflow-v1",
		pluginManifest: originalManifest,
		metadata: { kind: "workflow" as const },
		compiledHashes: { "plugin.workflow": "workflow-v1", "plugin.child": "child-v1" },
	};
	let selectedPinRow = root;
	const dialect = new PgDialect();
	const targetConditions: unknown[] = [];
	const database = Object.assign(Object.create(null), {
		select: () => ({
			from: () => ({
				leftJoin: () => ({
					leftJoin: () => ({
						where: () => ({ limit: () => Effect.succeed([selectedPinRow]) }),
					}),
				}),
				where: (condition: unknown) => ({
					limit: () => {
						targetConditions.push(condition);
						return Effect.succeed([{ id: "child-v1-id", metadata: { kind: "workflow" as const } }]);
					},
				}),
			}),
		}),
	});
	const layer = Layer.mergeAll(SandboxRepository.layer, Layer.succeed(Database, database));

	return Effect.gen(function* () {
		const repository = yield* SandboxRepository;
		const pin = yield* repository.getScriptPin(rootId);
		effectExpect(pin?.pluginRevision).not.toBeNull();

		root.pluginManifest = {
			...originalManifest,
			workflows: [{ slug: "child", scriptSlug: "plugin.replacement" }],
			entitySchemas: [
				{ ...originalManifest.entitySchemas[0]!, slug: "replacement-entity", eventSchemas: [] },
			],
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
		const condition = targetConditions[0] as { getSQL: () => SQL };
		effectExpect(dialect.sqlToQuery(condition.getSQL()).params).toEqual(
			effectExpect.arrayContaining(["plugin-id", "plugin.child", "child-v1"]),
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
