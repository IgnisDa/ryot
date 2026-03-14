import { expect, it } from "@effect/vitest";
import type { PluginCron, PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { PluginSlug, SandboxScriptId } from "@ryot/contract/schema/brands";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";
import { assert } from "vitest";

import { dbRunnerLayer, makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";
import { makePluginLoader, PluginLoader } from "#modules/plugins/loader";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";
import type { NormalizedPlugin } from "#modules/plugins/types";

import { pluginCronExecutionId, PluginCronService } from "./plugin-cron";

type CapturedRun = Parameters<WorkflowEngine["Service"]["execute"]>[1];

const testDate = new Date(0);

const normalizedPlugin = (
	pluginSlug: string,
	schedule: PluginCron["schedule"] = { cron: "* * * * *" },
): NormalizedPlugin => {
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
		scripts: [{ ...compiled, metadata: workflowScript }],
		manifest: {
			...plugin.manifest,
			scripts: [workflowScript],
			workflows: [{ slug: workflowSlug, scriptSlug: workflowScript.slug }],
			crons: [
				{
					slug: `${pluginSlug}-cron`,
					schedule: { cron: "* * * * *" },
					scriptSlug: workflowScript.slug,
					description: `${pluginSlug} cron`,
				},
			],
		},
	};
};

const makeLayer = (
	loader: ReturnType<typeof makePluginLoader>,
	captured: Array<CapturedRun>,
	failingExecutionId?: string,
	infrequentCronJobsSchedule = "0 0 * * *",
	resolveActivePluginCron?: PluginRuntimeResolver["Service"]["resolveActivePluginCron"],
) =>
	PluginCronService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				makeAppConfigLayer({ scheduler: { infrequentCronJobsSchedule } }),
				dbRunnerLayer,
				Layer.succeed(PluginLoader, { ...loader }),
				Layer.mock(PluginRuntimeResolver)({
					resolveActivePluginCron:
						resolveActivePluginCron ??
						(({ cronSlug, pluginSlug }) => {
							const plugin = loader.getSnapshot().plugins[pluginSlug];
							const cron = plugin?.manifest.crons.find(({ slug }) => slug === cronSlug);
							if (!cron) {
								return Effect.succeed(null);
							}
							const slug = cron.scriptSlug;
							const kind =
								plugin?.manifest.scripts.find((script) => script.slug === slug)?.kind ??
								"automation";
							return Effect.succeed({
								cron,
								script: {
									slug,
									name: slug,
									pluginSlug,
									source: "source",
									providerId: null,
									compiledFormat: 1,
									compiledCode: "compiled",
									contentHash: `${slug}-hash`,
									createdAt: new Date(0),
									updatedAt: new Date(0),
									id: SandboxScriptId.make(`${slug}-id`),
									metadata: {
										kind,
										slug,
										name: slug,
										capabilities: [],
										requiredPluginConfigKeys: [],
										requiredSystemConfigKeys: [],
									},
								},
							});
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
					input: {},
					resolutionMode: "exact",
					authority: { type: "system" },
					scriptId: SandboxScriptId.make("fixture-script-id"),
					executionId: "plugin-cron-7-fixture-12-fixture-cron-60000",
				},
			},
		]);
	}).pipe(Effect.provide(makeLayer(loader, captured)));
});

it.effect("resolves infrequent plugin cron schedules from application config", () => {
	const captured: Array<CapturedRun> = [];
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.load(normalizedPlugin("fixture", { tier: "infrequent" }));

	return Effect.gen(function* () {
		const service = yield* PluginCronService;
		yield* service.dispatchDue(60_000);
		expect(captured).toHaveLength(1);
	}).pipe(Effect.provide(makeLayer(loader, captured, undefined, "* * * * *")));
});

it.effect("skips infrequent plugin crons when the configured schedule is invalid", () => {
	const captured: Array<CapturedRun> = [];
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.load(normalizedPlugin("fixture", { tier: "infrequent" }));

	return Effect.gen(function* () {
		const service = yield* PluginCronService;
		yield* service.dispatchDue(60_000);
		expect(captured).toEqual([]);
	}).pipe(Effect.provide(makeLayer(loader, captured, undefined, "not a cron")));
});

