import { describe, expect, it } from "@effect/vitest";
import { AuthRateLimited, AuthUnauthorized } from "@ryot/contract/auth-middleware";
import type { ContractClient, ContractPathParams, ContractPayload } from "@ryot/contract/client";
import {
	PluginInvocationError,
	PluginNotFoundError,
	PluginRequestError,
} from "@ryot/contract/modules/plugins/schemas";
import { PluginSlug } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { AuthenticatedApi, AuthenticatedApiError } from "../../api/authenticated";
import type { ApiScope } from "../../api/scope";
import { PluginOperationsService } from "./operations";

const scope: ApiScope = { userId: "user-1", serverUrl: "https://ryot.example" };

type InvokeRequest = {
	readonly payload: ContractPayload<"plugins", "invoke">;
	readonly params: ContractPathParams<"plugins", "invoke">;
};

const makeApi = (invoke: (request: InvokeRequest) => Effect.Effect<unknown, unknown>) => {
	// A ContractProgram is always handed a whole ContractClient, so a fake implementing only the
	// method under test cannot be produced without asserting over the other contract groups.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const client = { plugins: { invoke } } as ContractClient;
	return Layer.succeed(AuthenticatedApi, {
		run: <A, E>(_scope: ApiScope, program: (client: ContractClient) => Effect.Effect<A, E>) =>
			program(client).pipe(
				Effect.catch((cause) => Effect.fail(new AuthenticatedApiError({ cause }))),
			),
	});
};

describe("plugin operations service", () => {
	it.effect("invokes the contract program with the session's plugin and operation slugs", () => {
		const calls: InvokeRequest[] = [];
		const dependencies = makeApi((request) => {
			calls.push(request);
			return Effect.succeed({ result: "ignored" });
		});

		return Effect.gen(function* () {
			const service = yield* PluginOperationsService;
			yield* service.invoke({
				scope,
				pluginSlug: "fixture",
				request: { input: { greeting: "hi" }, operationSlug: "greet" },
			});

			expect(calls).toEqual([
				{
					payload: { payload: { greeting: "hi" } },
					params: { pluginSlug: "fixture", operationSlug: "greet" },
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
				pluginSlug: "fixture",
				request: { input: null, operationSlug: "greet" },
			});

			expect(outcome).toEqual({ outcome: "success", value: { greeted: "hi" } });
		}).pipe(Effect.provide(PluginOperationsService.layer), Effect.provide(dependencies));
	});

	const expectedFailures = [
		new AuthUnauthorized({ reason: { code: "authentication-required" } }),
		new AuthRateLimited({ reason: { code: "session-rate-limited", retryAfterMs: null } }),
		new PluginNotFoundError({
			reason: { code: "plugin-not-found", pluginSlug: PluginSlug.make("fixture") },
		}),
		new PluginRequestError({ reason: { code: "upload-unavailable" } }),
		new PluginInvocationError({ reason: { code: "runtime-failed", diagnostics: [] } }),
	];

	for (const cause of expectedFailures) {
		it.effect(`classifies ${cause._tag} as an expected operation failure`, () => {
			const dependencies = makeApi(() => Effect.fail(cause));

			return Effect.gen(function* () {
				const service = yield* PluginOperationsService;
				const outcome = yield* service.invoke({
					scope,
					pluginSlug: "fixture",
					request: { input: null, operationSlug: "greet" },
				});

				expect(outcome).toEqual({ outcome: "failure", reason: "operation-failed" });
			}).pipe(Effect.provide(PluginOperationsService.layer), Effect.provide(dependencies));
		});
	}

	it.effect("classifies an unrelated cause as a transport failure without leaking it", () => {
		const dependencies = makeApi(() => Effect.fail(new TypeError("network down")));

		return Effect.gen(function* () {
			const service = yield* PluginOperationsService;
			const outcome = yield* service.invoke({
				scope,
				pluginSlug: "fixture",
				request: { input: null, operationSlug: "greet" },
			});

			expect(outcome).toEqual({ outcome: "failure", reason: "transport" });
		}).pipe(Effect.provide(PluginOperationsService.layer), Effect.provide(dependencies));
	});
});
