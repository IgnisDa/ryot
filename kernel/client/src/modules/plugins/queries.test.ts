import { describe, expect, it } from "@effect/vitest";
import { AuthRateLimited, AuthUnauthorized } from "@ryot/contract/auth-middleware";
import type { ContractClient, ContractPayload } from "@ryot/contract/client";
import { RyotQLBadRequest, RyotQLInternalError } from "@ryot/contract/modules/ryotql/contract";
import { Effect, Layer } from "effect";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";
import { PluginQueriesService } from "#/modules/plugins/queries";

const scope: ApiScope = { userId: "user-1", serverUrl: "https://ryot.example" };
const document = {
	queries: {
		items: {
			from: { alias: "item", table: "item" },
			output: { fields: [], orderBy: [], pagination: { limit: 10 }, type: "rows" },
		},
	},
} as const;

type ExecuteRequest = { readonly payload: ContractPayload<"ryotql", "execute"> };

const makeApi = (execute: (request: ExecuteRequest) => Effect.Effect<unknown, unknown>) => {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const client = { ryotql: { execute } } as ContractClient;
	return Layer.succeed(AuthenticatedApi, {
		run: <A, E>(_scope: ApiScope, program: (client: ContractClient) => Effect.Effect<A, E>) =>
			program(client).pipe(
				Effect.catch((cause) => Effect.fail(new AuthenticatedApiError({ cause }))),
			),
	});
};

describe("plugin queries service", () => {
	it.effect("executes the user-scoped RyotQL endpoint without adding identity fields", () => {
		const calls: ExecuteRequest[] = [];
		const response = { data: {} };
		const dependencies = makeApi((request) => {
			calls.push(request);
			return Effect.succeed(response);
		});

		return Effect.gen(function* () {
			const service = yield* PluginQueriesService;
			const outcome = yield* service.query({ scope, request: { document } });

			expect(calls).toEqual([{ payload: document }]);
			expect(outcome).toEqual({ outcome: "success", response });
		}).pipe(Effect.provide(PluginQueriesService.layer), Effect.provide(dependencies));
	});

	const expectedFailures = [
		new AuthUnauthorized({ reason: { code: "authentication-required" } }),
		new AuthRateLimited({ reason: { code: "api-key-rate-limited", retryAfterMs: 30_000 } }),
		new RyotQLBadRequest({ reason: { code: "invalid-query" } }),
		new RyotQLInternalError({ reason: { code: "execution-failed" } }),
	];

	for (const cause of expectedFailures) {
		it.effect(`classifies ${cause._tag} as query-failed`, () => {
			const dependencies = makeApi(() => Effect.fail(cause));

			return Effect.gen(function* () {
				const service = yield* PluginQueriesService;
				const outcome = yield* service.query({ scope, request: { document } });

				expect(outcome).toEqual({ outcome: "failure", reason: "query-failed" });
			}).pipe(Effect.provide(PluginQueriesService.layer), Effect.provide(dependencies));
		});
	}

	it.effect("maps an unexpected failure to transport without leaking its cause", () => {
		const dependencies = makeApi(() => Effect.fail(new TypeError("private network detail")));

		return Effect.gen(function* () {
			const service = yield* PluginQueriesService;
			const outcome = yield* service.query({ scope, request: { document } });

			expect(outcome).toEqual({ outcome: "failure", reason: "transport" });
		}).pipe(Effect.provide(PluginQueriesService.layer), Effect.provide(dependencies));
	});
});
