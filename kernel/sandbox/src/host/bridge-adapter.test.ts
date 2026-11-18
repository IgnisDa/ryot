import { describe, expect } from "bun:test";

import { objectContaining, stringContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { bindObservabilityHostFunctions, bindSandboxHostFunctions } from "./bridge-adapter";
import type { SandboxHostImplementationMap } from "./invocation";
import { makeUserRunInput } from "./run-input.test-support";

const input = makeUserRunInput();

const managedAssetFailure = (key: string | undefined) => {
	if (key === "private") {
		return { code: "asset-forbidden", privateMetadata: "secret" };
	}
	if (key === "boundary") {
		return { code: "unavailable-operation", operation: "verifyManagedAssets" };
	}
	if (key === "unknown") {
		return { code: "private-error", privateMetadata: "secret" };
	}
	return { code: "asset-forbidden" };
};

const makeImplementations = (
	overrides: Partial<SandboxHostImplementationMap> = {},
): SandboxHostImplementationMap => ({
	log: () => Effect.fail({ message: "unused" }),
	span: () => Effect.fail({ message: "unused" }),
	httpCall: () => Effect.fail({ message: "unused" }),
	executeRyotql: () => Effect.fail({ message: "unused" }),
	getCachedValue: () => Effect.fail({ message: "unused" }),
	setCachedValue: () => Effect.fail({ message: "unused" }),
	getPluginConfig: () => Effect.fail({ message: "unused" }),
	getUserSettings: () => Effect.fail({ message: "unused" }),
	getEntitlements: () => Effect.fail({ message: "unused" }),
	invokeCapability: () => Effect.fail({ message: "unused" }),
	listIntegrations: () => Effect.fail({ message: "unused" }),
	getPersistentValue: () => Effect.fail({ message: "unused" }),
	getUserPreferences: () => Effect.fail({ message: "unused" }),
	verifyManagedAssets: () => Effect.fail({ message: "unused" }),
	getOAuthAccessToken: () => Effect.fail({ message: "unused" }),
	claimPersistentValue: () => Effect.fail({ message: "unused" }),
	getCurrentIntegration: () => Effect.fail({ message: "unused" }),
	invalidateOAuthAccessToken: () => Effect.fail({ message: "unused" }),
	...overrides,
});

describe("bindSandboxHostFunctions", () => {
	it.effect(
		"keeps the bound bridge in Effect",
		() =>
			Effect.gen(function* () {
				const result = bindSandboxHostFunctions(makeImplementations(), input).getCachedValue([
					"key",
				]);
				expect(yield* result).toEqual({ success: false, error: "unused" });
			}),
		testTimeout,
	);

	it.effect(
		"preserves boundary reason data in the normal host failure result",
		() =>
			Effect.gen(function* () {
				const bound = bindSandboxHostFunctions(
					makeImplementations({
						getPluginConfig: () =>
							Effect.fail({
								message: "A required plugin config value is not configured",
								data: { keys: ["apiToken"], code: "missing-required-config" },
							}),
					}),
					input,
				);
				const result = yield* bound.getPluginConfig([{ required: ["apiToken"] }]);

				expect(result).toEqual<unknown>(
					objectContaining({
						success: false,
						error: stringContaining("not configured"),
						data: objectContaining({ keys: ["apiToken"], code: "missing-required-config" }),
					}),
				);
			}),
		testTimeout,
	);

	it.effect(
		"decodes RPC arguments before calling a typed core implementation",
		() =>
			Effect.gen(function* () {
				const calls: unknown[] = [];
				const implementations = makeImplementations({
					setCachedValue: (runInput, key, value, expiry) => {
						calls.push({ key, value, expiry, runInput });
						return Effect.succeed(null);
					},
				});
				const bound = bindSandboxHostFunctions(implementations, input);
				const result = yield* bound.setCachedValue(["answer", { value: 42 }, 60]);

				expect(result).toEqual({ data: null, success: true });
				expect(calls).toEqual([
					{ expiry: 60, key: "answer", runInput: input, value: { value: 42 } },
				]);
			}),
		testTimeout,
	);

	it.effect(
		"binds entitlements and bounded managed asset verification without a user id",
		() =>
			Effect.gen(function* () {
				const calls: unknown[] = [];
				const implementations = makeImplementations({
					getEntitlements: (runInput) => {
						calls.push({ runInput, operation: "getEntitlements" });
						return Effect.succeed(["pro"] as const);
					},
					verifyManagedAssets: (runInput, locators) => {
						calls.push({ locators, runInput, operation: "verifyManagedAssets" });
						return Effect.succeed(null);
					},
				});
				const bound = bindSandboxHostFunctions(implementations, input);
				const locators = Array.from({ length: 500 }, (_, index) => ({
					type: "local" as const,
					key: `managed/${index}`,
				}));

				expect(yield* bound.getEntitlements([])).toEqual({ data: ["pro"], success: true });
				expect(yield* bound.verifyManagedAssets([locators])).toEqual({ data: null, success: true });
				expect(yield* bound.verifyManagedAssets([locators, "caller-selected-user"])).toEqual({
					success: false,
					error: "verifyManagedAssets received an invalid number of arguments",
				});
				expect(
					yield* bound.verifyManagedAssets([
						Array.from({ length: 501 }, (_, index) => ({
							type: "s3" as const,
							key: `managed/${index}`,
						})),
					]),
				).toMatchObject({ success: false });
				expect(calls).toEqual([
					{ runInput: input, operation: "getEntitlements" },
					{ locators, runInput: input, operation: "verifyManagedAssets" },
				]);
			}),
		testTimeout,
	);

	it.effect(
		"preserves only allowlisted managed asset failure data",
		() =>
			Effect.gen(function* () {
				const implementations = makeImplementations({
					verifyManagedAssets: (_runInput, locators) =>
						Effect.fail({
							message: "Asset verification failed",
							data: managedAssetFailure(locators[0]?.key),
						}),
				});
				const bound = bindSandboxHostFunctions(implementations, input);

				expect(yield* bound.verifyManagedAssets([[{ type: "local", key: "forbidden" }]])).toEqual({
					success: false,
					data: { code: "asset-forbidden" },
					error: "Asset verification failed",
				});
				expect(yield* bound.verifyManagedAssets([[{ type: "local", key: "private" }]])).toEqual({
					success: false,
					data: { code: "asset-forbidden" },
					error: "Asset verification failed",
				});
				expect(yield* bound.verifyManagedAssets([[{ type: "local", key: "unknown" }]])).toEqual({
					success: false,
					error: "Asset verification failed",
				});
				expect(yield* bound.verifyManagedAssets([[{ type: "local", key: "boundary" }]])).toEqual({
					success: false,
					error: "Asset verification failed",
					data: { code: "unavailable-operation", operation: "verifyManagedAssets" },
				});
			}),
		testTimeout,
	);

	it.effect(
		"returns a host failure without invoking an implementation for invalid arguments",
		() =>
			Effect.gen(function* () {
				let calls = 0;
				const implementations = makeImplementations({
					httpCall: () => {
						calls += 1;
						return Effect.fail({ message: "unexpected" });
					},
				});
				const bound = bindSandboxHostFunctions(implementations, input);
				const result = yield* bound.httpCall(["POST", "https://example.com", { body: 42 }]);

				expect(result).toEqual({ success: false, error: "2.body: Expected string | undefined" });
				expect(
					yield* bound.httpCall([
						"POST",
						"https://example.com",
						{ allowInsecureConnections: "yes" },
					]),
				).toEqual({
					success: false,
					error: "2.allowInsecureConnections: Expected boolean | undefined",
				});
				expect(yield* bound.getUserPreferences(["unexpected"])).toEqual({
					success: false,
					error: "getUserPreferences received an invalid number of arguments",
				});
				expect(calls).toBe(0);
			}),
		testTimeout,
	);

	it.effect(
		"binds read-only user settings with no arguments",
		() =>
			Effect.gen(function* () {
				const calls: unknown[] = [];
				const bound = bindSandboxHostFunctions(
					makeImplementations({
						getUserSettings: (runInput) => {
							calls.push(runInput);
							return Effect.succeed({ allowNsfw: true });
						},
					}),
					input,
				);

				expect(yield* bound.getUserSettings([])).toEqual({
					success: true,
					data: { allowNsfw: true },
				});
				expect(yield* bound.getUserSettings(["extra"])).toEqual({
					success: false,
					error: "getUserSettings received an invalid number of arguments",
				});
				expect(calls).toEqual([input]);
			}),
		testTimeout,
	);

	it.effect(
		"rejects invalid observability batches before dispatch",
		() =>
			Effect.gen(function* () {
				let calls = 0;
				const implementations = makeImplementations({
					log: () => {
						calls += 1;
						return Effect.succeed(null);
					},
					span: () => {
						calls += 1;
						return Effect.succeed(null);
					},
				});
				const bound = bindObservabilityHostFunctions(implementations, input);

				expect(yield* bound.log([[{ message: "nope", level: "verbose" }]])).toEqual({
					success: false,
					error: '0.0.level: Expected "debug" | "info" | "warning" | "error"',
				});
				expect(yield* bound.span([[{ name: "" }]])).toEqual({
					success: false,
					error: "0.0.name: Expected a value with a length of at least 1",
				});
				expect(yield* bound.log([[], "surplus"])).toEqual({
					success: false,
					error: "log received an invalid number of arguments",
				});
				expect(calls).toBe(0);
			}),
		testTimeout,
	);

	it.effect(
		"preserves HTTP failure details from a typed implementation",
		() =>
			Effect.gen(function* () {
				const implementations = makeImplementations({
					httpCall: () =>
						Effect.fail({
							message: "HTTP 429",
							data: { status: 429, body: "rate limited", headers: { "retry-after": "10" } },
						}),
				});
				const bound = bindSandboxHostFunctions(implementations, input);
				const result = yield* bound.httpCall(["GET", "https://example.com"]);

				expect(result).toEqual({
					success: false,
					error: "HTTP 429",
					data: { status: 429, body: "rate limited", headers: { "retry-after": "10" } },
				});
			}),
		testTimeout,
	);

	it.effect(
		"validates and narrows domain arguments before dispatch",
		() =>
			Effect.gen(function* () {
				const calls: Array<{ fnName: string; value: unknown }> = [];
				const implementations = makeImplementations({
					listIntegrations: (_runInput, options) => {
						calls.push({ value: options, fnName: "listIntegrations" });
						return Effect.fail({ message: "reached" });
					},
				});
				const bound = bindSandboxHostFunctions(implementations, input);

				expect(yield* bound.listIntegrations([{ provider: "plugin_defined_provider" }])).toEqual({
					success: false,
					error: "reached",
				});
				expect(yield* bound.listIntegrations([{ provider: 1 }])).toEqual({
					success: false,
					error: "0.provider: Expected string | undefined",
				});

				expect(calls).toEqual([
					{ fnName: "listIntegrations", value: { provider: "plugin_defined_provider" } },
				]);
			}),
		testTimeout,
	);

	it.effect(
		"dispatches domain calls with the server-provided run input and rejects surplus arguments",
		() =>
			Effect.gen(function* () {
				let calls = 0;
				let receivedUserId: null | string = "unset";
				const implementations = makeImplementations({
					getCurrentIntegration: (runInput) => {
						calls += 1;
						receivedUserId =
							"userId" in runInput.principal.subject ? runInput.principal.subject.userId : null;
						return Effect.fail({ message: "reached" });
					},
				});
				const bound = bindSandboxHostFunctions(implementations, input);

				yield* bound.getCurrentIntegration([]);
				const surplus = yield* bound.getCurrentIntegration(["integration-1"]);

				expect(surplus).toEqual({
					success: false,
					error: "getCurrentIntegration received an invalid number of arguments",
				});
				expect(calls).toBe(1);
				expect(receivedUserId).toBe("user-1");
			}),
		testTimeout,
	);

	it.effect(
		"normalizes transport null only for optional tuple arguments",
		() =>
			Effect.gen(function* () {
				const calls: Array<{ fnName: string; value: unknown }> = [];
				const implementations = makeImplementations({
					httpCall: (_runInput, _method, _url, options) => {
						calls.push({ value: options, fnName: "httpCall" });
						return Effect.fail({ message: "reached" });
					},
					listIntegrations: (_runInput, options) => {
						calls.push({ value: options, fnName: "listIntegrations" });
						return Effect.fail({ message: "reached" });
					},
				});
				const bound = bindSandboxHostFunctions(implementations, input);

				expect(yield* bound.httpCall(["GET", "https://example.com", null])).toEqual({
					success: false,
					error: "reached",
				});
				expect(yield* bound.listIntegrations([null])).toEqual({ success: false, error: "reached" });
				expect(yield* bound.getPluginConfig([{ required: [null] }])).toEqual({
					success: false,
					error: "0.required.0: Expected string",
				});
				expect(calls).toEqual([
					{ value: undefined, fnName: "httpCall" },
					{ value: undefined, fnName: "listIntegrations" },
				]);
			}),
		testTimeout,
	);

	it.effect(
		"forwards the per-call insecure connection opt-in without changing the default",
		() =>
			Effect.gen(function* () {
				const calls: unknown[] = [];
				const implementations = makeImplementations({
					httpCall: (_runInput, _method, _url, options) => {
						calls.push(options);
						return Effect.fail({ message: "reached" });
					},
				});
				const bound = bindSandboxHostFunctions(implementations, input);

				yield* bound.httpCall(["GET", "https://example.com"]);
				yield* bound.httpCall(["GET", "https://example.com", { allowInsecureConnections: true }]);

				expect(calls).toEqual([undefined, { allowInsecureConnections: true }]);
			}),
		testTimeout,
	);

	it.effect(
		"validates complete claim and config tuples",
		() =>
			Effect.gen(function* () {
				const calls: Array<{ fnName: string; value: unknown }> = [];
				const implementations = makeImplementations({
					getPluginConfig: (_runInput, keys) => {
						calls.push({ value: keys, fnName: "getPluginConfig" });
						return Effect.succeed({ apiToken: "token" });
					},
					claimPersistentValue: (_runInput, key, value, ttlSeconds) => {
						calls.push({ fnName: "claimPersistentValue", value: { key, value, ttlSeconds } });
						return Effect.succeed({ claimed: true as const });
					},
				});
				const bound = bindSandboxHostFunctions(implementations, input);

				expect(yield* bound.claimPersistentValue(["lock", { owner: "user-1" }, 60])).toEqual({
					success: true,
					data: { claimed: true },
				});
				expect(yield* bound.getPluginConfig([{ required: ["apiToken"] }])).toEqual({
					success: true,
					data: { apiToken: "token" },
				});
				expect(yield* bound.claimPersistentValue(["lock", { owner: "user-1" }, 1.5])).toEqual({
					success: false,
					error: "2: Expected an integer",
				});
				expect(yield* bound.setCachedValue(["lock", { owner: "user-1" }, 1.5])).toEqual({
					success: false,
					error: "2: Expected an integer",
				});
				expect(yield* bound.getPluginConfig([{ required: ["apiToken"] }, "surplus"])).toEqual({
					success: false,
					error: "getPluginConfig received an invalid number of arguments",
				});
				expect(calls).toEqual([
					{
						fnName: "claimPersistentValue",
						value: { key: "lock", ttlSeconds: 60, value: { owner: "user-1" } },
					},
					{ fnName: "getPluginConfig", value: { required: ["apiToken"] } },
				]);
			}),
		testTimeout,
	);
});
