import { expect, it, layer } from "@effect/vitest";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { makeWorkflowActivityEngine } from "#lib/test-utils/effect";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { PluginCatalogInvalidator } from "./catalog-events";
import { PluginInstallationRepository } from "./installation-repository";
import {
	pluginInstallationBootstrapExecutionId,
	pluginInstallationExecutionId,
	PluginInstallationWorkflow,
	PluginInstallationWorkflowOperationsLive,
	runPluginInstallationWorkflow,
} from "./installation-workflow";
import { PluginRuntimeResolver } from "./runtime-resolver";

const userId = UserId.make("user-1");
const installationId = "installation-1";
const activationId = "activation-1";

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

type Execution = { executionId: string; scriptId: string; subject: unknown };

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
		readonly healthUpdates: Effect.Effect<ReadonlyArray<HealthUpdate>>;
		readonly resolveBootstrapWith: (bootstrap: ResolvedBootstrap) => Effect.Effect<void>;
	}
>()("test/FakeInstallationWorkflow") {}

class InstallationWorkflowFakeState extends Context.Service<
	InstallationWorkflowFakeState,
	{
		readonly bootstrap: Ref.Ref<ResolvedBootstrap>;
		readonly executions: Ref.Ref<ReadonlyArray<Execution>>;
		readonly healthUpdates: Ref.Ref<ReadonlyArray<HealthUpdate>>;
		readonly pushOrder: (entry: string) => Effect.Effect<void>;
	}
>()("test/InstallationWorkflowFakeState") {}

const workflowLayer = (input: {
	readonly bootstrap: ResolvedBootstrap;
	readonly scriptErrors?: Record<string, string>;
}) => {
	const fakes = Layer.effectContext(
		Effect.gen(function* () {
			const order = yield* Ref.make<ReadonlyArray<string>>([]);
			const executions = yield* Ref.make<ReadonlyArray<Execution>>([]);
			const healthUpdates = yield* Ref.make<ReadonlyArray<HealthUpdate>>([]);
			const bootstrap = yield* Ref.make(input.bootstrap);
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
					executions: Ref.get(executions),
					healthUpdates: Ref.get(healthUpdates),
					resolveBootstrapWith: (next) => Ref.set(bootstrap, next),
				}),
				Context.add(InstallationWorkflowFakeState, {
					bootstrap,
					pushOrder,
					executions,
					healthUpdates,
				}),
			);
		}),
	);
	const mocks = Layer.unwrap(
		Effect.map(
			InstallationWorkflowFakeState,
			({ bootstrap, pushOrder, executions, healthUpdates }) =>
				Layer.mergeAll(
					Layer.mock(PluginRuntimeResolver)({
						resolveInstallationBootstrap: () => Ref.get(bootstrap),
					}),
					Layer.mock(PluginInstallationRepository)({
						updateHealthForActivation: ({ activationId: expected, ...values }) =>
							expected === activationId
								? pushOrder(`health:${values.health}`).pipe(
										Effect.andThen(Ref.update(healthUpdates, (all) => [...all, values])),
										Effect.as(true),
									)
								: Effect.succeed(false),
						findById: () =>
							Effect.succeed({
								userId,
								config: {},
								sortOrder: 0,
								isHidden: false,
								healthReason: null,
								id: installationId,
								uninstalledAt: null,
								pluginScope: "user",
								health: "installing",
								pluginId: "plugin-1",
								pluginSlug: "fixture",
								createdAt: new Date(0),
								updatedAt: new Date(0),
								homeSavedViewSlug: null,
								activeConfigRevisionId: null,
							}),
					}),
					Layer.mock(SandboxExecutionService)({
						executeScript: (payload) => {
							const message = input.scriptErrors?.[payload.scriptId];
							const execution = {
								subject: payload.subject,
								scriptId: payload.scriptId,
								executionId: payload.executionId,
							};
							return Ref.update(executions, (all) => [...all, execution]).pipe(
								Effect.as({
									logs: [],
									value: null,
									status: "completed" as const,
									error: message
										? { message, phase: "execute" as const, kind: "script-failure" as const }
										: null,
								}),
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
			expect(yield* fake.healthUpdates).toEqual([
				{ health: "ready", healthReason: null, id: installationId },
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
	test.effect("derives the same durable execution id for an entry on every run", () =>
		Effect.gen(function* () {
			const fake = yield* FakeInstallationWorkflow;
			yield* runWorkflow;
			yield* runWorkflow;
			expect((yield* fake.executions).map(({ executionId }) => executionId)).toEqual([
				pluginInstallationBootstrapExecutionId(installationId, activationId, "first"),
				pluginInstallationBootstrapExecutionId(installationId, activationId, "second"),
				pluginInstallationBootstrapExecutionId(installationId, activationId, "first"),
				pluginInstallationBootstrapExecutionId(installationId, activationId, "second"),
			]);
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
