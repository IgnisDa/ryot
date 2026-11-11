import { describe, expect } from "bun:test";

import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import type { ContractSuccess } from "@ryot-app/contract/client";
import {
	EntityEditorRefused,
	type EntityEditorSaveRequest,
} from "@ryot-app/contract/modules/entities/editor";
import type { ExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import {
	EntityId,
	EntitySchemaSlug,
	PluginId,
	SandboxProviderId,
} from "@ryot-app/contract/schema/brands";
import { createRyotClient, RyotClientError } from "@ryot-app/plugin-client-sdk";
import { createTestRyotAdapter } from "@ryot-app/plugin-client-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { EntitiesApi } from "#/api/entities";
import type { EntityProvidersApi } from "#/api/entity-providers";
import { ServerOrigin } from "#/api/origin";
import { makeEntityProvidersApi } from "#/api/ports.test-layer";
import type { ApiScope } from "#/api/scope";
import { DEMO_PROTECTION_MESSAGE } from "#/modules/demo-protection";
import { ENTITY_CREATE_REFUSED_MESSAGE, ProviderAddService } from "#/modules/provider-add/service";

const ownerPluginId = PluginId.make("stable-plugin-id");
const entitySchemaSlug = EntitySchemaSlug.make("unit");
const providerId = SandboxProviderId.make("provider-1");
const relationshipSlug = "in-fixture-library";
const librarySchemaSlug = "fixture-library";
const scope: ApiScope = { userId: "user-1", serverUrl: ServerOrigin.make("https://ryot.example") };

const pageInfo = { limit: 100, hasMore: false, nextCursor: null } as const;
const rowsResult = (items: readonly unknown[]) => ({ items, pageInfo, type: "rows" });
const providerRow = {
	providerId,
	searchOptionsSchema: null,
	providerName: "Open Library",
	providerSlug: "example-provider",
	rootEntitySchemaSlug: entitySchemaSlug,
};

type EntityProvidersMethod = keyof EntityProvidersApi["Service"];
type ContractCall = { readonly request: unknown; readonly method: EntityProvidersMethod };

class FakeEntityProvidersApi extends Context.Service<
	FakeEntityProvidersApi,
	{ readonly calls: Effect.Effect<ReadonlyArray<ContractCall>> }
>()("@ryot-app/kernel-client/modules/provider-add/service.test/FakeEntityProvidersApi") {}

const createRequest: EntityEditorSaveRequest = {
	idempotencyKey: "create-1",
	submittedAt: "2026-10-19T00:00:00.000Z",
	submission: {
		name: "Item",
		action: "save",
		properties: {},
		relationships: [],
		target: { kind: "create" },
		entitySchema: { slug: entitySchemaSlug, owner: { kind: "plugin", pluginId: ownerPluginId } },
	},
};

const createFailures: unknown[] = [];

const entitiesApi = Layer.succeed(EntitiesApi, {
	requestEnrichment: () => Effect.die("unused"),
	saveEditor: () => {
		const failure = createFailures.shift();
		return failure === undefined
			? Effect.succeed({
					warnings: [],
					output: { kind: "saved" as const, entityId: EntityId.make("entity-created") },
				})
			: Effect.fail(new AuthenticatedApiError({ cause: failure }));
	},
});

const providerAddLayer = (offline = false) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const calls = yield* Ref.make<ReadonlyArray<ContractCall>>([]);
			const record =
				<M extends EntityProvidersMethod>(
					method: M,
					response: ContractSuccess<"entityProviders", M>,
				) =>
				(_scope: ApiScope, request: unknown) =>
					Ref.update(calls, (all) => [...all, { method, request }]).pipe(
						Effect.andThen(
							offline
								? Effect.fail(new AuthenticatedApiError({ cause: "offline" }))
								: Effect.succeed(response),
						),
					);
			return Layer.merge(
				ProviderAddService.layer.pipe(
					Layer.provide(entitiesApi),
					Layer.provide(
						makeEntityProvidersApi({
							import: record("import", { jobId: "job-1" }),
							searchOptions: record("searchOptions", { schema: null }),
							getImportResult: record("getImportResult", { status: "running" }),
							search: record("search", {
								items: [],
								providerId,
								providerName: "Open Library",
								rootEntitySchemaSlug: entitySchemaSlug,
							}),
						}),
					),
				),
				Layer.succeed(FakeEntityProvidersApi, { calls: Ref.get(calls) }),
			);
		}),
	);

