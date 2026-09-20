import { expect, it, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type { PluginCron, PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { PluginSlug, SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Deferred, Effect, Fiber, Layer, Ref } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";
import { assert } from "vitest";

import { assertExitFails } from "#lib/test-utils/assertions";
import { databaseLayer, makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";
import type { PluginRevision, StoredPluginIdentity } from "#modules/plugins/types";

import {
	pluginCronExecutionId,
	PluginCronService,
	privatePluginCronExecutionId,
} from "./plugin-cron";

type CapturedRun = Parameters<WorkflowEngine["Service"]["execute"]>[1];

type PluginRegistryEntry = PluginRevision & StoredPluginIdentity;

type Catalog = Readonly<Record<string, PluginRegistryEntry>>;

type ResolveActivePluginCron = PluginRuntimeResolver["Service"]["resolveActivePluginCron"];

class DispatchedRuns extends Context.Service<
	DispatchedRuns,
	Effect.Effect<ReadonlyArray<CapturedRun>>
>()("test/DispatchedRuns") {}

class PluginCatalog extends Context.Service<
	PluginCatalog,
	{ readonly load: (plugin: PluginRegistryEntry) => Effect.Effect<void> }
>()("test/PluginCatalog") {}

const recordingWorkflowEngineLayer = (failingExecutionId?: string) =>
	Layer.effectContext(
		Effect.gen(function* () {
			const dispatched = yield* Ref.make<ReadonlyArray<CapturedRun>>([]);
			return Context.make(
				WorkflowEngine,
				makeWorkflowEngine({
					execute: (_workflow, options) =>
						options.executionId === failingExecutionId
							? Effect.fail("dispatch failed")
							: Ref.update(dispatched, (all) => [...all, options]).pipe(
									Effect.as(options.executionId),
								),
				}),
			).pipe(Context.add(DispatchedRuns, Ref.get(dispatched)));
		}),
	);

const testDate = new Date(0);

const normalizedPlugin = (
	pluginSlug: string,
	schedule: PluginCron["schedule"] = { cron: "* * * * *" },
): PluginRegistryEntry => {
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
		crons: [
			{ schedule, scriptSlug, slug: `${pluginSlug}-cron`, description: `${pluginSlug} cron` },
		],
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
				slug: scriptSlug,
				name: declared.name,
				contentHash: `${pluginSlug}-compiled`,
			},
		],
	};
};

const normalizedWorkflowPlugin = (pluginSlug: string): PluginRegistryEntry => {
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

const resolveFromCatalog =
	(plugins: Effect.Effect<Catalog>): ResolveActivePluginCron =>
	({ cronSlug, pluginSlug }) =>
		Effect.map(plugins, (current) => {
			const plugin = current[pluginSlug];
			const cron = plugin?.manifest.crons.find(({ slug }) => slug === cronSlug);
			if (!cron) {
				return null;
			}
			const slug = cron.scriptSlug;
			const kind =
				plugin?.manifest.scripts.find((script) => script.slug === slug)?.kind ?? "automation";
			return {
				cron,
				script: {
					slug,
					name: slug,
					source: "source",
					providerId: null,
					compiledFormat: 1,
					pluginId: pluginSlug,
					createdAt: new Date(0),
					compiledCode: "compiled",
					contentHash: `${slug}-hash`,
					id: SandboxScriptId.make(`${slug}-id`),
					pluginRevisionId: `${pluginSlug}-revision-id`,
					metadata: {
						kind,
						slug,
						name: slug,
						capabilities: [],
						requiredPluginConfigKeys: [],
						requiredSystemConfigKeys: [],
					},
				},
			};
		});

const makeLayer = (
	options: {
		plugins?: ReadonlyArray<PluginRegistryEntry>;
		failingExecutionId?: string;
		infrequentCronJobsSchedule?: string;
		resolveActivePluginCron?: (plugins: Effect.Effect<Catalog>) => ResolveActivePluginCron;
		listPrivateCronSchedules?: PluginRuntimeResolver["Service"]["listPrivateCronSchedules"];
	} = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const catalog = yield* Ref.make<Catalog>(
				Object.fromEntries((options.plugins ?? []).map((plugin) => [plugin.slug, plugin])),
			);
			const plugins = Ref.get(catalog);
			return PluginCronService.layer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						makeAppConfigLayer({
							scheduler: {
								infrequentCronJobsSchedule: options.infrequentCronJobsSchedule ?? "0 0 * * *",
							},
						}),
						databaseLayer,
						Layer.mock(PluginRuntimeResolver)({
							listPrivateCronSchedules:
								options.listPrivateCronSchedules ?? (() => Effect.succeed([])),
							resolveActivePluginCron: (options.resolveActivePluginCron ?? resolveFromCatalog)(
								plugins,
							),
							listSystemCronSchedules: () =>
								Effect.map(plugins, (current) =>
									Object.values(current)
										.flatMap((plugin) =>
											plugin.manifest.crons.map((cron) => ({ cron, pluginSlug: plugin.slug })),
										)
										.sort(
											(left, right) =>
												left.pluginSlug.localeCompare(right.pluginSlug) ||
												left.cron.slug.localeCompare(right.cron.slug),
										),
								),
						}),
						recordingWorkflowEngineLayer(options.failingExecutionId),
						Layer.succeed(PluginCatalog, {
							load: (plugin) =>
								Ref.update(catalog, (current) => ({ ...current, [plugin.slug]: plugin })),
						}),
					),
				),
			);
		}),
	);

