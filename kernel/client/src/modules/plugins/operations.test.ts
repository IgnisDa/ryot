import { describe, expect, layer } from "@effect/vitest";
import {
	AuthRateLimited,
	AuthUnauthorized,
	DemoOperationProtected,
} from "@ryot-app/contract/auth-middleware";
import type {
	ContractPathParams,
	ContractPayload,
	ContractSuccess,
} from "@ryot-app/contract/client";
import {
	PluginConflictError,
	PluginInvocationError,
	PluginNotFoundError,
	PluginRequestError,
} from "@ryot-app/contract/modules/plugins/schemas";
import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref, Schema } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import { makePluginsApi } from "#/api/ports.test-layer";
import type { ApiScope } from "#/api/scope";
import { PluginOperationsService } from "#/modules/plugins/operations";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };

type InvokeRequest = {
	readonly payload: ContractPayload<"plugins", "invoke">;
	readonly params: ContractPathParams<"plugins", "invoke">;
};

type InvokeResult = Effect.Effect<ContractSuccess<"plugins", "invoke">, AuthenticatedApiError>;

class FakePluginsApi extends Context.Service<
	FakePluginsApi,
	{ readonly requests: Effect.Effect<ReadonlyArray<InvokeRequest>> }
>()("test/FakePluginsApi") {}

const operationsLayer = (reply: () => InvokeResult) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const requests = yield* Ref.make<ReadonlyArray<InvokeRequest>>([]);
			return Layer.merge(
				Layer.provide(
					PluginOperationsService.layer,
					makePluginsApi({
						invoke: (_scope, request) =>
							Ref.update(requests, (all) => [...all, request]).pipe(Effect.andThen(reply())),
					}),
				),
				Layer.succeed(FakePluginsApi, { requests: Ref.get(requests) }),
			);
		}),
	);

const failing = (cause: unknown) =>
	operationsLayer(() => Effect.fail(new AuthenticatedApiError({ cause })));

describe("plugin operations service", () => {
	layer(operationsLayer(() => Effect.succeed({ result: "ignored" })))((test) => {
		test.effect(
			"invokes the explicitly targeted plugin and operation at the recorded revision",
			() =>
				Effect.gen(function* () {
					const service = yield* PluginOperationsService;
					yield* service.invoke({
						scope,
						sourceHash: "source-hash",
						request: {
							operationSlug: "greet",
							input: { greeting: "hi" },
							pluginSlug: PluginSlug.make("fixture"),
						},
					});

					expect(yield* (yield* FakePluginsApi).requests).toEqual([
						{
							params: { pluginSlug: "fixture", operationSlug: "greet" },
							payload: { sourceHash: "source-hash", payload: { greeting: "hi" } },
						},
					]);
				}),
		);
	});

	layer(operationsLayer(() => Effect.succeed({ result: { greeted: "hi" } })))((test) => {
		test.effect("maps a successful response to a success outcome", () =>
			Effect.gen(function* () {
				const service = yield* PluginOperationsService;
				const outcome = yield* service.invoke({
					scope,
					sourceHash: "source-hash",
					request: { input: null, operationSlug: "greet", pluginSlug: PluginSlug.make("fixture") },
				});

				expect(outcome).toEqual({ outcome: "success", value: { greeted: "hi" } });
			}),
		);
	});

	layer(
		failing(
			new PluginConflictError({
				reason: { code: "source-revision-stale", pluginSlug: PluginSlug.make("fixture") },
			}),
		),
	)((test) => {
		test.effect("returns a kernel-only stale session result for a changed source revision", () =>
			Effect.gen(function* () {
				const service = yield* PluginOperationsService;
				const outcome = yield* service.invoke({
					scope,
					sourceHash: "source-hash",
					request: { input: null, operationSlug: "greet", pluginSlug: PluginSlug.make("fixture") },
				});

				expect(outcome).toEqual({ outcome: "stale-session" });
			}),
		);
	});

	const declaredFailures = [
		new AuthUnauthorized({ reason: { code: "authentication-required" } }),
		new AuthRateLimited({ reason: { retryAfterMs: null, code: "api-key-rate-limited" } }),
		new DemoOperationProtected({ reason: { code: "demo-operation-protected" } }),
		new PluginNotFoundError({
			reason: { code: "plugin-not-found", pluginSlug: PluginSlug.make("fixture") },
		}),
		new PluginRequestError({ reason: { code: "upload-unavailable" } }),
		new PluginInvocationError({ reason: { diagnostics: [], code: "runtime-failed" } }),
		new PluginConflictError({
			reason: { code: "already-installed", pluginSlug: PluginSlug.make("fixture") },
		}),
	];

	for (const cause of declaredFailures) {
		layer(failing(cause))((test) => {
			test.effect(`classifies ${cause._tag} as a declared platform operation failure`, () =>
				Effect.gen(function* () {
					const service = yield* PluginOperationsService;
					const outcome = yield* service.invoke({
						scope,
						sourceHash: "source-hash",
						request: {
							input: null,
							operationSlug: "greet",
							pluginSlug: PluginSlug.make("fixture"),
						},
					});

					expect(outcome).toEqual({ outcome: "failure", reason: "operation-failed" });
				}),
			);
		});
	}

	layer(failing(new TypeError("network down")))((test) => {
		test.effect("classifies an unrelated cause as a transport failure without leaking it", () =>
			Effect.gen(function* () {
				const service = yield* PluginOperationsService;
				const outcome = yield* service.invoke({
					scope,
					sourceHash: "source-hash",
					request: { input: null, operationSlug: "greet", pluginSlug: PluginSlug.make("fixture") },
				});

				expect(outcome).toEqual({ outcome: "failure", reason: "transport" });
				expect(outcome).not.toHaveProperty("cause");
				expect(
					yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(outcome),
				).not.toContain("network down");
			}),
		);
	});
});
