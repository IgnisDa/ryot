import { describe, expect, it } from "@effect/vitest";
import { createRyotClient } from "@ryot-app/client-sdk";
import type { ContractClient } from "@ryot-app/contract/client";
import { EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { ProviderAddService } from "#/modules/provider-add/service";

const providerId = SandboxProviderId.make("provider-1");
const entitySchemaSlug = EntitySchemaSlug.make("book");
const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };

const pageInfo = { limit: 100, hasMore: false, nextCursor: null } as const;
const rowsResult = (items: readonly unknown[]) => ({ type: "rows", items, pageInfo });
const providerRow = {
	providerId,
	searchOptionsSchema: null,
	providerSlug: "openlibrary",
	providerName: "Open Library",
	rootEntitySchemaSlug: entitySchemaSlug,
};

type ContractCall = { readonly method: string; readonly request: unknown };

const makeApi = (
	calls: ContractCall[],
	respond: (method: string) => Effect.Effect<unknown, unknown>,
) => {
	const record = (method: string) => (request: unknown) => {
		calls.push({ method, request });
		return respond(method);
	};
	// A ContractProgram is always handed a whole ContractClient, so a fake implementing only the
	// group under test cannot be produced without asserting over the other contract groups.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const client = {
		providerEntities: {
			search: record("search"),
			import: record("import"),
			searchOptions: record("searchOptions"),
			getImportResult: record("getImportResult"),
		},
	} as unknown as ContractClient;
	return ProviderAddService.layer.pipe(
		Layer.provide(
			Layer.succeed(AuthenticatedApi, {
				run: <A, E>(_scope: ApiScope, program: (client: ContractClient) => Effect.Effect<A, E>) =>
					program(client).pipe(
						Effect.catch((cause) => Effect.fail(new AuthenticatedApiError({ cause }))),
					),
			}),
		),
	);
};

const contractResponses: Record<string, unknown> = {
	import: { jobId: "job-1" },
	searchOptions: { schema: null },
	getImportResult: { status: "pending" },
	search: { items: [], providerId, providerName: "Open Library" },
};

const workingApi = (calls: ContractCall[]) =>
	makeApi(calls, (method) => Effect.succeed(contractResponses[method]));

const failingApi = () => makeApi([], () => Effect.fail("offline"));

const dataClient = (queries: unknown[]) =>
	createRyotClient({
		query: (query) => {
			queries.push(query);
			return Promise.resolve({
				data:
					queries.length === 1
						? { providers: rowsResult([providerRow]) }
						: { links: rowsResult([{ entityId: "entity-1", externalId: "ext-1" }]) },
			});
		},
	});

const failingDataClient = () =>
	createRyotClient({ query: () => Promise.reject(new Error("offline")) });

describe("ProviderAddService", () => {
	it.effect("loads provider summaries and entity links through the RyotQL client", () => {
		const queries: unknown[] = [];
		const client = dataClient(queries);

		return Effect.gen(function* () {
			const service = yield* ProviderAddService;
			const providers = yield* service.loadProviders(client, entitySchemaSlug);
			const links = yield* service.loadEntityLinks(client, {
				providerId,
				entitySchemaSlug,
				externalIds: ["ext-1"],
			});

			expect(providers.items).toEqual([providerRow]);
			expect(links).toEqual([{ entityId: "entity-1", externalId: "ext-1" }]);
			expect(queries).toHaveLength(2);
			expect(queries[0]).toMatchObject({ queries: { providers: {} } });
			expect(queries[1]).toMatchObject({ queries: { links: {} } });
		}).pipe(Effect.provide(workingApi([])));
	});

	it.effect("routes every provider entity operation to its contract endpoint", () => {
		const calls: ContractCall[] = [];

		return Effect.gen(function* () {
			const service = yield* ProviderAddService;
			yield* service.loadSearchOptions(scope, providerId);
			yield* service.search(scope, { providerId, page: 1, pageSize: 20, query: "dune" });
			yield* service.startImport(scope, { providerId, externalId: "ext-1" });
			yield* service.pollImport(scope, "job-1");

			expect(calls).toEqual([
				{ method: "searchOptions", request: { payload: { providerId } } },
				{
					method: "search",
					request: { payload: { providerId, page: 1, pageSize: 20, query: "dune" } },
				},
				{ method: "import", request: { payload: { providerId, externalId: "ext-1" } } },
				{ method: "getImportResult", request: { params: { jobId: "job-1" } } },
			]);
		}).pipe(Effect.provide(workingApi(calls)));
	});

	it.effect("classifies a failure by the stage that produced it", () =>
		Effect.gen(function* () {
			const service = yield* ProviderAddService;
			const client = failingDataClient();
			const stages = [
				yield* Effect.flip(service.loadProviders(client, entitySchemaSlug)),
				yield* Effect.flip(
					service.loadEntityLinks(client, {
						providerId,
						entitySchemaSlug,
						externalIds: ["ext-1"],
					}),
				),
				yield* Effect.flip(service.loadSearchOptions(scope, providerId)),
				yield* Effect.flip(
					service.search(scope, { providerId, page: 1, pageSize: 20, query: "dune" }),
				),
				yield* Effect.flip(service.startImport(scope, { providerId, externalId: "ext-1" })),
				yield* Effect.flip(service.pollImport(scope, "job-1")),
			].map((error) => error.stage);

			expect(stages).toEqual(["providers", "links", "options", "search", "import", "import"]);
		}).pipe(Effect.provide(failingApi())),
	);
});
