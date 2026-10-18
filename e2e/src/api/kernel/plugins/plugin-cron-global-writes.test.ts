import { RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import {
	adminAccessTokenHeaders,
	type Client,
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	getApiClient,
	getEntity,
	type InstalledTestPlugin,
	installTestPluginBundle,
	listAdminGlobalRelationships,
	listAdminSandboxScripts,
	providerSandboxSource,
	testPluginEntitySchema,
	trendingSandboxSource,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { assertPresent, assertTaggedError, requireObjectRecord } from "~/support/assertions";
import {
	afterAll,
	assert,
	beforeAll,
	describe,
	expect,
	it,
	runPromise,
} from "~/support/effect-test";

const MOVIE_SCHEMA_SLUG = "movie";
const TRENDING_SCHEMA_SLUG = "media-trending";
const SCRIPT_SLUG = "movie.e2e-test-trending";
const PROVIDER_SLUG = "movie.e2e-test-trending-provider";
const DETAILS_SCRIPT_SLUG = `${PROVIDER_SLUG}.details`;
const EXTERNAL_ID_ONE = "e2e-trending-1";
const EXTERNAL_ID_TWO = "e2e-trending-2";

const TRENDING_SOURCE = trendingSandboxSource({
	slug: SCRIPT_SLUG,
	name: "E2E Test Trending",
	items: [
		{ name: "E2E Trending One", externalId: EXTERNAL_ID_ONE },
		{ name: "E2E Trending Two", externalId: EXTERNAL_ID_TWO },
	],
});

let providerId: string;
let queryClient: Client;
let trendingPluginId: InstalledTestPlugin["pluginId"];
let trendingPlugin: undefined | InstalledTestPlugin;

describe("plugin cron global writes", () => {
	beforeAll(() =>
		runPromise(
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				queryClient = client;

				const detailsEntry = `backend/providers/${PROVIDER_SLUG}/details.sandbox.ts`;
				const trendingEntry = `backend/providers/${PROVIDER_SLUG}/trending.sandbox.ts`;
				const installed = yield* installTestPluginBundle({
					scope: "system",
					configSchema: { fields: {}, unknownKeys: "strict" },
					entitySchemas: [testPluginEntitySchema({ slug: MOVIE_SCHEMA_SLUG })],
					crons: [
						{
							scriptSlug: SCRIPT_SLUG,
							slug: "e2e-test-trending",
							schedule: { cron: "0 0 * * *" },
							description: "Refresh E2E trending fixtures",
						},
					],
					providers: [
						{
							slug: PROVIDER_SLUG,
							information: { source: "e2e" },
							name: "E2E Test Trending Provider",
							rootEntitySchemaSlug: MOVIE_SCHEMA_SLUG,
						},
					],
					files: {
						[trendingEntry]: TRENDING_SOURCE,
						[detailsEntry]: providerSandboxSource({
							operation: "details",
							slug: DETAILS_SCRIPT_SLUG,
							name: "E2E Test Trending Provider details",
							result: fakeProviderDetailsResult({ name: "E2E Test Trending Provider" }),
						}),
					},
					relationshipSchemas: [
						{
							name: "Trending",
							slug: TRENDING_SCHEMA_SLUG,
							sourceEntitySchemaSlug: null,
							targetEntitySchemaSlug: null,
							propertiesSchema: {
								fields: {
									rank: { label: "Rank", type: "number", description: "Rank" },
									fetchedAt: { type: "datetime", label: "Fetched at", description: "Fetched at" },
								},
							},
						},
					],
					scripts: [
						{
							kind: "provider",
							capabilities: [],
							entry: detailsEntry,
							slug: DETAILS_SCRIPT_SLUG,
							providerSlug: PROVIDER_SLUG,
							requiredPluginConfigKeys: [],
							providerOperation: "details",
							name: "E2E Test Trending Provider details",
						},
						{
							kind: "script",
							slug: SCRIPT_SLUG,
							entry: trendingEntry,
							name: "E2E Test Trending",
							providerSlug: PROVIDER_SLUG,
							requiredPluginConfigKeys: [],
							capabilities: ["upsertGlobalEntities", "upsertGlobalRelationships"],
						},
					],
				});
				const directScriptId = installed.scriptIds[SCRIPT_SLUG];
				assertPresent(directScriptId, "Trending direct script was not installed");
				const directScript = (yield* listAdminSandboxScripts(
					installed.activePluginRevisionId,
				)).find(({ id }) => id === directScriptId);
				assertPresent(directScript, "Trending direct script was not stored");
				assertPresent(directScript.providerId, "Trending script provider was not stored");
				providerId = directScript.providerId;
				trendingPluginId = installed.pluginId;
				trendingPlugin = installed;
			}),
		),
	);

	afterAll(() => trendingPlugin && runPromise(uninstallTestPlugin(trendingPlugin)));

	it.live("rejects the trigger without a valid admin token", () =>
		Effect.gen(function* () {
			const client = getApiClient();

			const missing = yield* Effect.flip(
				client.call((c) =>
					c.testSupport.triggerPluginCron({
						payload: { pluginId: trendingPluginId, cronSlug: "e2e-test-trending" },
					}),
				),
			);
			assertTaggedError(missing, "AuthUnauthorized");

			const wrong = yield* Effect.flip(
				client.call(
					(c) =>
						c.testSupport.triggerPluginCron({
							payload: { pluginId: trendingPluginId, cronSlug: "e2e-test-trending" },
						}),
					adminAccessTokenHeaders("wrong-token"),
				),
			);
			assertTaggedError(wrong, "AuthUnauthorized");
		}),
	);

	it.live("runs a direct cron script end-to-end and writes ranked self-edges", () =>
		Effect.gen(function* () {
			const result = yield* getApiClient().adminCall((c) =>
				c.testSupport.triggerPluginCron({
					payload: { pluginId: trendingPluginId, cronSlug: "e2e-test-trending" },
				}),
			);
			assert(result.status === "executed");
			const { executionId } = result;
			expect(typeof executionId).toBe("string");
			expect(executionId.length).toBeGreaterThan(0);

			const listCandidates = Effect.gen(function* () {
				const relationships = yield* listAdminGlobalRelationships({
					type: "self",
					relationshipSchemaSlug: RelationshipSchemaSlug.make(TRENDING_SCHEMA_SLUG),
				});
				return yield* Effect.forEach(relationships, (relationship) =>
					Effect.gen(function* () {
						const entity = yield* getEntity(queryClient, relationship.sourceEntityId);
						const properties = requireObjectRecord(
							relationship.properties,
							"Trending relationship properties",
						);
						return {
							rank: properties["rank"],
							providerId: entity.providerId,
							external_id: entity.externalId,
							fetched_at: properties["fetchedAt"],
						};
					}),
				);
			});

			const candidates = yield* listCandidates;
			const rows = candidates
				.filter(
					(row) =>
						row.providerId === providerId &&
						(row.external_id === EXTERNAL_ID_ONE || row.external_id === EXTERNAL_ID_TWO),
				)
				.sort((a, b) => Number(a.rank) - Number(b.rank));

			expect(rows).toHaveLength(2);
			for (const row of rows) {
				expect(row.rank).toBeDefined();
				expect(row.fetched_at).toBeDefined();
				expect(Number(row.rank)).toBeGreaterThan(0);
			}

			const rankByExternalId = new Map(rows.map((row) => [row.external_id, Number(row.rank)]));
			const rankOne = rankByExternalId.get(EXTERNAL_ID_ONE);
			const rankTwo = rankByExternalId.get(EXTERNAL_ID_TWO);
			assertPresent(rankOne, "missing rank for first trending item");
			assertPresent(rankTwo, "missing rank for second trending item");
			// Ranks follow save order deterministically; the first-saved item ranks ahead.
			expect(rankOne).toBeLessThan(rankTwo);
		}),
	);
});
