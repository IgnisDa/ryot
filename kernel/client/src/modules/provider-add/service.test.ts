import { describe, expect, layer } from "@effect/vitest";
import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import type { ContractSuccess } from "@ryot-app/contract/client";
import {
	EntityEditorRefused,
	type EntityEditorSaveRequest,
} from "@ryot-app/contract/modules/entities/editor";
import {
	EntityId,
	EntitySchemaSlug,
	PluginId,
	SandboxProviderId,
} from "@ryot-app/contract/schema/brands";
import { createRyotClient, RyotClientError } from "@ryot-app/plugin-client-sdk";
import { createTestRyotAdapter } from "@ryot-app/plugin-client-sdk/testing";
import { Context, Effect, Layer, Ref } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { EntitiesApi } from "#/api/entities";
import type { EntityProvidersApi } from "#/api/entity-providers";
import { decodeServerOrigin } from "#/api/origin";
import { makeEntityProvidersApi } from "#/api/ports.test-layer";
import type { ApiScope } from "#/api/scope";
import { DEMO_PROTECTION_MESSAGE } from "#/modules/demo-protection";
import { ENTITY_CREATE_REFUSED_MESSAGE, ProviderAddService } from "#/modules/provider-add/service";

const ownerPluginId = PluginId.make("stable-plugin-id");
const entitySchemaSlug = EntitySchemaSlug.make("book");
const providerId = SandboxProviderId.make("provider-1");
const relationshipSlug = "in-media-library";
const librarySchemaSlug = "media-library";
const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };

const pageInfo = { limit: 100, hasMore: false, nextCursor: null } as const;
const rowsResult = (items: readonly unknown[]) => ({ items, pageInfo, type: "rows" });
const providerRow = {
	providerId,
	searchOptionsSchema: null,
	providerSlug: "openlibrary",
	providerName: "Open Library",
	rootEntitySchemaSlug: entitySchemaSlug,
};

type EntityProvidersMethod = keyof EntityProvidersApi["Service"];
type ContractCall = { readonly method: EntityProvidersMethod; readonly request: unknown };

class FakeEntityProvidersApi extends Context.Service<
	FakeEntityProvidersApi,
	{ readonly calls: Effect.Effect<ReadonlyArray<ContractCall>> }
>()("test/FakeEntityProvidersApi") {}

const createRequest: EntityEditorSaveRequest = {
	idempotencyKey: "create-1",
	submittedAt: "2026-10-19T00:00:00.000Z",
	submission: {
		name: "Item",
		properties: {},
		relationships: [],
		target: { kind: "create" },
		entitySchema: { slug: entitySchemaSlug, owner: { kind: "plugin", pluginId: ownerPluginId } },
	},
};

const createFailures: unknown[] = [];

const entitiesApi = Layer.succeed(EntitiesApi, {
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

const dataClient = (queries: unknown[]) =>
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
		createTestRyotAdapter({ query: () => Effect.fail(new RyotClientError("transport")) }),
	);

describe("ProviderAddService", () => {
	layer(providerAddLayer())((test) => {
		test.effect("loads provider summaries and entity links through the RyotQL client", () => {
			const queries: unknown[] = [];
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
				expect(links).toEqual([{ externalId: "ext-1", entityId: "entity-1" }]);
				expect(queries).toHaveLength(2);
				expect(queries[0]).toMatchObject({
					queries: {
						providers: {
							where: {
								predicates: [
									{},
									{
										left: { field: "pluginId", tableAlias: "provider" },
										right: {
											type: "pluginId",
											reference: { kind: "local", pluginId: ownerPluginId },
										},
									},
									{},
									{},
								],
							},
						},
					},
				});
				expect(queries[1]).toMatchObject({ queries: { links: {} } });
			});
		});
	});

	layer(providerAddLayer())((test) => {
		test.effect("routes every provider entity operation to its contract endpoint", () => {
			return Effect.gen(function* () {
				const service = yield* ProviderAddService;
				yield* service.loadSearchOptions(scope, providerId);
				yield* service.search(scope, { page: 1, providerId, pageSize: 20, query: "dune" });
				yield* service.startImport(scope, { providerId, externalId: "ext-1" });
				yield* service.pollImport(scope, "job-1");

				expect(yield* (yield* FakeEntityProvidersApi).calls).toEqual([
					{ method: "searchOptions", request: { payload: { providerId } } },
					{
						method: "search",
						request: { payload: { page: 1, providerId, pageSize: 20, query: "dune" } },
					},
					{ method: "import", request: { payload: { providerId, externalId: "ext-1" } } },
					{ method: "getImportResult", request: { params: { jobId: "job-1" } } },
				]);
			});
		});
	});

	layer(providerAddLayer(true))((test) => {
		test.effect("classifies a failure by the stage that produced it", () =>
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
						service.search(scope, { page: 1, providerId, pageSize: 20, query: "dune" }),
					),
					yield* Effect.flip(service.startImport(scope, { providerId, externalId: "ext-1" })),
					yield* Effect.flip(service.pollImport(scope, "job-1")),
				].map((error) => error.stage);

				expect(stages).toEqual(["providers", "links", "options", "search", "import", "import"]);
			}),
		);
	});

	layer(providerAddLayer())((test) => {
		test.effect("creates through the editor endpoint and treats server refusals as final", () =>
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
		);
	});
});
