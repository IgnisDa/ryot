import { expect } from "bun:test";

import { KERNEL_NAMESPACE, type LocalMessage, stampTrustedNamespace } from "@ryot-app/i18n/message";
import { testKernelText } from "@ryot-app/kernel-messages/testing";
import type { automationInputSchema } from "@ryot-app/plugin-backend-sdk/automation";
import type { Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { signalAutomationInput } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Cause, Exit } from "effect";

import definition from "./notification.sandbox";

const notifications = (input: Schema.Schema.Type<typeof automationInputSchema>) =>
	Effect.map(
		definition.run(input),
		(result): ReadonlyArray<LocalMessage> => result.changes.notifications,
	);

const renderInEnglish = (messages: ReadonlyArray<LocalMessage>) =>
	messages.map((message) =>
		String(testKernelText(stampTrustedNamespace(KERNEL_NAMESPACE, message))),
	);

const providerName = {
	namespace: KERNEL_NAMESPACE,
	key: "definition.integration-provider.data-json.name",
};

const inputFor = (executionUserId: null | string, reminder = false) =>
	signalAutomationInput({
		executionUserId,
		actorUserId: "actor",
		hookSlug: "automation.notification",
		signalSchemaSlug: reminder ? "reminder.due" : "integration.disabled",
		properties: reminder
			? {
					entityId: "target-id",
					timezone: "Asia/Kolkata",
					message: "Read the notes_*",
					dueAt: "2026-09-15T08:30:00.000Z",
				}
			: { providerName, integrationId: "integration-1" },
	});

it.effect(
	"builds a kernel message for the trusted execution recipient",
	() =>
		Effect.gen(function* () {
			const messages = yield* notifications(yield* inputFor("recipient"));
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
			const exit = yield* Effect.exit(notifications(yield* inputFor(null)));
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				expect(Cause.pretty(exit.cause)).toContain(
					"Signal notification requires an execution user",
				);
			}
		}),
	testTimeout,
);

it.effect(
	"retains the entity reference, authored text, and zoned due time for delivery",
	() =>
		Effect.gen(function* () {
			const messages = yield* notifications(yield* inputFor("recipient", true));
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