it.effect("targets exactly one script cron", () => {
	const captured: Array<CapturedRun> = [];
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.rebuild([normalizedPlugin("first"), normalizedPlugin("second")]);

	return Effect.gen(function* () {
		const service = yield* PluginCronService;
		expect(yield* service.trigger(PluginSlug.make("second"), "second-cron", "parent-id")).toEqual({
			status: "executed",
			pluginSlug: "second",
			cronSlug: "second-cron",
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
		const result = yield* service.trigger(PluginSlug.make("fixture"), "fixture-cron", "parent-id");
		expect(result).toMatchObject({
			status: "executed",
			pluginSlug: "fixture",
			cronSlug: "fixture-cron",
			executionId: "plugin-cron-7-fixture-12-fixture-cron-parent-id",
		});
		expect(captured).toHaveLength(1);
		expect(captured[0]?.payload).toMatchObject({
			input: {},
			resolutionMode: "exact",
			authority: { type: "system" },
			scriptId: SandboxScriptId.make("fixture-script-id"),
		});
	}).pipe(Effect.provide(makeLayer(loader, captured)));
});

it.effect("returns notFound without dispatching an unknown cron", () => {
	const captured: Array<CapturedRun> = [];
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.load(normalizedPlugin("fixture"));

	return Effect.gen(function* () {
		const service = yield* PluginCronService;
		expect(yield* service.trigger(PluginSlug.make("fixture"), "unknown", "parent-id")).toEqual({
			status: "notFound",
			cronSlug: "unknown",
			pluginSlug: "fixture",
		});
		expect(captured).toEqual([]);
	}).pipe(Effect.provide(makeLayer(loader, captured)));
});

it.effect("reports workflow failures from manual cron triggers", () => {
	const captured: Array<CapturedRun> = [];
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.load(normalizedPlugin("fixture"));

	return Effect.gen(function* () {
		const service = yield* PluginCronService;
		const result = yield* service.trigger(PluginSlug.make("fixture"), "fixture-cron", "parent-id");
		expect(result).toMatchObject({
			status: "failed",
			pluginSlug: "fixture",
			cronSlug: "fixture-cron",
			result: {
				error: { phase: "execute", message: "dispatch failed" },
			},
		});
		expect(captured).toEqual([]);
	}).pipe(
		Effect.provide(makeLayer(loader, captured, "plugin-cron-7-fixture-12-fixture-cron-parent-id")),
	);
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

it.effect(
	"dispatches a manifest entry and script selected from one snapshot during replacement",
	() => {
		const captured: Array<CapturedRun> = [];
		const loader = makePluginLoader(makeDefinitionRegistry());
		loader.load(normalizedPlugin("fixture"));
		const replacement = normalizedPlugin("fixture");
		const replacementScript = replacement.scripts[0];
		assert(replacementScript);

		return Effect.gen(function* () {
			const selected = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const resolveActivePluginCron: PluginRuntimeResolver["Service"]["resolveActivePluginCron"] = (
				identity,
			) =>
				Effect.gen(function* () {
					const plugin = loader.getSnapshot().plugins[identity.pluginSlug];
					const cron = plugin?.manifest.crons.find(({ slug }) => slug === identity.cronSlug);
					assert(plugin);
					assert(cron);
					const script = plugin.scripts.find(({ slug }) => slug === cron.scriptSlug);
					assert(script);
					yield* Deferred.succeed(selected, undefined);
					yield* Deferred.await(release);
					return {
						cron,
						script: {
							...script,
							providerId: null,
							createdAt: testDate,
							updatedAt: testDate,
							pluginSlug: identity.pluginSlug,
							id: SandboxScriptId.make(`${script.contentHash}-id`),
						},
					};
				});
			const layer = makeLayer(loader, captured, undefined, "0 0 * * *", resolveActivePluginCron);
			const fiber = yield* Effect.forkChild(
				Effect.gen(function* () {
					const service = yield* PluginCronService;
					yield* service.dispatchDue(60_000);
				}).pipe(Effect.provide(layer)),
			);
			yield* Deferred.await(selected);
			loader.load({
				...replacement,
				scripts: [{ ...replacementScript, contentHash: "new-compiled" }],
			});
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(fiber);
			expect(captured[0]?.payload).toMatchObject({
				scriptId: SandboxScriptId.make("fixture-compiled-id"),
			});
		});
	},
);

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
