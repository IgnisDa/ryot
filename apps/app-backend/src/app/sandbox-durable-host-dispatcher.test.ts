import { expect, it } from "@effect/vitest";
import { SandboxScriptId, SubscriptionRunId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { SandboxHostImplementations } from "#lib/infrastructure/sandbox-runtime/host-implementations";
import { dbRunnerLayer, makeWorkflowActivityEngine } from "#lib/test-utils/effect";
import { NotificationDeliveryWorkflow } from "#modules/notifications/notification-delivery-workflow";
import {
	SandboxDurableHostServiceWorkflow,
	SandboxDurableHostDispatcher,
} from "#modules/sandbox/durable-host-dispatcher";
import { SandboxRepository } from "#modules/sandbox/repository";
import { SandboxScriptWorkflow } from "#modules/sandbox/sandbox-script-workflow";

import { SandboxDurableHostDispatcherLive } from "./sandbox-durable-host-dispatcher";

const unused = () => Effect.fail({ message: "unused" });
const implementations: SandboxHostImplementations["Service"] = {
	automation: { emitSignal: unused, sendNotification: unused },
	runtime: {
		httpCall: unused,
		getCachedValue: unused,
		setCachedValue: unused,
		claimPersistentValue: unused,
	},
	additional: {
		createEvents: unused,
		getPluginConfig: unused,
		getSystemConfig: unused,
		getEntitySchemas: unused,
		listEventSchemas: unused,
		listIntegrations: unused,
		executeQueryEngine: unused,
		getUserPreferences: unused,
		ensureUserEntities: unused,
		upsertGlobalEntities: unused,
		getCurrentIntegration: unused,
		changeUserRelationships: unused,
		upsertGlobalRelationships: unused,
	},
};

const scriptId = SandboxScriptId.make("script-1");
const script = {
	source: "",
	id: scriptId,
	providerId: null,
	compiledCode: "",
	compiledFormat: 1,
	name: "Dispatcher",
	slug: "dispatcher",
	contentHash: "hash",
	pluginSlug: "test-plugin",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	metadata: {
		name: "Dispatcher",
		slug: "dispatcher",
		kind: "automation" as const,
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
		capabilities: ["emitSignal", "sendNotification"],
	},
};

it.effect("dispatches workflow-owned capabilities through their deterministic child owners", () => {
	const executionId = "sandbox-parent";
	const instance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
	const executions: Array<{
		workflow: unknown;
		options: Parameters<WorkflowEngine["Service"]["execute"]>[1];
	}> = [];
	const engine = makeWorkflowActivityEngine(instance, {
		execute: (workflow, options) => {
			executions.push({ workflow, options });
			return Effect.succeed(
				workflow.name === SandboxDurableHostServiceWorkflow.name
					? { state: "success", value: { signalId: "signal-1", wasCreated: true } }
					: options.executionId,
			);
		},
	});
	const layer = SandboxDurableHostDispatcherLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				Layer.succeed(WorkflowEngine, engine),
				Layer.succeed(WorkflowInstance, instance),
				Layer.succeed(SandboxHostImplementations, implementations),
				Layer.mock(SandboxRepository)({ getScript: () => Effect.succeed(script) }),
			),
		),
	);
	const authority = {
		type: "subscription" as const,
		userId: UserId.make("user-1"),
		subscriptionRun: {
			origin: { kind: "api" as const },
			occurredAt: "2026-08-06T00:00:00.000Z",
			id: SubscriptionRunId.make("subscription-1"),
		},
	};
	const payload = {
		scriptId,
		authority,
		input: {},
		executionId,
		resolutionMode: "exact" as const,
		startedAt: "2026-08-06T00:00:00.000Z",
	};

	return Effect.gen(function* () {
		const dispatcher = yield* SandboxDurableHostDispatcher;
		expect(
			yield* dispatcher.dispatch(
				{
					index: 0,
					kind: "host",
					name: "emitSignal",
					args: { capability: "emitSignal", args: [] },
				},
				payload,
				executionId,
				0,
			),
		).toEqual({ state: "success", value: { signalId: "signal-1", wasCreated: true } });
		expect(
			yield* dispatcher.dispatch(
				{
					index: 1,
					kind: "host",
					name: "sendNotification",
					args: { capability: "sendNotification", args: ["Ready"] },
				},
				payload,
				executionId,
				1,
			),
		).toEqual({ state: "success", value: null });
		expect(executions).toMatchObject([
			{
				workflow: SandboxDurableHostServiceWorkflow,
				options: { executionId: "sandbox-parent-host-service-0" },
			},
			{
				workflow: NotificationDeliveryWorkflow,
				options: { executionId: "sandbox-parent-send-notification-1", discard: true },
			},
		]);
	}).pipe(
		Effect.provide(layer),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
	);
});
