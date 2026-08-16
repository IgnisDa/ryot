import { expect, it } from "@effect/vitest";
import { SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { databaseLayer, makeWorkflowActivityEngine } from "#lib/test-utils/effect";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { PluginInstallationRepository } from "./installation-repository";
import {
	pluginInstallationBootstrapExecutionId,
	PluginInstallationWorkflow,
	PluginInstallationWorkflowOperationsLive,
	runPluginInstallationWorkflow,
} from "./installation-workflow";
import { PluginRuntimeResolver } from "./runtime-resolver";

const userId = UserId.make("user-1");
const installationId = "installation-1";

type ResolvedBootstrap = Effect.Success<
	ReturnType<PluginRuntimeResolver["Service"]["resolvePrivateInstallationBootstrap"]>
>;

type Execution = { executionId: string; scriptId: string; authority: unknown };

type HealthUpdate = Parameters<PluginInstallationRepository["Service"]["updateHealth"]>[0];

const bootstrapEntry = (slug: string) => ({ slug, scriptId: SandboxScriptId.make(`${slug}-id`) });

const resolved = (overrides: Partial<NonNullable<ResolvedBootstrap>> = {}) => ({
	userId,
	pluginScope: "user" as const,
	health: "installing" as const,
	entries: [bootstrapEntry("first"), bootstrapEntry("second")],
	...overrides,
});

const runWorkflow = (input: {
	readonly executions: Array<Execution>;
	readonly bootstrap: ResolvedBootstrap;
	readonly healthUpdates: Array<HealthUpdate>;
	readonly scriptErrors?: Record<string, string>;
}) => {
	const instance = WorkflowInstance.initial(PluginInstallationWorkflow, installationId);
	const engine = makeWorkflowActivityEngine(instance);
	const layer = PluginInstallationWorkflowOperationsLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				databaseLayer,
				Layer.mock(PluginRuntimeResolver)({
					resolvePrivateInstallationBootstrap: () => Effect.succeed(input.bootstrap),
				}),
				Layer.mock(PluginInstallationRepository)({
					updateHealth: (values) => Effect.sync(() => void input.healthUpdates.push(values)),
				}),
				Layer.mock(SandboxExecutionService)({
					executeScript: (payload) =>
						Effect.sync(() => {
							input.executions.push({
								scriptId: payload.scriptId,
								authority: payload.authority,
								executionId: payload.executionId,
							});
							const message = input.scriptErrors?.[payload.scriptId];
							return {
								logs: [],
								value: null,
								status: "completed" as const,
								error: message ? { message, phase: "execute" as const } : null,
							};
						}),
				}),
			),
		),
	);
	return runPluginInstallationWorkflow({ installationId }, "execution-1").pipe(
		Effect.provide(
			Layer.mergeAll(
				layer,
				Layer.succeed(WorkflowInstance, instance),
				Layer.succeed(WorkflowEngine, engine),
			),
		),
	);
};

it.effect("runs bootstrap entries in declared order with owner authority and stable ids", () => {
	const executions: Array<Execution> = [];
	const healthUpdates: Array<HealthUpdate> = [];
	return Effect.gen(function* () {
		yield* runWorkflow({ executions, healthUpdates, bootstrap: resolved() });
		expect(executions).toEqual([
			{
				scriptId: "first-id",
				authority: { type: "user", userId },
				executionId: pluginInstallationBootstrapExecutionId(installationId, "first"),
			},
			{
				scriptId: "second-id",
				authority: { type: "user", userId },
				executionId: pluginInstallationBootstrapExecutionId(installationId, "second"),
			},
		]);
		expect(healthUpdates).toEqual([{ health: "ready", healthReason: null, id: installationId }]);
	});
});

it.effect("does nothing for a missing, settled, or system installation", () => {
	const cases = [null, resolved({ health: "ready" }), resolved({ pluginScope: "system" })];
	return Effect.forEach(cases, (bootstrap) =>
		Effect.gen(function* () {
			const executions: Array<Execution> = [];
			const healthUpdates: Array<HealthUpdate> = [];
			yield* runWorkflow({ bootstrap, executions, healthUpdates });
			expect(executions).toEqual([]);
			expect(healthUpdates).toEqual([]);
		}),
	);
});

it.effect("derives the same durable execution id for an entry on every run", () => {
	const executions: Array<Execution> = [];
	const healthUpdates: Array<HealthUpdate> = [];
	return Effect.gen(function* () {
		yield* runWorkflow({ executions, healthUpdates, bootstrap: resolved() });
		yield* runWorkflow({ executions, healthUpdates, bootstrap: resolved() });
		expect(executions.map(({ executionId }) => executionId)).toEqual([
			pluginInstallationBootstrapExecutionId(installationId, "first"),
			pluginInstallationBootstrapExecutionId(installationId, "second"),
			pluginInstallationBootstrapExecutionId(installationId, "first"),
			pluginInstallationBootstrapExecutionId(installationId, "second"),
		]);
	});
});

it.effect("fails the installation when a bootstrap entry has no compiled script", () => {
	const executions: Array<Execution> = [];
	const healthUpdates: Array<HealthUpdate> = [];
	return Effect.gen(function* () {
		yield* runWorkflow({
			executions,
			healthUpdates,
			bootstrap: resolved({ entries: [{ slug: "first", scriptId: null }] }),
		});
		expect(executions).toEqual([]);
		expect(healthUpdates).toEqual([
			{
				health: "failed",
				id: installationId,
				healthReason: "Plugin installation could not be started",
			},
		]);
	});
});

it.effect("fails the installation with a safe reason and skips later entries", () => {
	const executions: Array<Execution> = [];
	const healthUpdates: Array<HealthUpdate> = [];
	return Effect.gen(function* () {
		yield* runWorkflow({
			executions,
			healthUpdates,
			bootstrap: resolved(),
			scriptErrors: { "first-id": "TypeError at scripts/bootstrap.sandbox.ts:12" },
		});
		expect(executions.map(({ scriptId }) => scriptId)).toEqual(["first-id"]);
		expect(healthUpdates).toEqual([
			{
				health: "failed",
				id: installationId,
				healthReason: "Plugin installation bootstrap failed: first",
			},
		]);
		expect(String(healthUpdates[0]?.healthReason)).not.toContain("TypeError");
		expect(String(healthUpdates[0]?.healthReason)).not.toContain("bootstrap.sandbox.ts");
	});
});
