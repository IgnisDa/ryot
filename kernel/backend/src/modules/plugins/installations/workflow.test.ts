import { expect, it, layer } from "@effect/vitest";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { makeUserPluginRevision } from "@ryot-app/sandbox/host/executor.test-support";
import { Context, Effect, Layer, Ref } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { mutationAdmissionTestLayer } from "#modules/mutations/admission.test-support";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";
import { makeWorkflowActivityEngine } from "#testing/effect";

import { PluginCatalogInvalidator } from "../catalog/events";
import { PluginRuntimeResolver } from "../catalog/runtime-resolver";
import { PluginInstallationRepository } from "./repository";
import {
	pluginInstallationBootstrapExecutionId,
	pluginInstallationExecutionId,
	PluginInstallationWorkflow,
	PluginInstallationWorkflowOperations,
	PluginInstallationWorkflowOperationsLive,
	runPluginInstallationWorkflow,
} from "./workflow";

const userId = UserId.make("user-1");
const installationId = "installation-1";
const activationId = "activation-1";
const initialization = { activationId, installationId };
const pluginRevision = {
	...makeUserPluginRevision({
		slug: "fixture",
		ownerId: userId,
		compiledHashes: { first: "first-hash", second: "second-hash" },
	}),
	userBootstrapScriptSlugs: ["first", "second"],
};

it("keeps lifecycle executions distinct for each installation and activation", () => {
	expect(pluginInstallationExecutionId("installation-2", activationId)).not.toBe(
		pluginInstallationExecutionId(installationId, activationId),
	);
	expect(pluginInstallationExecutionId(installationId, "replacement")).not.toBe(
		pluginInstallationExecutionId(installationId, activationId),
	);
	expect(pluginInstallationBootstrapExecutionId("installation-2", activationId, "first")).not.toBe(
		pluginInstallationBootstrapExecutionId(installationId, activationId, "first"),
	);
});

type ResolvedBootstrap = Effect.Success<
	ReturnType<PluginRuntimeResolver["Service"]["resolveInstallationBootstrap"]>
>;

type ScriptPinLookupArguments = Parameters<SandboxRepository["Service"]["getScriptPin"]>;
type ScriptPinLookup = {
	readonly scriptId: ScriptPinLookupArguments[0];
	readonly expectedRevision: ScriptPinLookupArguments[1];
	readonly subject: ScriptPinLookupArguments[2];
	readonly initialization: ScriptPinLookupArguments[3];
};
type WorkflowRegistration = Parameters<
	SandboxWorkflowReferenceRepository["Service"]["registerInTransaction"]
>[0];
type Execution = Pick<
	Parameters<ScriptExecutionService["Service"]["executeScript"]>[0],
	"executionId" | "scriptId" | "subject" | "pluginRevision" | "initialization"
>;

type HealthUpdate = Parameters<PluginInstallationRepository["Service"]["updateHealth"]>[0];

const bootstrapEntry = (slug: string) => ({ slug, scriptId: SandboxScriptId.make(`${slug}-id`) });

const resolved = (overrides: Partial<NonNullable<ResolvedBootstrap>> = {}) => ({
	userId,
	activationId,
	pluginScope: "user" as const,
	health: "installing" as const,
	entries: [bootstrapEntry("first"), bootstrapEntry("second")],
	...overrides,
});

class FakeInstallationWorkflow extends Context.Service<
	FakeInstallationWorkflow,
	{
		readonly order: Effect.Effect<ReadonlyArray<string>>;
		readonly executions: Effect.Effect<ReadonlyArray<Execution>>;
		readonly scriptPinLookups: Effect.Effect<ReadonlyArray<ScriptPinLookup>>;
		readonly registrations: Effect.Effect<ReadonlyArray<WorkflowRegistration>>;
		readonly healthUpdates: Effect.Effect<ReadonlyArray<HealthUpdate>>;
		readonly isInitialized: Effect.Effect<boolean>;
		readonly seeds: Effect.Effect<ReadonlyArray<string>>;
		readonly resolveBootstrapWith: (bootstrap: ResolvedBootstrap) => Effect.Effect<void>;
	}
>()("test/FakeInstallationWorkflow") {}

