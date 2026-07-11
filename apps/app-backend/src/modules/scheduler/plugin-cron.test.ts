import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import type { PluginManifest } from "@ryot/plugin-kit/manifest";
import { Effect, Layer } from "effect";
import { assert } from "vitest";

import { dbRunnerLayer, makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";
import { makePluginLoader, PluginLoader } from "#modules/plugins/loader";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";
import type { NormalizedPlugin } from "#modules/plugins/types";

import { pluginCronExecutionId, PluginCronService } from "./plugin-cron";

type CapturedRun = Parameters<WorkflowEngine["Type"]["execute"]>[1];

const normalizedPlugin = (pluginSlug: string, schedule = "* * * * *"): NormalizedPlugin => {
	const manifest = fixtureManifest();
	const declared = manifest.scripts[0];
	assert(declared);
	const scriptSlug = `${pluginSlug}-script`;
	const script = { ...declared, slug: scriptSlug };
	const normalizedManifest = {
		...manifest,
		savedViews: [],
		scripts: [script],
		entitySchemas: [],
		signalSchemas: [],
		relationshipSchemas: [],
		metadata: { ...manifest.metadata, slug: pluginSlug },
		bindings: {
			eventAutomations: [],
			entityAutomations: [],
			signalAutomations: [],
			schemaProviderLinks: [],
			relationshipAutomations: [],
		},
		crons: [
			{
				lot: "script",
				schedule,
				scriptSlug,
				slug: `${pluginSlug}-cron`,
				description: `${pluginSlug} cron`,
			},
		],
	} satisfies PluginManifest;
	const { entry, ...metadata } = script;
	return {
		manifest: normalizedManifest,
		sourceHash: `${pluginSlug}-source`,
		scripts: [
			{
				entry,
				metadata,
				source: "source",
				slug: scriptSlug,
				compiledFormat: 1,
				name: declared.name,
				compiledCode: "compiled",
				contentHash: `${pluginSlug}-compiled`,
			},
		],
	};
};

const normalizedWorkflowPlugin = (pluginSlug: string): NormalizedPlugin => {
	const plugin = normalizedPlugin(pluginSlug);
	const script = plugin.manifest.scripts[0];
	const compiled = plugin.scripts[0];
	assert(script);
	assert(compiled);
	const workflowSlug = `${pluginSlug}-workflow`;
	const workflowScript = { ...script, kind: "workflow" as const, capabilities: [] as const };
	return {
		...plugin,
		manifest: {
			...plugin.manifest,
			scripts: [workflowScript],
			workflows: [{ slug: workflowSlug, scriptSlug: workflowScript.slug }],
			crons: [
				{
					lot: "workflow",
					schedule: "* * * * *",
					workflowSlug,
					slug: `${pluginSlug}-cron`,
					description: `${pluginSlug} cron`,
				},
			],
		},
		scripts: [{ ...compiled, metadata: workflowScript }],
	};
};

const makeLayer = (
	loader: ReturnType<typeof makePluginLoader>,
	captured: Array<CapturedRun>,
	failingExecutionId?: string,
) =>
	PluginCronService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				makeAppConfigLayer(),
				dbRunnerLayer,
				Layer.succeed(PluginLoader, { _tag: "PluginLoader", ...loader }),
				Layer.mock(PluginRuntimeResolver)({
					_tag: "PluginRuntimeResolver",
					findActiveScript: (slug) =>
						Effect.succeed({
							slug,
							name: slug,
							source: "source",
							providerId: null,
							compiledFormat: 1,
							pluginSlug: "fixture",
							compiledCode: "compiled",
							contentHash: `${slug}-hash`,
							createdAt: new Date(0),
							updatedAt: new Date(0),
							id: SandboxScriptId.make(`${slug}-id`),
							metadata: {
								slug,
								name: slug,
								capabilities: [],
								kind: "automation",
								requiredAppConfigKeys: [],
							},
						}),
					findActiveWorkflowScript: ({ workflowSlug }) =>
						Effect.succeed({
							slug: workflowSlug,
							name: workflowSlug,
							source: "source",
							providerId: null,
							compiledFormat: 1,
							pluginSlug: "fixture",
							compiledCode: "compiled",
							contentHash: `${workflowSlug}-hash`,
							createdAt: new Date(0),
							updatedAt: new Date(0),
							id: SandboxScriptId.make(`${workflowSlug}-id`),
							metadata: {
								capabilities: [],
								kind: "workflow",
								slug: workflowSlug,
								name: workflowSlug,
								requiredAppConfigKeys: [],
							},
						}),
				}),
				Layer.succeed(
					WorkflowEngine,
					makeWorkflowEngine({
						execute: (_workflow, options) =>
							options.executionId === failingExecutionId
								? Effect.fail("dispatch failed")
								: Effect.sync(() => {
										captured.push(options);
										return options.executionId;
									}),
					}),
				),
			),
		),
	);

it.effect("dispatches due plugin crons as deterministic system sandbox runs", () => {
	const captured: Array<CapturedRun> = [];
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.load(normalizedPlugin("fixture"));

	return Effect.gen(function* () {
		const service = yield* PluginCronService;
		yield* service.dispatchDue(60_000);
		expect(captured).toEqual([
			{
				executionId: "plugin-cron-7-fixture-12-fixture-cron-60000",
				payload: {
					authority: { type: "system" },
					context: {},
					scriptId: SandboxScriptId.make("fixture-script-id"),
					executionId: "plugin-cron-7-fixture-12-fixture-cron-60000",
				},
			},
		]);
	}).pipe(Effect.provide(makeLayer(loader, captured)));
});