class SelectionGate extends Context.Service<
	SelectionGate,
	{ readonly selected: Deferred.Deferred<void>; readonly release: Deferred.Deferred<void> }
>()("test/SelectionGate") {}

const gatedSelectionLayer = (plugins: ReadonlyArray<PluginRegistryEntry>) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const selected = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			return Layer.merge(
				makeLayer({
					plugins,
					resolveActivePluginCron: (catalog) => (identity) =>
						Effect.gen(function* () {
							const plugin = (yield* catalog)[identity.pluginSlug];
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
									pluginId: identity.pluginSlug,
									id: SandboxScriptId.make(`${script.contentHash}-id`),
									pluginRevisionId: `${identity.pluginSlug}-revision-id`,
								},
							};
						}),
				}),
				Layer.succeed(SelectionGate, { release, selected }),
			);
		}),
	);

layer(makeLayer({ plugins: [normalizedPlugin("fixture")] }))((test) => {
	test.effect("dispatches due plugin crons as deterministic system sandbox runs", () =>
		Effect.gen(function* () {
			const service = yield* PluginCronService;
			yield* service.dispatchDue(60_000);
			expect(yield* yield* DispatchedRuns).toEqual([
				{
					executionId: "plugin-cron-7-fixture-12-fixture-cron-60000",
					payload: {
						input: {},
						resolutionMode: "exact",
						subject: { type: "system" },
						scriptId: SandboxScriptId.make("fixture-script-id"),
						executionId: "plugin-cron-7-fixture-12-fixture-cron-60000",
					},
				},
			]);
		}),
	);
});

layer(
	makeLayer({
		infrequentCronJobsSchedule: "* * * * *",
		plugins: [normalizedPlugin("fixture", { tier: "infrequent" })],
	}),
)((test) => {
	test.effect("resolves infrequent plugin cron schedules from application config", () =>
		Effect.gen(function* () {
			const service = yield* PluginCronService;
			yield* service.dispatchDue(60_000);
			expect(yield* yield* DispatchedRuns).toHaveLength(1);
		}),
	);
});

layer(
	makeLayer({
		infrequentCronJobsSchedule: "not a cron",
		plugins: [normalizedPlugin("fixture", { tier: "infrequent" })],
	}),
)((test) => {
	test.effect("skips infrequent plugin crons when the configured schedule is invalid", () =>
		Effect.gen(function* () {
			const service = yield* PluginCronService;
			yield* service.dispatchDue(60_000);
			expect(yield* yield* DispatchedRuns).toEqual([]);
		}),
	);
});

const privateDiscoveryError = new DbError({ message: "private cron discovery failed" });

layer(
	makeLayer({
		plugins: [normalizedPlugin("fixture")],
		listPrivateCronSchedules: () => Effect.fail(privateDiscoveryError),
	}),
)((test) => {
	test.effect("fails the tick when private cron discovery fails", () =>
		Effect.gen(function* () {
			const service = yield* PluginCronService;
			const exit = yield* Effect.exit(service.dispatchDue(60_000));
			assertExitFails(exit, privateDiscoveryError);
			expect(yield* yield* DispatchedRuns).toEqual([]);
		}),
	);
});

layer(makeLayer({ plugins: [normalizedPlugin("first"), normalizedPlugin("second")] }))((test) => {
	test.effect("targets exactly one script cron", () =>
		Effect.gen(function* () {
			const service = yield* PluginCronService;
			expect(yield* service.trigger(PluginSlug.make("second"), "second-cron", "parent-id")).toEqual(
				{
					status: "executed",
					pluginSlug: "second",
					cronSlug: "second-cron",
					result: "plugin-cron-6-second-11-second-cron-parent-id",
					executionId: "plugin-cron-6-second-11-second-cron-parent-id",
				},
			);
			const captured = yield* yield* DispatchedRuns;
			expect(captured).toHaveLength(1);
			expect(captured[0]?.payload).toMatchObject({
				subject: { type: "system" },
				scriptId: SandboxScriptId.make("second-script-id"),
			});
		}),
	);
});

