import { expect, layer } from "@effect/vitest";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { hostSuccess } from "@ryot-app/sandbox-sdk/wire";
import { Effect, Schema } from "effect";

import { hostCallArgs } from "./host-call-args.test-support";
import { SandboxHostCallGate } from "./host-call-gate";
import { SANDBOX_LIMITS } from "./limits";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

layer(SandboxHostCallGate.layer)((test) => {
	test.effect("enforces exact ASCII and multi-byte JSON request and response byte boundaries", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const gate = yield* SandboxHostCallGate;
				const parentSpan = yield* Effect.currentSpan;
				let calls = 0;
				let response = "";
				const registration = yield* gate.register({
					parentSpan,
					generation: 1,
					handle: "boundary",
					instance: "system/core",
					apiFunctions: {
						getCachedValue: () =>
							Effect.sync(() => {
								calls++;
								return hostSuccess(response);
							}),
					},
					files: {
						harvest: () => Effect.succeed(null),
						scratchWrite: () => Effect.succeed(null),
						filesystem: { scratch: false, artifact: false, namedArtifacts: [] },
						artifactReadRange: (args) => Effect.succeed({ size: 0, data: "", offset: args.offset }),
					},
					input: {
						context: {},
						compiledCode: "",
						compiledFormat: 1,
						executionId: "boundary",
						principal: {
							contentHash: "",
							providerId: null,
							pluginRevision: null,
							scriptSlug: "boundary",
							subject: { type: "system" },
							scriptId: SandboxScriptId.make("boundary"),
							metadata: { runtimeImports: [], capabilities: ["getCachedValue"] },
						},
					},
				});
				let seq = 0;
				for (const character of ["a", "🙂"]) {
					const width = new TextEncoder().encode(character).byteLength;
					const requestBytes =
						SANDBOX_LIMITS.bridge.requestBytes -
						new TextEncoder().encode(encodeJson({ args: [""] })).byteLength;
					const request =
						character.repeat(Math.floor(requestBytes / width)) + "a".repeat(requestBytes % width);
					const responseBytes =
						SANDBOX_LIMITS.bridge.responseBytes -
						new TextEncoder().encode(encodeJson(hostSuccess(""))).byteLength;
					response =
						character.repeat(Math.floor(responseBytes / width)) + "a".repeat(responseBytes % width);
					const dispatch = (value: string) =>
						registration.dispatch({
							seq: seq++,
							generation: 1,
							type: "hostCall",
							handle: "boundary",
							name: "getCachedValue",
							args: hostCallArgs([value]),
						});
					expect((yield* dispatch(request)).result).toEqual({
						status: "success",
						value: hostSuccess(response),
					});
					const before = calls;
					expect((yield* dispatch(request + character)).result).toMatchObject({
						status: "success",
						value: { success: false },
					});
					expect(calls).toBe(before);
					response += character;
					expect((yield* dispatch("")).result).toMatchObject({
						status: "success",
						value: {
							success: false,
							error: `Sandbox bridge response exceeds ${SANDBOX_LIMITS.bridge.responseBytes} UTF-8 bytes`,
						},
					});
				}
			}),
		).pipe(Effect.withSpan("sandbox.execution")),
	);
});
