import { expect, it } from "@effect/vitest";
import {
	AutomationExecutionId,
	AutomationRunId,
	AutomationTriggerId,
	ImportRunId,
	IntegrationId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

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
		},
	},
});

it.effect("derives a child lifecycle command from the trusted automation run", () => {
	let captured: LifecycleCommand | undefined;
	const signals = Layer.mock(SignalEmissionService, {
		emitSignal: (input) => {
			captured = input.command;
			return Effect.succeed({
				warnings: [],
				wasCreated: true,
				triggerId: AutomationTriggerId.make("signal-trigger"),
			});
		},
	});
	return Effect.gen(function* () {
		const host = yield* makeAutomationSandboxApiFunctions;
		expect(
			yield* host.emitSignal(runInput(), {
				discriminator: "part-1",
				schemaSlug: "review.created",
				properties: { title: "Dune" },
			}),
		).toEqual({ wasCreated: true, triggerId: "signal-trigger" });
		expect(captured).toEqual({
			occurredAt,
			itemIdentity: "emitSignal:part-1",
			causation: {
				...causation,
				depth: 3,
				parentRunId: runId,
				source: "automation",
				parentTriggerId: triggerId,
				executionId: "run-1-host-4",
			},
		});
	}).pipe(
		Effect.provide(Layer.mergeAll(databaseLayer, signals, Layer.mock(NotificationsService)({}))),
	);
});

it.effect("uses one logical-run and host-index notification identity across attempts", () => {
	const deliveries: unknown[] = [];
	const notifications = Layer.mock(NotificationsService, {
		sendMessage: (input) => {
			deliveries.push(input);
			return Effect.as(Effect.void, undefined);
		},
	});
	return Effect.gen(function* () {
		const host = yield* makeAutomationSandboxApiFunctions;
		expect(yield* host.sendNotification(runInput(), "Ready")).toBeNull();
		expect(yield* host.sendNotification(runInput(), "Ready")).toBeNull();
		expect(deliveries).toEqual([
			{ userId, message: "Ready", executionId: "run-1-host-4-notification" },
			{ userId, message: "Ready", executionId: "run-1-host-4-notification" },
		]);
	}).pipe(
		Effect.provide(
			Layer.mergeAll(databaseLayer, notifications, Layer.mock(SignalEmissionService)({})),
		),
	);
});

it.effect("rejects notifications without an automation-run user", () =>
	Effect.gen(function* () {
		const host = yield* makeAutomationSandboxApiFunctions;
		const error = yield* Effect.flip(host.sendNotification(runInput(null), "Ready"));
		expect(error.message).toBe("sendNotification is available only to user automation runs");
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				databaseLayer,
				Layer.mock(NotificationsService)({}),
				Layer.mock(SignalEmissionService)({}),
			),
		),
	),
);
