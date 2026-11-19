import { expect } from "bun:test";

import { KERNEL_NAMESPACE, type LocalMessage, stampTrustedNamespace } from "@ryot-app/i18n/message";
import { testKernelText } from "@ryot-app/kernel-messages/testing";
import { automationInputSchema } from "@ryot-app/plugin-backend-sdk/automation";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { recordNotifications } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Cause, Exit } from "effect";

import definition, { manifest } from "./notification.sandbox";

const renderInEnglish = (messages: ReadonlyArray<LocalMessage>) =>
	messages.map((message) =>
		String(testKernelText(stampTrustedNamespace(KERNEL_NAMESPACE, message))),
	);

const providerName = {
	namespace: KERNEL_NAMESPACE,
	key: "definition.integration-provider.data-json.name",
};

const inputFor = (executionUserId: null | string, reminder = false) =>
	Schema.decodeEffect(automationInputSchema)({
		automation: {
			runId: "run-1",
			executionUserId,
			triggerId: "trigger-1",
			hookSlug: "automation.notification",
			occurredAt: "2026-09-15T00:00:00.000Z",
			causation: {
				depth: 0,
				parentRunId: null,
				lane: "background",
				source: "integration",
				parentTriggerId: null,
				executionId: "execution-1",
				rootExecutionId: "execution-1",
				initiator: { id: "actor", kind: "user" },
			},
			payload: {
				operation: "emit",
				category: "signal",
				resource: "signal",
				actorUserId: "actor",
				signalSchemaPluginId: null,
				signalSchemaSlug: reminder ? "reminder.due" : "integration.disabled",
				properties: reminder
					? {
							entityId: "target-id",
							timezone: "Asia/Kolkata",
							message: "Read the notes_*",
							dueAt: "2026-09-15T08:30:00.000Z",
						}
					: { providerName, integrationId: "integration-1" },
			},
		},
	}).pipe(Effect.orDie);

it.effect(
	"builds a kernel message for the trusted execution recipient",
	() =>
		Effect.gen(function* () {
			const { host, messages } = recordNotifications(manifest);
			const result = yield* definition.run(yield* inputFor("recipient"), host);
			expect(result).toBeNull();
			expect(messages).toEqual([
				{ params: { provider: providerName }, key: "notification.integration-disabled" },
			]);
			expect(renderInEnglish(messages)).toEqual([
				"Integration Data webhook has been disabled due to too many errors",
			]);
		}),
	testTimeout,
);

it.effect(
	"does not use the actor as a fallback for a missing execution recipient",
	() =>
		Effect.gen(function* () {
			const { host, messages } = recordNotifications(manifest);
			const exit = yield* Effect.exit(definition.run(yield* inputFor(null), host));
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				expect(Cause.pretty(exit.cause)).toContain(
					"Signal notification requires an execution user",
				);
			}
			expect(messages).toEqual([]);
		}),
	testTimeout,
);

it.effect(
	"retains the entity reference, authored text, and zoned due time for delivery",
	() =>
		Effect.gen(function* () {
			const { host, messages } = recordNotifications(manifest);
			yield* definition.run(yield* inputFor("recipient", true), host);
			expect(messages).toEqual([
				{
					key: "notification.reminder-due",
					params: {
						timeZone: "Asia/Kolkata",
						message: "Read the notes_*",
						entityTitle: { entityId: "target-id" },
						dueAt: { timeZone: "Asia/Kolkata", date: "2026-09-15T08:30:00.000Z" },
					},
				},
			]);
		}),
	testTimeout,
);