class InstallationWorkflowFakeState extends Context.Service<
	InstallationWorkflowFakeState,
	{
		readonly bootstrap: Ref.Ref<ResolvedBootstrap>;
		readonly executions: Ref.Ref<ReadonlyArray<Execution>>;
		readonly scriptPinLookups: Ref.Ref<ReadonlyArray<ScriptPinLookup>>;
		readonly registrations: Ref.Ref<ReadonlyArray<WorkflowRegistration>>;
		readonly healthUpdates: Ref.Ref<ReadonlyArray<HealthUpdate>>;
		readonly isInitialized: Ref.Ref<boolean>;
		readonly seeds: Ref.Ref<ReadonlyArray<string>>;
		readonly didQuarantine: Ref.Ref<boolean>;
		readonly pushOrder: (entry: string) => Effect.Effect<void>;
	}
>()("test/InstallationWorkflowFakeState") {}

const workflowLayer = (input: {
	readonly bootstrap: ResolvedBootstrap;
	readonly hiddenInstallation?: boolean;
	readonly scriptErrors?: Record<string, string>;
	readonly quarantineOnExecution?: boolean;
	readonly bootstrapAfterExecution?: ResolvedBootstrap;
	readonly quarantineAfterFirstSeed?: boolean;
}) => {
	const fakes = Layer.effectContext(
		Effect.gen(function* () {
			const order = yield* Ref.make<ReadonlyArray<string>>([]);
			const executions = yield* Ref.make<ReadonlyArray<Execution>>([]);
			const scriptPinLookups = yield* Ref.make<ReadonlyArray<ScriptPinLookup>>([]);
			const registrations = yield* Ref.make<ReadonlyArray<WorkflowRegistration>>([]);
			const healthUpdates = yield* Ref.make<ReadonlyArray<HealthUpdate>>([]);
			const bootstrap = yield* Ref.make(input.bootstrap);
			const isInitialized = yield* Ref.make(false);
			const seeds = yield* Ref.make<ReadonlyArray<string>>([]);
			const didQuarantine = yield* Ref.make(false);
			const pushOrder = (entry: string) => Ref.update(order, (all) => [...all, entry]);
			const instance = WorkflowInstance.initial(PluginInstallationWorkflow, installationId);
			return Context.make(WorkflowInstance, instance).pipe(
				Context.add(WorkflowEngine, makeWorkflowActivityEngine(instance)),
				Context.add(PluginCatalogInvalidator, {
					all: Effect.void,
					recordAll: Effect.void,
					recordUser: () => Effect.void,
					deliverPending: () => Effect.void,
					user: () => pushOrder("invalidate"),
				}),
				Context.add(FakeInstallationWorkflow, {
					order: Ref.get(order),
					seeds: Ref.get(seeds),
					executions: Ref.get(executions),
					registrations: Ref.get(registrations),
					healthUpdates: Ref.get(healthUpdates),
					isInitialized: Ref.get(isInitialized),
					scriptPinLookups: Ref.get(scriptPinLookups),
					resolveBootstrapWith: (next) => Ref.set(bootstrap, next),
				}),
				Context.add(InstallationWorkflowFakeState, {
					seeds,
					bootstrap,
					pushOrder,
					executions,
					registrations,
					healthUpdates,
					isInitialized,
					didQuarantine,
					scriptPinLookups,
				}),
			);
		}),
	);
	const mocks = Layer.unwrap(
		Effect.map(
			InstallationWorkflowFakeState,
			({
				seeds,
				bootstrap,
				pushOrder,
				executions,
				registrations,
				healthUpdates,
				isInitialized,
				didQuarantine,
				scriptPinLookups,
			}) =>
				Layer.mergeAll(
					Layer.mock(PluginRuntimeResolver)({
						lockCatalog: () => Effect.void,
						resolveInstallationBootstrap: () => Ref.get(bootstrap),
					}),
					Layer.mock(SandboxRepository)({
						getScriptPin: (scriptId, expectedRevision, subject, binding) =>
							Effect.gen(function* () {
								yield* Ref.update(scriptPinLookups, (lookups) => [
									...lookups,
									{ subject, scriptId, expectedRevision, initialization: binding },
								]);
								const current = yield* Ref.get(bootstrap);
								return binding?.installationId === installationId &&
									binding.activationId === current?.activationId &&
									current.health === "installing" &&
									pluginRevision.userBootstrapScriptSlugs.includes(scriptId.replace(/-id$/, ""))
									? {
											scriptId,
											pluginRevision,
											providerId: null,
											contentHash: `${scriptId}-hash`,
											scriptSlug: scriptId.replace(/-id$/, ""),
											metadata: { ...emptySandboxExecutionMetadata, kind: "script" },
										}
									: null;
							}),
					}),
					Layer.mock(SandboxWorkflowReferenceRepository)({
						registerInTransaction: (registration) =>
							Ref.update(registrations, (all) => [...all, registration]).pipe(
								Effect.as({ status: "registered" as const }),
							),
					}),
					Layer.mock(PluginInstallationRepository)({
						updateHealthForActivation: ({ activationId: expected, ...values }) =>
							Effect.flatMap(Ref.get(bootstrap), (current) =>
								current?.activationId === expected && current.health === "installing"
									? pushOrder(`health:${values.health}`).pipe(
											Effect.andThen(Ref.update(healthUpdates, (all) => [...all, values])),
											Effect.andThen(
												values.health === "ready" ? Ref.set(isInitialized, true) : Effect.void,
											),
											Effect.andThen(Ref.set(bootstrap, { ...current, health: values.health })),
											Effect.as(true),
										)
									: Effect.succeed(false),
							),
						findById: () =>
							Effect.map(Ref.get(isInitialized), (initialized) => ({
								userId,
								config: {},
								sortOrder: 0,
								userSettings: {},
								healthReason: null,
								id: installationId,
								uninstalledAt: null,
								pluginScope: "user",
								homeSavedView: null,
								health: "installing",
								pluginId: "plugin-1",
								createdAt: new Date(0),
								updatedAt: new Date(0),
								isInitialized: initialized,
								incompatibilityReason: null,
								activeConfigRevisionId: null,
								packageId: pluginRevision.packageId,
								isHidden: input.hiddenInstallation ?? false,
							})),
					}),
					Layer.mock(ScriptExecutionService)({
						releaseWorkflowRegistration: () => Effect.void,
						executeScript: (payload) => {
							const message = input.scriptErrors?.[payload.scriptId];
							const execution = {
								lane: payload.lane,
								subject: payload.subject,
								scriptId: payload.scriptId,
								...(payload.pluginRevision ? { pluginRevision: payload.pluginRevision } : {}),
								...(payload.initialization ? { initialization: payload.initialization } : {}),
								executionId: payload.executionId,
							};
							return Effect.gen(function* () {
								yield* Ref.update(executions, (all) => [...all, execution]);
								const current = yield* Ref.get(bootstrap);
								const failure =
									message ??
									(input.quarantineAfterFirstSeed && current?.health === "incompatible"
										? "Installation identity conflict"
										: undefined);
								if (!failure) {
									yield* Ref.update(seeds, (all) =>
										all.includes(payload.scriptId) ? all : [...all, payload.scriptId],
									);
								}
								if (
									input.quarantineAfterFirstSeed &&
									!(yield* Ref.getAndSet(didQuarantine, true))
								) {
									yield* Ref.set(bootstrap, resolved({ health: "incompatible" }));
								}
								return failure;
							}).pipe(
								Effect.tap(() =>
									input.quarantineOnExecution
										? Ref.set(bootstrap, resolved({ health: "incompatible" }))
										: Effect.void,
								),
								Effect.tap(() =>
									input.bootstrapAfterExecution !== undefined
										? Ref.set(bootstrap, input.bootstrapAfterExecution)
										: Effect.void,
								),
								Effect.map((failure) => ({
									logs: [],
									value: null,
									status: "completed" as const,
									error: failure
										? {
												message: failure,
												phase: "execute" as const,
												kind: "script-failure" as const,
											}
										: null,
								})),
							);
						},
					}),
				),
		),
	);
	return PluginInstallationWorkflowOperationsLive.pipe(
		Layer.provide(mocks),
		Layer.provideMerge(fakes),
		Layer.provideMerge(mutationAdmissionTestLayer),
	);
};

