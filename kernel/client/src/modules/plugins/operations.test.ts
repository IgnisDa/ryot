import { describe, expect, it } from "@effect/vitest";
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
import { Effect } from "effect";

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

const makeApi = (invoke: (request: InvokeRequest) => InvokeResult) =>
	makePluginsApi({ invoke: (_scope, request) => invoke(request) });

const failing = (cause: unknown) =>
	makeApi(() => Effect.fail(new AuthenticatedApiError({ cause })));

describe("plugin operations service", () => {
	it.effect("invokes the explicitly targeted plugin and operation at the recorded revision", () => {
		const calls: InvokeRequest[] = [];
		const dependencies = makeApi((request) => {
			calls.push(request);
			return Effect.succeed({ result: "ignored" });
		});

		return Effect.gen(function* () {
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

			expect(calls).toEqual([
				{
					params: { pluginSlug: "fixture", operationSlug: "greet" },
					payload: { sourceHash: "source-hash", payload: { greeting: "hi" } },
				},
			]);
		}).pipe(Effect.provide(PluginOperationsService.layer), Effect.provide(dependencies));
	});

	it.effect("maps a successful response to a success outcome", () => {
		const dependencies = makeApi(() => Effect.succeed({ result: { greeted: "hi" } }));

		return Effect.gen(function* () {
			const service = yield* PluginOperationsService;
			const outcome = yield* service.invoke({
				scope,
				sourceHash: "source-hash",
				request: { input: null, operationSlug: "greet", pluginSlug: PluginSlug.make("fixture") },
			});

			expect(outcome).toEqual({ outcome: "success", value: { greeted: "hi" } });
		}).pipe(Effect.provide(PluginOperationsService.layer), Effect.provide(dependencies));
	});

	it.effect("returns a kernel-only stale session result for a changed source revision", () => {
		const dependencies = failing(
			new PluginConflictError({
				reason: { code: "source-revision-stale", pluginSlug: PluginSlug.make("fixture") },
			}),
		);

		return Effect.gen(function* () {
			const service = yield* PluginOperationsService;
			const outcome = yield* service.invoke({
				scope,
				sourceHash: "source-hash",
				request: { input: null, operationSlug: "greet", pluginSlug: PluginSlug.make("fixture") },
			});

			expect(outcome).toEqual({ outcome: "stale-session" });
		}).pipe(Effect.provide(PluginOperationsService.layer), Effect.provide(dependencies));
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
		it.effect(`classifies ${cause._tag} as a declared platform operation failure`, () => {
			const dependencies = failing(cause);

			return Effect.gen(function* () {
				const service = yield* PluginOperationsService;
				const outcome = yield* service.invoke({
					scope,
					sourceHash: "source-hash",
					request: { input: null, operationSlug: "greet", pluginSlug: PluginSlug.make("fixture") },
				});

				expect(outcome).toEqual({ outcome: "failure", reason: "operation-failed" });
			}).pipe(Effect.provide(PluginOperationsService.layer), Effect.provide(dependencies));
		});
	}

	it.effect("classifies an unrelated cause as a transport failure without leaking it", () => {
		const dependencies = failing(new TypeError("network down"));

		return Effect.gen(function* () {
			const service = yield* PluginOperationsService;
			const outcome = yield* service.invoke({
				scope,
				sourceHash: "source-hash",
				request: { input: null, operationSlug: "greet", pluginSlug: PluginSlug.make("fixture") },
			});

			expect(outcome).toEqual({ outcome: "failure", reason: "transport" });
			expect(outcome).not.toHaveProperty("cause");
			expect(JSON.stringify(outcome)).not.toContain("network down");
		}).pipe(Effect.provide(PluginOperationsService.layer), Effect.provide(dependencies));
	});
});
