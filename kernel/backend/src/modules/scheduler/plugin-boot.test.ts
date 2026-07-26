import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";
import { assert } from "vitest";

import { databaseLayer, makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";
import { makePluginLoader, PluginLoader } from "#modules/plugins/loader";
import type { PluginRegistryEntry } from "#modules/plugins/loader";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";

import { pluginBootExecutionId, PluginBootService } from "./plugin-boot";

type CapturedRun = Parameters<WorkflowEngine["Service"]["execute"]>[1];

const normalizedPlugin = (pluginSlug: string): PluginRegistryEntry => {
	const manifest = fixtureManifest();
	const declared = manifest.scripts[0];
	assert(declared);
	const scriptSlug = `${pluginSlug}-script`;
	const script = { ...declared, slug: scriptSlug };
	const normalizedManifest = {
		...manifest,
		hooks: [],
		savedViews: [],
		scripts: [script],
		entitySchemas: [],
		signalSchemas: [],
		relationshipSchemas: [],
		metadata: { ...manifest.metadata, slug: pluginSlug },
		boot: [{ scriptSlug, slug: `${pluginSlug}-boot`, description: `${pluginSlug} boot` }],
	} satisfies PluginManifest;
	const { entry, ...metadata } = script;
	return {
		ownerId: null,
		slug: pluginSlug,
		id: `${pluginSlug}-id`,
		scope: "system" as const,
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

const makeLayer = (
	loader: ReturnType<typeof makePluginLoader>,
	captured: Array<CapturedRun>,
	failingExecutionId?: string,
) =>
	PluginBootService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				makeAppConfigLayer(),
				databaseLayer,
				Layer.succeed(PluginLoader, { ...loader }),
				Layer.mock(PluginRuntimeResolver)({
					resolveActivePluginBoot: ({ bootSlug, pluginSlug }) => {
						const boot = loader
							.getSnapshot()
							.plugins[pluginSlug]?.manifest.boot.find(({ slug }) => slug === bootSlug);
						return Effect.succeed(
							boot
								? {
										boot,
										script: {
											source: "source",
											providerId: null,
											compiledFormat: 1,
											pluginId: pluginSlug,
											slug: boot.scriptSlug,
											name: boot.scriptSlug,
											createdAt: new Date(0),
											compiledCode: "compiled",
											contentHash: `${boot.scriptSlug}-hash`,
											pluginRevisionId: `${pluginSlug}-revision-id`,
											id: SandboxScriptId.make(`${boot.scriptSlug}-id`),
											metadata: {
												capabilities: [],
												kind: "automation",
												slug: boot.scriptSlug,
												name: boot.scriptSlug,
												requiredPluginConfigKeys: [],
												requiredSystemConfigKeys: [],
											},
										},
									}
								: null,
						);
					},
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

it.effect("awaits every plugin boot entry as a deterministic system sandbox run", () => {
	const captured: Array<CapturedRun> = [];
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.load(normalizedPlugin("fixture"));

	return Effect.gen(function* () {
		const service = yield* PluginBootService;
		yield* service.dispatchAll(60_000);
		expect(captured).toEqual([
			{
				executionId: "plugin-boot-7-fixture-12-fixture-boot-60000",
				payload: {
					input: {},
					resolutionMode: "exact",
					subject: { type: "system" },
					scriptId: SandboxScriptId.make("fixture-script-id"),
					executionId: "plugin-boot-7-fixture-12-fixture-boot-60000",
				},
			},
		]);
	}).pipe(Effect.provide(makeLayer(loader, captured)));
});

it.effect("awaits terminal plugin boot runs when manually triggered", () => {
	const captured: Array<CapturedRun> = [];
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.load(normalizedPlugin("fixture"));

	return Effect.gen(function* () {
		const service = yield* PluginBootService;
		yield* service.trigger({ pluginSlug: "fixture", bootSlug: "fixture-boot" }, "manual-id");
		expect(captured).toEqual([
			{
				executionId: "manual-id",
				payload: {
					input: {},
					resolutionMode: "exact",
					executionId: "manual-id",
					subject: { type: "system" },
					scriptId: SandboxScriptId.make("fixture-script-id"),
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
	expect(pluginBootExecutionId("sample", "preload-elements", 60_000)).toBe(
		"plugin-boot-6-sample-16-preload-elements-60000",
	);
	expect(pluginBootExecutionId("a", "b-c", 60_000)).not.toBe(
		pluginBootExecutionId("a-b", "c", 60_000),
	);
});