const runWorkflow = runPluginInstallationWorkflow({ activationId, installationId }, "execution-1");

layer(workflowLayer({ bootstrap: resolved() }))((test) => {
	test.effect("runs bootstrap entries in declared order with owner subject and stable ids", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationWorkflow;
			yield* runWorkflow;
			expect(yield* fake.order).toEqual(["health:ready", "invalidate"]);
			expect(yield* fake.executions).toEqual([
				{
					pluginRevision,
					initialization,
					lane: "background",
					scriptId: "first-id",
					executionId: pluginInstallationBootstrapExecutionId(
						installationId,
						activationId,
						"first",
					),
					subject: {
						userId,
						type: "user",
						accountGeneration: { userId, token: "test-account-generation" },
					},
				},
				{
					pluginRevision,
					initialization,
					lane: "background",
					scriptId: "second-id",
					executionId: pluginInstallationBootstrapExecutionId(
						installationId,
						activationId,
						"second",
					),
					subject: {
						userId,
						type: "user",
						accountGeneration: { userId, token: "test-account-generation" },
					},
				},
			]);
			expect(yield* fake.scriptPinLookups).toEqual([
				{
					initialization,
					expectedRevision: undefined,
					scriptId: SandboxScriptId.make("first-id"),
					subject: {
						userId,
						type: "user",
						accountGeneration: { userId, token: "test-account-generation" },
					},
				},
				{
					initialization,
					expectedRevision: undefined,
					scriptId: SandboxScriptId.make("second-id"),
					subject: {
						userId,
						type: "user",
						accountGeneration: { userId, token: "test-account-generation" },
					},
				},
			]);
			expect(yield* fake.registrations).toEqual([
				{
					userId,
					initialization,
					pluginId: pluginRevision.id,
					contentHash: "first-id-hash",
					expectedRevision: pluginRevision,
					scriptId: SandboxScriptId.make("first-id"),
					executionId: pluginInstallationBootstrapExecutionId(
						installationId,
						activationId,
						"first",
					),
				},
				{
					userId,
					initialization,
					pluginId: pluginRevision.id,
					contentHash: "second-id-hash",
					expectedRevision: pluginRevision,
					scriptId: SandboxScriptId.make("second-id"),
					executionId: pluginInstallationBootstrapExecutionId(
						installationId,
						activationId,
						"second",
					),
				},
			]);
			expect(yield* fake.healthUpdates).toEqual([
				{ health: "ready", healthReason: null, id: installationId },
			]);
		}),
	);
});