const dataClient = (queries: ExecutionRequest[]) =>
	createRyotClient(
		createTestRyotAdapter({
			query: (query) => {
				queries.push(query);
				return Effect.succeed({
					data:
						queries.length === 1
							? { providers: rowsResult([providerRow]) }
							: { links: rowsResult([{ externalId: "ext-1", entityId: "entity-1" }]) },
				});
			},
		}),
	);

const failingDataClient = () =>
	createRyotClient(
		createTestRyotAdapter({
			query: () => Effect.fail(new RyotClientError({ reason: "transport" })),
		}),
	);

describe("ProviderAddService", () => {
	layer(providerAddLayer())((test) => {
		test.effect(
			"loads every provider selection across bounded native pages",
			() =>
				Effect.gen(function* () {
					const service = yield* ProviderAddService;
					const externalIds = [
						...Array.from({ length: 205 }, (_, index) => `ext-${index}`),
						"ext-0",
						"missing",
					];
					const rows = Array.from({ length: 207 }, (_, index) => ({
						externalId: `ext-${index % 205}`,
						entityId: EntityId.make(`entity-${index}`),
					}));
					const requests: ExecutionRequest[] = [];
					const client = createRyotClient(
						createTestRyotAdapter({
							query: (request) => {
								requests.push(request);
								if (request.source.kind !== "inline") {
									return Effect.die("Expected inline provider lookup");
								}
								const name = "links" in request.source.document.queries ? "links" : "materialized";
								const query = request.source.document.queries[name];
								expect(query.output).toMatchObject({
									type: "rows",
									pagination: { limit: 100, maxLimit: 100 },
								});
								const offset = Number(request.pages?.[name]?.after ?? 0);
								const items = rows.slice(offset, offset + 100);
								const hasMore = offset + 100 < rows.length;
								return Effect.succeed({
									data: {
										[name]: {
											items,
											type: "rows",
											pageInfo: {
												hasMore,
												limit: 100,
												nextCursor: hasMore ? String(offset + 100) : null,
											},
										},
									},
								});
							},
						}),
					);
					const links = yield* service.loadEntityLinks(client, {
						providerId,
						externalIds,
						entitySchemaSlug,
						relationshipSlug,
						librarySchemaSlug,
						reference: { kind: "local", pluginId: ownerPluginId },
					});
					const materialized = yield* service.loadMaterialized(client, {
						providerId,
						externalIds,
						schema: { slug: entitySchemaSlug, owner: { kind: "plugin", pluginId: ownerPluginId } },
					});
					expect(links).toEqual(rows);
					expect([...materialized]).toEqual(externalIds.slice(0, 205));
					expect(materialized.has("missing")).toBe(false);
					expect(requests).toHaveLength(6);
					for (const request of requests) {
						expect(request.arguments).toEqual({ providerId, externalIds });
					}
				}),
			testTimeout,
		);

		test.effect(
			"loads provider summaries and entity links through the RyotQL client",
			() => {
				const queries: ExecutionRequest[] = [];
				const client = dataClient(queries);

				return Effect.gen(function* () {
					const service = yield* ProviderAddService;
					const providers = yield* service.loadProviders(client, {
						slug: entitySchemaSlug,
						owner: { kind: "plugin", pluginId: ownerPluginId },
					});
					const links = yield* service.loadEntityLinks(client, {
						providerId,
						entitySchemaSlug,
						relationshipSlug,
						librarySchemaSlug,
						externalIds: ["ext-1"],
						reference: { kind: "local", pluginId: ownerPluginId },
					});

					expect(providers.items).toEqual([providerRow]);
					expect(links).toEqual<unknown>([{ externalId: "ext-1", entityId: "entity-1" }]);
					expect(queries).toHaveLength(2);
					expect(queries[0]?.source).toMatchObject({
						kind: "inline",
						document: { queries: { providers: { from: { table: "sandboxProvider" } } } },
					});
					expect(queries[1]?.arguments).toEqual({ providerId, externalIds: ["ext-1"] });
				});
			},
			testTimeout,
		);
	});

	layer(providerAddLayer())((test) => {
		test.effect(
			"routes every provider entity operation to its contract endpoint",
			() => {
				return Effect.gen(function* () {
					const service = yield* ProviderAddService;
					yield* service.loadSearchOptions(scope, providerId);
					yield* service.search(scope, { page: 1, providerId, pageSize: 20, query: "sample" });
					yield* service.startImport(scope, { providerId, externalId: "ext-1" });
					yield* service.pollImport(scope, "job-1");

					expect(yield* (yield* FakeEntityProvidersApi).calls).toEqual([
						{ method: "searchOptions", request: { payload: { providerId } } },
						{
							method: "search",
							request: { payload: { page: 1, providerId, pageSize: 20, query: "sample" } },
						},
						{ method: "import", request: { payload: { providerId, externalId: "ext-1" } } },
						{ method: "getImportResult", request: { params: { jobId: "job-1" } } },
					]);
				});
			},
			testTimeout,
		);
	});

	layer(providerAddLayer(true))((test) => {
		test.effect(
			"classifies a failure by the stage that produced it",
			() =>
				Effect.gen(function* () {
					const service = yield* ProviderAddService;
					const client = failingDataClient();
					const stages = [
						yield* Effect.flip(
							service.loadProviders(client, {
								slug: entitySchemaSlug,
								owner: { kind: "plugin", pluginId: ownerPluginId },
							}),
						),
						yield* Effect.flip(
							service.loadEntityLinks(client, {
								providerId,
								entitySchemaSlug,
								relationshipSlug,
								librarySchemaSlug,
								externalIds: ["ext-1"],
								reference: { kind: "local", pluginId: ownerPluginId },
							}),
						),
						yield* Effect.flip(service.loadSearchOptions(scope, providerId)),
						yield* Effect.flip(
							service.search(scope, { page: 1, providerId, pageSize: 20, query: "sample" }),
						),
						yield* Effect.flip(service.startImport(scope, { providerId, externalId: "ext-1" })),
						yield* Effect.flip(service.pollImport(scope, "job-1")),
					].map((error) => error.stage);

					expect(stages).toEqual(["providers", "links", "options", "search", "import", "import"]);
				}),
			testTimeout,
		);
	});

	layer(providerAddLayer())((test) => {
		test.effect(
			"creates through the editor endpoint and treats server refusals as final",
			() =>
				Effect.gen(function* () {
					const service = yield* ProviderAddService;
					createFailures.push(
						new DemoOperationProtected({ reason: { code: "demo-operation-protected" } }),
						new EntityEditorRefused({ message: "No editor" }),
						"offline",
					);

					expect(yield* service.createEntity(scope, createRequest)).toEqual({
						kind: "invalid",
						message: DEMO_PROTECTION_MESSAGE,
					});
					expect(yield* service.createEntity(scope, createRequest)).toEqual({
						kind: "invalid",
						message: ENTITY_CREATE_REFUSED_MESSAGE,
					});
					expect((yield* Effect.flip(service.createEntity(scope, createRequest))).stage).toBe(
						"create",
					);
					expect(yield* service.createEntity(scope, createRequest)).toEqual({
						kind: "saved",
						entityId: EntityId.make("entity-created"),
					});
				}),
			testTimeout,
		);
	});
});
