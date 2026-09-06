import { expect, layer } from "@effect/vitest";
import {
	AutomationExecutionId,
	AutomationRunId,
	AutomationTriggerId,
	ImportRunId,
	IntegrationId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import type { LifecycleCommand } from "#lib/domain/lifecycle-command";
import type { SandboxRunInput } from "#lib/infrastructure/sandbox-runtime/shared";
import { databaseLayer } from "#lib/test-utils/effect";
import { SignalEmissionService } from "#modules/automations/signal-service";
import { NotificationsService } from "#modules/notifications/service";

import { makeAutomationSandboxApiFunctions } from "./automation-host-functions";

const userId = UserId.make("user-1");
const runId = AutomationRunId.make("run-1");
const triggerId = AutomationTriggerId.make("trigger-1");
const occurredAt = "2026-07-20T10:00:00.000Z";
const causation = {
	depth: 2,
	source: "integration" as const,
	importRunId: ImportRunId.make("import-1"),
	parentRunId: AutomationRunId.make("parent-run"),
	integrationId: IntegrationId.make("integration-1"),
	parentTriggerId: AutomationTriggerId.make("parent-trigger"),
	executionId: AutomationExecutionId.make("parent-execution"),
	rootExecutionId: AutomationExecutionId.make("root-execution"),
	providerExecutionId: AutomationExecutionId.make("provider-execution"),
	initiator: { kind: "integration" as const, id: IntegrationId.make("integration-1") },
};

const runInput = (executionUserId: UserId | null = userId): SandboxRunInput => ({
	compiledCode: "",
	compiledFormat: 1,
	hostCallDiscriminator: 4,
	startedAt: "2026-07-20T10:00:01.000Z",
	executionId: "attempt-2-sandbox-host-4",
	workflowExecutionId: "attempt-2-sandbox",
	context: {
		automation: {
			runId,
			causation,
			triggerId,
			occurredAt,
			executionUserId,
			hookSlug: "review-created",
			payload: {
				operation: "emit",
				resource: "signal",
				category: "signal",
				signalSchemaPluginId: null,
				actorUserId: executionUserId,
				properties: { title: "Dune" },
				signalSchemaSlug: "review.created",
			},
		},
	},
	principal: {
		providerId: null,
		contentHash: "hash",
		pluginRevision: null,
		scriptSlug: "review-created",
		scriptId: SandboxScriptId.make("script-1"),
		metadata: { kind: "automation", capabilities: ["emitSignal", "sendNotification"] },
		subject: {
			runId,
			causation,
			triggerId,
			stage: "after",
			pluginId: null,
			executionUserId,
			type: "automation-run",
			pluginRevisionId: null,
			pluginConfigRevisionId: null,
			accountGeneration:
				executionUserId === null
					? null
					: { userId: executionUserId, token: "test-account-generation" },
		},
	},
});

type NotificationDelivery = Parameters<NotificationsService["Service"]["sendMessage"]>[0];

class AutomationHostCalls extends Context.Service<
	AutomationHostCalls,
	{
		readonly signalCommands: Effect.Effect<ReadonlyArray<LifecycleCommand>>;
		readonly notificationDeliveries: Effect.Effect<ReadonlyArray<NotificationDelivery>>;
	}
>()("test/AutomationHostCalls") {}

const automationHostLayer = Layer.unwrap(
	Effect.gen(function* () {
		const signalCommands = yield* Ref.make<ReadonlyArray<LifecycleCommand>>([]);
		const notificationDeliveries = yield* Ref.make<ReadonlyArray<NotificationDelivery>>([]);
		return Layer.mergeAll(
			databaseLayer,
			Layer.succeed(AutomationHostCalls, {
				signalCommands: Ref.get(signalCommands),
				notificationDeliveries: Ref.get(notificationDeliveries),
			}),
			Layer.mock(SignalEmissionService, {
				emitSignal: (input) =>
					Ref.update(signalCommands, (all) => [...all, input.command]).pipe(
						Effect.as({
							warnings: [],
							wasCreated: true,
							triggerId: AutomationTriggerId.make("signal-trigger"),
						}),
					),
			}),
			Layer.mock(NotificationsService, {
				sendMessage: (input) =>
					Ref.update(notificationDeliveries, (all) => [...all, input]).pipe(Effect.as(undefined)),
			}),
		);
	}),
);

layer(automationHostLayer)((test) => {
	test.effect("derives a child lifecycle command from the trusted automation run", () =>
		Effect.gen(function* () {
			const host = yield* makeAutomationSandboxApiFunctions;
			expect(
				yield* host.emitSignal(runInput(), {
					discriminator: "part-1",
					schemaSlug: "review.created",
					properties: { title: "Dune" },
				}),
			).toEqual({ wasCreated: true, triggerId: "signal-trigger" });
			expect(yield* (yield* AutomationHostCalls).signalCommands).toEqual([
				{
					occurredAt,
					itemIdentity: "emitSignal:part-1",
					accountGeneration: { userId, token: "test-account-generation" },
					causation: {
						...causation,
						depth: 3,
						parentRunId: runId,
						source: "automation",
						parentTriggerId: triggerId,
						executionId: "run-1-host-4",
					},
				},
			]);
		}),
	);
});

layer(automationHostLayer)((test) => {
	test.effect("uses one logical-run and host-index notification identity across attempts", () =>
		Effect.gen(function* () {
			const host = yield* makeAutomationSandboxApiFunctions;
			expect(yield* host.sendNotification(runInput(), "Ready")).toBeNull();
			expect(yield* host.sendNotification(runInput(), "Ready")).toBeNull();
			expect(yield* (yield* AutomationHostCalls).notificationDeliveries).toEqual([
				{ userId, message: "Ready", executionId: "run-1-host-4-notification" },
				{ userId, message: "Ready", executionId: "run-1-host-4-notification" },
			]);
		}),
	);
});

layer(automationHostLayer)((test) => {
	test.effect("rejects notifications without an automation-run user", () =>
		Effect.gen(function* () {
			const host = yield* makeAutomationSandboxApiFunctions;
			const error = yield* Effect.flip(host.sendNotification(runInput(null), "Ready"));
			expect(error.message).toBe("sendNotification is available only to user automation runs");
		}),
	);
});