layer(workflowLayer({ bootstrap: resolved({ activationId: "replacement" }) }))((test) => {
	test.effect("does not register bootstrap pins for a stale activation", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationWorkflow;
			yield* runWorkflow;
			expect(yield* fake.scriptPinLookups).toEqual([]);
			expect(yield* fake.registrations).toEqual([]);
			expect(yield* fake.executions).toEqual([]);
		}),
	);
});

layer(
	workflowLayer({
		hiddenInstallation: true,
		bootstrap: resolved({ entries: [bootstrapEntry("ordinary")] }),
	}),
)((test) => {
	test.effect("does not register a hidden installation's non-bootstrap script", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationWorkflow;
			yield* runWorkflow;
			const scriptPinLookups = yield* fake.scriptPinLookups;
			expect(scriptPinLookups.map(({ scriptId }) => scriptId)).toEqual(
				scriptPinLookups.map(() => SandboxScriptId.make("ordinary-id")),
			);
			expect(
				scriptPinLookups.map(({ initialization: lookupInitialization }) => lookupInitialization),
			).toEqual(scriptPinLookups.map(() => initialization));
			expect(yield* fake.registrations).toEqual([]);
			expect(yield* fake.executions).toEqual([]);
		}),
	);
});

layer(workflowLayer({ bootstrap: resolved(), quarantineOnExecution: true }))((test) => {
	test.effect(
		"does not mark a quarantined installation ready after an admitted bootstrap finishes",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationWorkflow;
				yield* runWorkflow;
				expect(yield* fake.healthUpdates).toEqual([]);
			}),
	);
});

layer(
	workflowLayer({
		bootstrap: resolved(),
		bootstrapAfterExecution: resolved({
			entries: [bootstrapEntry("new-first"), bootstrapEntry("new-second")],
		}),
	}),
)((test) => {
	test.effect(
		"keeps admitted bootstrap pins while a compatible revision changes the current declarations",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationWorkflow;
				yield* runWorkflow;
				expect(
					(yield* fake.executions).map(({ scriptId, pluginRevision: pin }) => ({
						scriptId,
						revisionId: pin?.revisionId,
						configRevisionId: pin?.configRevisionId,
					})),
				).toEqual([
					{
						scriptId: "first-id",
						revisionId: pluginRevision.revisionId,
						configRevisionId: pluginRevision.configRevisionId,
					},
					{
						scriptId: "second-id",
						revisionId: pluginRevision.revisionId,
						configRevisionId: pluginRevision.configRevisionId,
					},
				]);
				expect(yield* fake.healthUpdates).toEqual([
					{ health: "ready", healthReason: null, id: installationId },
				]);
			}),
	);
});

layer(
	workflowLayer({
		bootstrap: resolved(),
		quarantineOnExecution: true,
		scriptErrors: { "first-id": "installation unavailable" },
	}),
)((test) => {
	test.effect(
		"does not replace quarantine with failed health when admitted bootstrap execution fails",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationWorkflow;
				yield* runWorkflow;
				expect(yield* fake.healthUpdates).toEqual([]);
				expect((yield* fake.executions).map(({ scriptId }) => scriptId)).toEqual(["first-id"]);
			}),
	);
});