layer(makeLayer({ plugins: [normalizedWorkflowPlugin("fixture")] }))((test) => {
	test.effect("targets one workflow cron through the durable workflow shell", () =>
		Effect.gen(function* () {
			const service = yield* PluginCronService;
			const result = yield* service.trigger(
				PluginSlug.make("fixture"),
				"fixture-cron",
				"parent-id",
			);
			expect(result).toMatchObject({
				status: "executed",
				pluginSlug: "fixture",
				cronSlug: "fixture-cron",
				executionId: "plugin-cron-7-fixture-12-fixture-cron-parent-id",
			});
			const captured = yield* yield* DispatchedRuns;
			expect(captured).toHaveLength(1);
			expect(captured[0]?.payload).toMatchObject({
				input: {},
				resolutionMode: "exact",
				subject: { type: "system" },
				scriptId: SandboxScriptId.make("fixture-script-id"),
			});
		}),
	);
});

layer(makeLayer({ plugins: [normalizedPlugin("fixture")] }))((test) => {
	test.effect("returns notFound without dispatching an unknown cron", () =>
		Effect.gen(function* () {
			const service = yield* PluginCronService;
			expect(yield* service.trigger(PluginSlug.make("fixture"), "unknown", "parent-id")).toEqual({
				status: "notFound",
				cronSlug: "unknown",
				pluginSlug: "fixture",
			});
			expect(yield* yield* DispatchedRuns).toEqual([]);
		}),
	);
});

layer(
	makeLayer({
		plugins: [normalizedPlugin("fixture")],
		failingExecutionId: "plugin-cron-7-fixture-12-fixture-cron-parent-id",
	}),
)((test) => {
	test.effect("reports workflow failures from manual cron triggers", () =>
		Effect.gen(function* () {
			const service = yield* PluginCronService;
			const result = yield* service.trigger(
				PluginSlug.make("fixture"),
				"fixture-cron",
				"parent-id",
			);
			expect(result).toMatchObject({
				status: "failed",
				pluginSlug: "fixture",
				cronSlug: "fixture-cron",
				result: { error: { phase: "execute", message: "dispatch failed" } },
			});
			expect(yield* yield* DispatchedRuns).toEqual([]);
		}),
	);
});

layer(makeLayer())((test) => {
	test.effect("observes hot-loaded snapshots without scheduler registration", () =>
		Effect.gen(function* () {
			const service = yield* PluginCronService;
			yield* service.dispatchDue(60_000);
			yield* (yield* PluginCatalog).load(normalizedPlugin("hot"));
			yield* service.dispatchDue(120_000);
			expect((yield* yield* DispatchedRuns).map(({ executionId }) => executionId)).toEqual([
				"plugin-cron-3-hot-8-hot-cron-120000",
			]);
		}),
	);
});

layer(gatedSelectionLayer([normalizedPlugin("fixture")]))((test) => {
	test.effect(
		"dispatches a manifest entry and script selected from one snapshot during replacement",
		() =>
			Effect.gen(function* () {
				const replacement = normalizedPlugin("fixture");
				const replacementScript = replacement.scripts[0];
				assert(replacementScript);
				const { release, selected } = yield* SelectionGate;
				const service = yield* PluginCronService;
				const fiber = yield* Effect.forkChild(service.dispatchDue(60_000));
				yield* Deferred.await(selected);
				yield* (yield* PluginCatalog).load({
					...replacement,
					scripts: [{ ...replacementScript, contentHash: "new-compiled" }],
				});
				yield* Deferred.succeed(release, undefined);
				yield* Fiber.join(fiber);
				expect((yield* yield* DispatchedRuns)[0]?.payload).toMatchObject({
					scriptId: SandboxScriptId.make("fixture-compiled-id"),
				});
			}),
	);
});

layer(
	makeLayer({
		failingExecutionId: "plugin-cron-7-missing-12-missing-cron-60000",
		plugins: [normalizedPlugin("missing"), normalizedPlugin("working")],
	}),
)((test) => {
	test.effect("isolates unavailable and failed cron dispatches", () =>
		Effect.gen(function* () {
			const service = yield* PluginCronService;
			yield* service.dispatchDue(60_000);
			expect((yield* yield* DispatchedRuns).map(({ executionId }) => executionId)).toEqual([
				"plugin-cron-7-working-12-working-cron-60000",
			]);
		}),
	);
});

