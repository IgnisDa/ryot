import { expect } from "bun:test";

import { sandboxHostContracts } from "@ryot-app/plugin-backend-sdk/core";
import {
	SANDBOX_HOST_EXECUTION_POLICY,
	sandboxDurableHostDispatchStrategy,
} from "@ryot-app/sandbox/host/host-execution-policy";
import { assert } from "@ryot-app/testing/assert";
import { anyOf, objectContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { makeUserPrincipal } from "../authorization/principal.test-support";
import { dispatchSandboxHostActivity, prepareSandboxDurableHttpHop } from "./durable-dispatcher";
import { unusedSandboxHostImplementations } from "./host-implementations.test-support";

it("classifies every bridge host capability exactly once", () => {
	expect(Object.keys(SANDBOX_HOST_EXECUTION_POLICY).sort()).toEqual(
		Object.keys(sandboxHostContracts).sort(),
	);
	expect(SANDBOX_HOST_EXECUTION_POLICY).toEqual<unknown>(
		objectContaining({
			log: objectContaining({ dispatch: "diagnostic" }),
			span: objectContaining({ dispatch: "diagnostic" }),
			getUserSettings: objectContaining({ dispatch: "activity" }),
			invokeCapability: objectContaining({ dispatch: "service" }),
			invalidateOAuthAccessToken: objectContaining({ dispatch: "activity" }),
		}),
	);
	expect(SANDBOX_HOST_EXECUTION_POLICY.getEntitlements).toEqual<unknown>(
		objectContaining({ dispatch: "activity", resultBytes: anyOf(Number) }),
	);
	expect(SANDBOX_HOST_EXECUTION_POLICY.verifyManagedAssets).toEqual<unknown>(
		objectContaining({
			dispatch: "activity",
			wireBytes: anyOf(Number),
			resultBytes: anyOf(Number),
		}),
	);
	expect(sandboxDurableHostDispatchStrategy("scratch")).toBeNull();
});

it.effect(
	"applies centralized capability authorization before durable host dispatch",
	() =>
		Effect.gen(function* () {
			const error = yield* dispatchSandboxHostActivity(
				unusedSandboxHostImplementations(),
				{
					index: 0,
					kind: "host",
					name: "invokeCapability",
					args: { capability: "invokeCapability", args: [{ input: null, id: "capability" }] },
				},
				{
					context: {},
					lane: "interactive",
					executionId: "sandbox-parent",
					startedAt: "2026-08-06T00:00:00.000Z",
					principal: makeUserPrincipal({
						metadata: { runtimeImports: [], capabilities: ["invokeCapability"] },
					}),
				},
			).pipe(Effect.flip);
			expect(error.message).toBe(
				"Sandbox durable host denied: invokeCapability is not available to this execution",
			);
		}),
	testTimeout,
);

it.effect(
	"prepares one normalized durable HTTP hop when options are null",
	() =>
		Effect.gen(function* () {
			const prepared = yield* prepareSandboxDurableHttpHop(
				{
					index: 0,
					kind: "host",
					name: "httpCall",
					args: { capability: "httpCall", args: [" get ", "https://PROVIDER.test:443/path", null] },
				},
				{
					context: {},
					lane: "interactive",
					executionId: "sandbox-parent",
					startedAt: "2026-08-06T00:00:00.000Z",
					principal: makeUserPrincipal({
						metadata: { runtimeImports: [], capabilities: ["httpCall"] },
					}),
				},
			);
			assert(prepared._tag === "prepared");
			expect(prepared.current).toEqual({
				hop: 0,
				method: "GET",
				url: "https://provider.test/path",
				headers: { "User-Agent": "Ryot ( https://github.com/ignisda/ryot )" },
			});
		}),
	testTimeout,
);
