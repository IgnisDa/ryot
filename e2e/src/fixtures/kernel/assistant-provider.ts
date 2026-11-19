import type { JsonValue } from "@ryot-app/contract/schema/json";
import { randomUuid } from "@ryot-app/testing/random";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect } from "effect";
import type { SecureRandom } from "effect/crypto";

import { startFakeHttpServerScoped } from "~/support/fake-http-server";

export type AssistantProviderReply =
	{ readonly text: string } | { readonly name: string; readonly arguments: JsonValue };

export const startAssistantProvider = <E, R>(
	reply: () => Effect.Effect<AssistantProviderReply, E, R>,
) =>
	Effect.gen(function* () {
		const context = yield* Effect.context<R | SecureRandom.SecureRandom>();
		return yield* startFakeHttpServerScoped((url) =>
			Effect.gen(function* () {
				if (url.pathname !== "/v1/chat/completions") {
					return new Response(null, { status: 404 });
				}
				const next = yield* reply().pipe(Effect.orDie);
				const callId = yield* randomUuid;
				const tool = "name" in next;
				const argumentsJson = tool ? stableStringify(next.arguments) : "";
				const split = Math.floor(argumentsJson.length / 2);
				const delta = tool
					? {
							tool_calls: [
								{
									index: 0,
									id: callId,
									type: "function",
									function: { name: next.name, arguments: argumentsJson.slice(0, split) },
								},
							],
						}
					: { content: next.text };

				const continuation = tool
					? chunk(
							{ tool_calls: [{ index: 0, function: { arguments: argumentsJson.slice(split) } }] },
							null,
						)
					: "";
				return new Response(
					`${chunk(delta, null)}${continuation}${chunk({}, tool ? "tool_calls" : "stop")}data: [DONE]\n\n`,
					{ headers: { "content-type": "text/event-stream" } },
				);
			}).pipe(Effect.provide(context)),
		);
	});

const chunk = (value: unknown, finish: null | string) =>
	`data: ${stableStringify({ created: 1, model: "local", id: "local-response", object: "chat.completion.chunk", choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`;