it.effect("awaits terminal plugin cron runs when manually triggered", () => {
	const captured: Array<CapturedRun> = [];
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.load(normalizedPlugin("fixture"));

	return Effect.gen(function* () {
		const service = yield* PluginCronService;
		yield* service.triggerAll("parent-id");
		expect(captured).toEqual([
			{
				executionId: "plugin-cron-7-fixture-12-fixture-cron-parent-id",
				payload: {
					context: {},
					authority: { type: "system" },
					scriptId: SandboxScriptId.make("fixture-script-id"),
					executionId: "plugin-cron-7-fixture-12-fixture-cron-parent-id",
				},
			},
		]);
	}).pipe(Effect.provide(makeLayer(loader, captured)));
});

it.effect("dispatches workflow crons through the durable workflow shell", () => {
	const captured: Array<CapturedRun> = [];
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.load(normalizedWorkflowPlugin("fixture"));

	return Effect.gen(function* () {
		const service = yield* PluginCronService;
		yield* service.triggerAll("parent-id");
		expect(captured).toEqual([
			{
				executionId: "plugin-cron-7-fixture-12-fixture-cron-parent-id",
				payload: {
					input: {},
					resolutionMode: "exact",
					authority: { type: "system" },
					scriptId: SandboxScriptId.make("fixture-workflow-id"),
					executionId: "plugin-cron-7-fixture-12-fixture-cron-parent-id",
				},
			},
		]);
	}).pipe(Effect.provide(makeLayer(loader, captured)));
});

it.effect("targets exactly one script cron", () => {
	const captured: Array<CapturedRun> = [];
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.rebuild([normalizedPlugin("first"), normalizedPlugin("second")]);

	return Effect.gen(function* () {
		const service = yield* PluginCronService;
		expect(yield* service.trigger("second", "second-cron", "parent-id")).toEqual({
			lot: "script",
			pluginSlug: "second",
			cronSlug: "second-cron",
			status: "executed",
			result: "plugin-cron-6-second-11-second-cron-parent-id",
			executionId: "plugin-cron-6-second-11-second-cron-parent-id",
		});
		expect(captured).toHaveLength(1);
		expect(captured[0]?.payload).toMatchObject({
			authority: { type: "system" },
			scriptId: SandboxScriptId.make("second-script-id"),
		});
	}).pipe(Effect.provide(makeLayer(loader, captured)));
});

it.effect("targets one workflow cron through the durable workflow shell", () => {
	const captured: Array<CapturedRun> = [];
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.load(normalizedWorkflowPlugin("fixture"));

	return Effect.gen(function* () {
		const service = yield* PluginCronService;
		const result = yield* service.trigger("fixture", "fixture-cron", "parent-id");
		expect(result).toMatchObject({
			lot: "workflow",
			pluginSlug: "fixture",
			cronSlug: "fixture-cron",
			status: "executed",
			executionId: "plugin-cron-7-fixture-12-fixture-cron-parent-id",
		});
		expect(captured).toHaveLength(1);
		expect(captured[0]?.payload).toMatchObject({
			input: {},
			resolutionMode: "exact",
			authority: { type: "system" },
			scriptId: SandboxScriptId.make("fixture-workflow-id"),
		});
	}).pipe(Effect.provide(makeLayer(loader, captured)));
});

it.effect("returns notFound without dispatching an unknown cron", () => {
	const captured: Array<CapturedRun> = [];
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.load(normalizedPlugin("fixture"));

	return Effect.gen(function* () {
		const service = yield* PluginCronService;
		expect(yield* service.trigger("fixture", "unknown", "parent-id")).toEqual({
			status: "notFound",
			cronSlug: "unknown",
			pluginSlug: "fixture",
		});
		expect(captured).toEqual([]);
	}).pipe(Effect.provide(makeLayer(loader, captured)));
});

it.effect("observes hot-loaded snapshots without scheduler registration", () => {
	const captured: Array<CapturedRun> = [];
	const loader = makePluginLoader(makeDefinitionRegistry());

	return Effect.gen(function* () {
		const service = yield* PluginCronService;
		yield* service.dispatchDue(60_000);
		loader.load(normalizedPlugin("hot"));
		yield* service.dispatchDue(120_000);
		expect(captured.map(({ executionId }) => executionId)).toEqual([
			"plugin-cron-3-hot-8-hot-cron-120000",
		]);
	}).pipe(Effect.provide(makeLayer(loader, captured)));
});

it.effect("isolates unavailable and failed cron dispatches", () => {
	const captured: Array<CapturedRun> = [];
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.rebuild([normalizedPlugin("missing"), normalizedPlugin("working")]);
	const failingExecutionId = "plugin-cron-7-missing-12-missing-cron-60000";

	return Effect.gen(function* () {
		const service = yield* PluginCronService;
		yield* service.dispatchDue(60_000);
		expect(captured.map(({ executionId }) => executionId)).toEqual([
			"plugin-cron-7-working-12-working-cron-60000",
		]);
	}).pipe(Effect.provide(makeLayer(loader, captured, failingExecutionId)));
});

it("builds stable execution ids", () => {
	expect(pluginCronExecutionId("media", "trending", 60_000)).toBe(
		"plugin-cron-5-media-8-trending-60000",
	);
	expect(pluginCronExecutionId("a", "b-c", 60_000)).not.toBe(
		pluginCronExecutionId("a-b", "c", 60_000),
	);
});