it("builds stable execution ids", () => {
	expect(pluginCronExecutionId("example", "trending", 60_000)).toBe(
		"plugin-cron-7-example-8-trending-60000",
	);
	expect(pluginCronExecutionId("a", "b-c", 60_000)).not.toBe(
		pluginCronExecutionId("a-b", "c", 60_000),
	);
});

const privateCronSchedule = (installationId: string, userId: string) => ({
	installationId,
	pluginSlug: "private",
	userId: UserId.make(userId),
	pluginId: "private-plugin-id",
	cron: {
		slug: "private-cron",
		description: "Private cron",
		scriptSlug: "private-script",
		schedule: { cron: "* * * * *" },
	} satisfies PluginCron,
});

const privateCronScriptRow = (installationId: string) => ({
	providerId: null,
	source: "source",
	compiledFormat: 1,
	createdAt: testDate,
	name: "Private script",
	slug: "private-script",
	compiledCode: "compiled",
	pluginId: "private-plugin-id",
	contentHash: "private-script-hash",
	pluginRevisionId: "private-revision-id",
	id: SandboxScriptId.make(`${installationId}-script-id`),
	metadata: {
		capabilities: [],
		name: "Private script",
		slug: "private-script",
		kind: "automation" as const,
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
	},
});

const makePrivateCronLayer = (
	schedules: ReadonlyArray<ReturnType<typeof privateCronSchedule>>,
	dispatchable: ReadonlyArray<string> = schedules.map(({ installationId }) => installationId),
) =>
	PluginCronService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				makeAppConfigLayer({ scheduler: { infrequentCronJobsSchedule: "0 0 * * *" } }),
				Layer.mock(PluginRuntimeResolver)({
					listSystemCronSchedules: () => Effect.succeed([]),
					listPrivateCronSchedules: () => Effect.succeed([...schedules]),
					resolvePrivatePluginCron: ({ cronSlug, installationId }) => {
						const schedule = schedules.find(
							(candidate) =>
								candidate.cron.slug === cronSlug && candidate.installationId === installationId,
						);
						return Effect.succeed(
							schedule && dispatchable.includes(installationId)
								? {
										cron: schedule.cron,
										userId: schedule.userId,
										pluginSlug: schedule.pluginSlug,
										script: privateCronScriptRow(installationId),
									}
								: null,
						);
					},
				}),
				recordingWorkflowEngineLayer(),
			),
		),
	);

layer(
	makePrivateCronLayer([
		privateCronSchedule("installation-1", "user-1"),
		privateCronSchedule("installation-2", "user-2"),
	]),
)((test) => {
	test.effect("dispatches one private cron per installation with its owner subject", () =>
		Effect.gen(function* () {
			const service = yield* PluginCronService;
			yield* service.dispatchDue(60_000);
			expect(yield* yield* DispatchedRuns).toEqual([
				{
					executionId: "private-plugin-cron-14-installation-1-12-private-cron-60000",
					payload: {
						input: {},
						resolutionMode: "exact",
						subject: { type: "user", userId: "user-1" },
						scriptId: SandboxScriptId.make("installation-1-script-id"),
						executionId: "private-plugin-cron-14-installation-1-12-private-cron-60000",
					},
				},
				{
					executionId: "private-plugin-cron-14-installation-2-12-private-cron-60000",
					payload: {
						input: {},
						resolutionMode: "exact",
						subject: { type: "user", userId: "user-2" },
						scriptId: SandboxScriptId.make("installation-2-script-id"),
						executionId: "private-plugin-cron-14-installation-2-12-private-cron-60000",
					},
				},
			]);
		}),
	);
});

layer(makePrivateCronLayer([privateCronSchedule("installation-1", "user-1")], []))((test) => {
	test.effect("does not dispatch a private cron whose installation stopped being available", () =>
		Effect.gen(function* () {
			const service = yield* PluginCronService;
			yield* service.dispatchDue(60_000);
			expect(yield* yield* DispatchedRuns).toEqual([]);
		}),
	);
});

it("separates private and system cron execution id spaces", () => {
	expect(privatePluginCronExecutionId("install-1", "trending", 60_000)).toBe(
		"private-plugin-cron-9-install-1-8-trending-60000",
	);
	expect(privatePluginCronExecutionId("a", "b-c", 60_000)).not.toBe(
		privatePluginCronExecutionId("a-b", "c", 60_000),
	);
	expect(privatePluginCronExecutionId("example", "trending", 60_000)).not.toBe(
		pluginCronExecutionId("example", "trending", 60_000),
	);
});
