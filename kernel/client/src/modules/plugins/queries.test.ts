import { describe, expect, it } from "@effect/vitest";
import { AuthRateLimited, AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import { RyotQLBadRequest, RyotQLInternalError } from "@ryot-app/contract/modules/ryotql/contract";
import { Effect } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import { makeRyotQLApi } from "#/api/ports.test-layer";
import type { ApiScope } from "#/api/scope";
import { PluginQueriesService } from "#/modules/plugins/queries";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const document = {
	queries: {
		items: {
			from: { alias: "item", table: "item" },
			output: { fields: [], orderBy: [], type: "rows", pagination: { limit: 10 } },
		},
	},
} as const;

type ExecuteRequest = { readonly payload: ContractPayload<"ryotql", "execute"> };
type ExecuteResult = Effect.Effect<ContractSuccess<"ryotql", "execute">, AuthenticatedApiError>;

const makeApi = (execute: (request: ExecuteRequest) => ExecuteResult) =>
	makeRyotQLApi({ execute: (_scope, request) => execute(request) });

const failing = (cause: unknown) =>
	makeApi(() => Effect.fail(new AuthenticatedApiError({ cause })));

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
			expect(outcome).toEqual({ response, outcome: "success" });
		}).pipe(Effect.provide(PluginQueriesService.layer), Effect.provide(dependencies));
	});

	const expectedFailures = [
		new AuthUnauthorized({ reason: { code: "authentication-required" } }),
		new AuthRateLimited({ reason: { retryAfterMs: 30_000, code: "api-key-rate-limited" } }),
		new RyotQLBadRequest({ reason: { code: "invalid-query" } }),
		new RyotQLInternalError({ reason: { code: "execution-failed" } }),
	];

	for (const cause of expectedFailures) {
		it.effect(`classifies ${cause._tag} as query-failed`, () => {
			const dependencies = failing(cause);

			return Effect.gen(function* () {
				const service = yield* PluginQueriesService;
				const outcome = yield* service.query({ scope, request: { document } });

				expect(outcome).toEqual({ outcome: "failure", reason: "query-failed" });
			}).pipe(Effect.provide(PluginQueriesService.layer), Effect.provide(dependencies));
		});
	}

	it.effect("maps an unexpected failure to transport without leaking its cause", () => {
		const dependencies = failing(new TypeError("private network detail"));

		return Effect.gen(function* () {
			const service = yield* PluginQueriesService;
			const outcome = yield* service.query({ scope, request: { document } });

			expect(outcome).toEqual({ outcome: "failure", reason: "transport" });
		}).pipe(Effect.provide(PluginQueriesService.layer), Effect.provide(dependencies));
	});
});
