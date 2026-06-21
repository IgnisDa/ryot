import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { SANDBOX_LIMITS } from "./limits";
import { readSandboxBridgeRequestBody, sandboxBridgeResultResponse } from "./runtime";

const decodeBody = Schema.decode(Schema.parseJson(Schema.Unknown));
const request = (body: string) =>
	new Request("http://127.0.0.1/rpc/execution/function", { method: "POST", body });

describe("sandbox bridge body limits", () => {
	it("accepts ASCII and multi-byte request bodies at the UTF-8 boundary", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const ascii = "a".repeat(SANDBOX_LIMITS.bridge.requestBytes);
				expect(yield* readSandboxBridgeRequestBody(request(ascii))).toEqual({
					body: ascii,
					oversized: false,
				});

				const multiByte = "🙂".repeat(SANDBOX_LIMITS.bridge.requestBytes / 4);
				expect(yield* readSandboxBridgeRequestBody(request(multiByte))).toEqual({
					body: multiByte,
					oversized: false,
				});
			}),
		));

	it("rejects an oversized request while reading and replaces an oversized response", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				expect(
					yield* readSandboxBridgeRequestBody(
						request("🙂".repeat(SANDBOX_LIMITS.bridge.requestBytes / 4 + 1)),
					),
				).toEqual({ body: "", oversized: true });

				const response = yield* sandboxBridgeResultResponse(
					"a".repeat(SANDBOX_LIMITS.bridge.responseBytes),
				);
				const body = yield* decodeBody(yield* Effect.promise(() => response.text()));
				expect(body).toEqual({
					result: {
						success: false,
						error: `Sandbox bridge response exceeds ${SANDBOX_LIMITS.bridge.responseBytes} UTF-8 bytes`,
					},
				});
			}),
		));
});
