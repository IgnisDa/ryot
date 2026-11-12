import { expect } from "bun:test";

import { BunServices } from "@effect/platform-bun";
import type { AssistantMessage } from "@ryot-app/contract/modules/assistant/schemas";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { authoringTools } from "#modules/agent-tools/authoring";

import { assistantContext, assistantContextByteBudget } from "./context";
import { assistantModelRequestByteBudget, assistantProviderPrompt } from "./provider-model";
import { loadAssistantSdkReference } from "./sdk-reference";

it.layer(BunServices.layer)("assistant SDK prompt budget", (test) =>
	test.effect(
		"fits the complete generated SDK reference and tools while bounding history by actual request bytes",
		() =>
			Effect.gen(function* () {
				const reference = yield* loadAssistantSdkReference;
				const requestBytes = (
					messages: readonly Pick<AssistantMessage, "role" | "parts">[],
					tools = authoringTools,
				) =>
					new TextEncoder().encode(
						stableStringify([assistantProviderPrompt(reference, messages), tools]),
					).byteLength;
				expect(reference).toContain("## @ryot-app/plugin-client-sdk/react");
				expect(reference).toContain("## @ryot-app/plugin-ui-sdk/charts");
				expect(requestBytes([])).toBeLessThan(assistantModelRequestByteBudget);
				const tools = [
					...authoringTools,
					{
						input: {},
						output: {},
						name: "large_descriptor",
						description: "x".repeat(250_000),
						source: { kind: "authoring" as const },
						hints: { readOnly: true, idempotent: true, destructive: false },
					},
				];
				const history = [
					{ role: "user" as const, parts: [{ kind: "text" as const, text: "x".repeat(450_000) }] },
					{ role: "user" as const, parts: [{ kind: "text" as const, text: "x".repeat(16_000) }] },
				];
				expect(requestBytes(history, tools)).toBeGreaterThan(assistantModelRequestByteBudget);
				const selected = assistantContext(
					history,
					assistantContextByteBudget,
					(messages) => requestBytes(messages, tools) <= assistantModelRequestByteBudget,
				);
				expect(selected).toEqual(history.slice(-1));
				expect(requestBytes(selected, tools)).toBeLessThanOrEqual(assistantModelRequestByteBudget);
				const prompt = assistantProviderPrompt(reference, selected);
				expect(prompt.content.find((message) => message.role === "system")?.content).toBe(
					reference,
				);
			}),
		{ timeout: 180_000 },
	),
);
