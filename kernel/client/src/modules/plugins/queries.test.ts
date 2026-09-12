import { describe, expect, layer } from "@effect/vitest";
import { AuthRateLimited, AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import { RyotQLBadRequest, RyotQLInternalError } from "@ryot-app/contract/modules/ryotql/contract";
import { Context, Effect, Layer, Ref } from "effect";

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

type ExecuteRequest = { readonly payload: ContractPayload<"ryotql", "executePlugin"> };
type ExecuteResult = Effect.Effect<
	ContractSuccess<"ryotql", "executePlugin">,
	AuthenticatedApiError
>;

class FakeRyotQLApi extends Context.Service<
	FakeRyotQLApi,
	{ readonly requests: Effect.Effect<ReadonlyArray<ExecuteRequest>> }
>()("test/FakeRyotQLApi") {}

const queriesLayer = (reply: () => ExecuteResult) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const requests = yield* Ref.make<ReadonlyArray<ExecuteRequest>>([]);
			return Layer.merge(
				Layer.provide(
					PluginQueriesService.layer,
					makeRyotQLApi({
						executePlugin: (_scope, request) =>
							Ref.update(requests, (all) => [...all, request]).pipe(Effect.andThen(reply())),
					}),
				),
				Layer.succeed(FakeRyotQLApi, { requests: Ref.get(requests) }),
			);
		}),
	);

const failing = (cause: unknown) =>
	queriesLayer(() => Effect.fail(new AuthenticatedApiError({ cause })));

const response = { data: {} };

describe("plugin queries service", () => {
	layer(queriesLayer(() => Effect.succeed(response)))((test) => {
		test.effect("executes the plugin-audience RyotQL endpoint without adding identity fields", () =>
			Effect.gen(function* () {
				const service = yield* PluginQueriesService;
				const outcome = yield* service.query({ scope, request: { document } });

				expect(yield* (yield* FakeRyotQLApi).requests).toEqual([{ payload: document }]);
				expect(outcome).toEqual({ response, outcome: "success" });
			}),
		);
	});

	const expectedFailures = [
		new AuthUnauthorized({ reason: { code: "authentication-required" } }),
		new AuthRateLimited({ reason: { retryAfterMs: 30_000, code: "api-key-rate-limited" } }),
		new RyotQLBadRequest({ reason: { code: "invalid-query" } }),
		new RyotQLInternalError({ reason: { code: "execution-failed" } }),
	];

	for (const cause of expectedFailures) {
		layer(failing(cause))((test) => {
			test.effect(`classifies ${cause._tag} as query-failed`, () =>
				Effect.gen(function* () {
					const service = yield* PluginQueriesService;
					const outcome = yield* service.query({ scope, request: { document } });

					expect(outcome).toEqual({ outcome: "failure", reason: "query-failed" });
				}),
			);
		});
	}

	layer(failing(new TypeError("private network detail")))((test) => {
		test.effect("maps an unexpected failure to transport without leaking its cause", () =>
			Effect.gen(function* () {
				const service = yield* PluginQueriesService;
				const outcome = yield* service.query({ scope, request: { document } });

				expect(outcome).toEqual({ outcome: "failure", reason: "transport" });
			}),
		);
	});
});