layer(workflowLayer({ bootstrap: resolved(), quarantineAfterFirstSeed: true }))((test) => {
	test.effect(
		"recovers partial initialization through the existing workflow without duplicating completed seeds",
		() =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationWorkflow;
				const operations = yield* PluginInstallationWorkflowOperations;
				yield* runWorkflow;
				expect(yield* fake.seeds).toEqual(["first-id"]);
				expect(yield* fake.isInitialized).toBe(false);
				const recoveredActivation = "recovered-activation";
				yield* fake.resolveBootstrapWith(resolved({ activationId: recoveredActivation }));
				yield* operations.complete(installationId, activationId, userId);
				yield* operations.fail(installationId, activationId, "late old failure");
				expect(yield* fake.isInitialized).toBe(false);
				expect(yield* fake.healthUpdates).toEqual([]);
				const executionId = pluginInstallationExecutionId(installationId, recoveredActivation);
				const instance = WorkflowInstance.initial(PluginInstallationWorkflow, executionId);
				yield* runPluginInstallationWorkflow(
					{ installationId, activationId: recoveredActivation },
					executionId,
				).pipe(
					Effect.provideService(WorkflowInstance, instance),
					Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
				);
				expect(yield* fake.seeds).toEqual(["first-id", "second-id"]);
				expect(yield* fake.isInitialized).toBe(true);
				expect((yield* fake.executions).map(({ executionId: id }) => id)).toEqual([
					pluginInstallationBootstrapExecutionId(installationId, activationId, "first"),
					pluginInstallationBootstrapExecutionId(installationId, activationId, "second"),
					pluginInstallationBootstrapExecutionId(installationId, recoveredActivation, "first"),
					pluginInstallationBootstrapExecutionId(installationId, recoveredActivation, "second"),
				]);
			}),
	);
});

layer(workflowLayer({ bootstrap: null }))((test) => {
	test.effect("does nothing for a missing or settled installation", () => {
		const cases = [null, resolved({ health: "ready" }), resolved({ activationId: "replacement" })];
		return Effect.gen(function* () {
			const fake = yield* FakeInstallationWorkflow;
			yield* Effect.forEach(cases, (bootstrap) =>
				Effect.gen(function* () {
					yield* fake.resolveBootstrapWith(bootstrap);
					yield* runWorkflow;
					expect(yield* fake.executions).toEqual([]);
					expect(yield* fake.healthUpdates).toEqual([]);
				}),
			);
		});
	});
});

layer(workflowLayer({ bootstrap: resolved() }))((test) => {
	test.effect("does not rerun initialization after guarded completion", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationWorkflow;
			yield* runWorkflow;
			yield* runWorkflow;
			expect((yield* fake.executions).map(({ executionId }) => executionId)).toEqual([
				pluginInstallationBootstrapExecutionId(installationId, activationId, "first"),
				pluginInstallationBootstrapExecutionId(installationId, activationId, "second"),
			]);
			expect(yield* fake.isInitialized).toBe(true);
		}),
	);
});

layer(workflowLayer({ bootstrap: resolved({ entries: [{ slug: "first", scriptId: null }] }) }))(
	(test) => {
		test.effect("fails the installation when a bootstrap entry has no compiled script", () =>
			Effect.gen(function* () {
				const fake = yield* FakeInstallationWorkflow;
				yield* runWorkflow;
				expect(yield* fake.executions).toEqual([]);
				expect(yield* fake.healthUpdates).toEqual([
					{
						health: "failed",
						id: installationId,
						healthReason: "Plugin installation could not be started",
					},
				]);
			}),
		);
	},
);

layer(
	workflowLayer({
		bootstrap: resolved(),
		scriptErrors: { "first-id": "TypeError at scripts/bootstrap.sandbox.ts:12" },
	}),
)((test) => {
	test.effect("fails the installation with a safe reason and skips later entries", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationWorkflow;
			yield* runWorkflow;
			expect((yield* fake.executions).map(({ scriptId }) => scriptId)).toEqual(["first-id"]);
			const healthUpdates = yield* fake.healthUpdates;
			expect(healthUpdates).toEqual([
				{
					health: "failed",
					id: installationId,
					healthReason: "Plugin installation bootstrap failed: first",
				},
			]);
			expect(String(healthUpdates[0]?.healthReason)).not.toContain("TypeError");
			expect(String(healthUpdates[0]?.healthReason)).not.toContain("bootstrap.sandbox.ts");
		}),
	);
});
