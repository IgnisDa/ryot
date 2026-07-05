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

import { pluginBootExecutionId, PluginBootService } from "./plugin-boot";

type CapturedRun = {
	readonly executionId: string;
	readonly payload: {
		readonly userId: null;
		readonly context: unknown;
		readonly driverName: string;
		readonly executionId: string;
		readonly scriptId: SandboxScriptId;
	};
};

const normalizedPlugin = (pluginSlug: string): NormalizedPlugin => {
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
		boot: [
			{ driverRef: scriptSlug, slug: `${pluginSlug}-boot`, description: `${pluginSlug} boot` },
		],
		bindings: {
			eventAutomations: [],
			entityAutomations: [],
			signalAutomations: [],
			schemaScriptLinks: [],
			relationshipAutomations: [],
		},
	} satisfies PluginManifest;
	const { entry, ...metadata } = script;
	return {
		manifest: normalizedManifest,
		sourceHash: `${pluginSlug}-source`,
		scripts: [
			{
				entry,
				source: "source",
				slug: scriptSlug,
				compiledFormat: 1,
				name: declared.name,
				compiledCode: "compiled",
				contentHash: `${pluginSlug}-compiled`,
				metadata: { ...metadata, driverNames: ["boot"] },
			},
		],
	};
};

const makeLayer = (
	loader: ReturnType<typeof makePluginLoader>,
	captured: Array<CapturedRun>,
	failingExecutionId?: string,
) =>
	PluginBootService.Default.pipe(
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
								driverNames: ["boot"],
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
										captured.push(options as CapturedRun);
										return options.executionId;
									}),
					}),
				),
			),
		),
	);

it.effect("dispatches every plugin boot entry as a deterministic system sandbox run", () => {
	const captured: Array<CapturedRun> = [];
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.load(normalizedPlugin("fixture"));

	return Effect.gen(function* () {
		const service = yield* PluginBootService;
		yield* service.dispatchAll(60_000);
		expect(captured).toEqual([
			{
				discard: true,
				executionId: "plugin-boot-7-fixture-12-fixture-boot-60000",
				payload: {
					context: {},
					userId: null,
					driverName: "boot",
					scriptId: SandboxScriptId.make("fixture-script-id"),
					executionId: "plugin-boot-7-fixture-12-fixture-boot-60000",
				},
			},
		]);
	}).pipe(Effect.provide(makeLayer(loader, captured)));
});

it.effect("isolates unavailable and failed boot dispatches", () => {
	const captured: Array<CapturedRun> = [];
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.rebuild([normalizedPlugin("missing"), normalizedPlugin("working")]);
	const failingExecutionId = "plugin-boot-7-missing-12-missing-boot-60000";

	return Effect.gen(function* () {
		const service = yield* PluginBootService;
		yield* service.dispatchAll(60_000);
		expect(captured.map(({ executionId }) => executionId)).toEqual([
			"plugin-boot-7-working-12-working-boot-60000",
		]);
	}).pipe(Effect.provide(makeLayer(loader, captured, failingExecutionId)));
});

it("builds stable execution ids", () => {
	expect(pluginBootExecutionId("fitness", "preload-exercises", 60_000)).toBe(
		"plugin-boot-7-fitness-17-preload-exercises-60000",
	);
	expect(pluginBootExecutionId("a", "b-c", 60_000)).not.toBe(
		pluginBootExecutionId("a-b", "c", 60_000),
	);
});
