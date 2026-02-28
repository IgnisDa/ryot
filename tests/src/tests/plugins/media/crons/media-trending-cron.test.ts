import { PluginSlug, RelationshipSchemaSlug } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	ADMIN_TOKEN,
	adminAccessTokenHeaders,
	adminHeaders,
	type Client,
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	findBuiltinSchemaBySlug,
	getBackendClient,
	getEntity,
	installTestPluginBundle,
	listRelationshipSchemas,
	requireRelationshipSchemaBySlug,
	trendingSandboxSource,
	providerSandboxSource,
	type InstalledTestPlugin,
	uninstallTestPlugin,
} from "~/fixtures";
import { assertPresent, assertTaggedError, requireObjectRecord } from "~/support/assertions";
import { afterAll, assert, beforeAll, describe, expect, it } from "~/support/effect-test";

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
let movieSchemaId: string;
let trendingPluginSlug: string;
let mediaTrendingSchemaId: string;
let trendingPlugin: InstalledTestPlugin | undefined;

describe("POST /test-support/cron/plugin (media-trending cron)", () => {
	beforeAll(async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				queryClient = client;

				const [{ schema: movieSchema }, relationshipSchemas] = yield* Effect.all([
					findBuiltinSchemaBySlug(client, "movie"),
					listRelationshipSchemas(client, { slugs: ["media-trending"] }),
				]);
				movieSchemaId = movieSchema.id;
				mediaTrendingSchemaId = requireRelationshipSchemaBySlug(
					relationshipSchemas,
					"media-trending",
				).id;

				const detailsEntry = "scripts/provider-details.sandbox.ts";
				const trendingEntry = "scripts/trending.sandbox.ts";
				const installed = yield* installTestPluginBundle({
					configSchema: { fields: {}, unknownKeys: "strict" },
					files: {
						[trendingEntry]: TRENDING_SOURCE,
						[detailsEntry]: providerSandboxSource({
							operation: "details",
							slug: DETAILS_SCRIPT_SLUG,
							name: "E2E Test Trending Provider details",
							result: fakeProviderDetailsResult({ name: "E2E Test Trending Provider" }),
						}),
					},
					linkToEntitySchemaSlug: movieSchemaId,
					scripts: [
						{
							kind: "provider",
							capabilities: [],
							entry: detailsEntry,
							slug: DETAILS_SCRIPT_SLUG,
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
							providerSlug: PROVIDER_SLUG,
							providerOperation: "details",
							name: "E2E Test Trending Provider details",
						},
						{
							kind: "script",
							slug: SCRIPT_SLUG,
							entry: trendingEntry,
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
							name: "E2E Test Trending",
							providerSlug: PROVIDER_SLUG,
							capabilities: ["upsertGlobalEntities", "upsertGlobalRelationships"],
						},
					],
					providers: [
						{
							slug: PROVIDER_SLUG,
							information: { source: "e2e" },
							name: "E2E Test Trending Provider",
							operations: { details: DETAILS_SCRIPT_SLUG },
						},
					],
				});
				installed.manifest = {
					...installed.manifest,
					crons: [
						{
							scriptSlug: SCRIPT_SLUG,
							slug: "e2e-test-trending",
							schedule: { cron: "0 0 * * *" },
							description: "Refresh E2E trending fixtures",
						},
					],
				};
				yield* getBackendClient().call(
					(c) =>
						c.plugins.install({
							payload: { files: installed.files, manifest: installed.manifest },
						}),
					adminHeaders,
				);
				const directScriptId = installed.scriptIds[SCRIPT_SLUG];
				assertPresent(directScriptId, "Trending direct script was not installed");
				const directScript = yield* getBackendClient().call(
					(c) =>
						c.testSupport.getSandboxScript({
							params: { scriptId: directScriptId },
						}),
					adminHeaders,
				);
				assertPresent(directScript.providerId, "Trending script provider was not stored");
				providerId = directScript.providerId;
				trendingPluginSlug = installed.manifest.metadata.slug;
				trendingPlugin = installed;
			}),
		);
	});

	afterAll(async () => {
		if (trendingPlugin) {
			await Effect.runPromise(uninstallTestPlugin(trendingPlugin));
		}
	});

	it.live("rejects the trigger without a valid admin token", () =>
		Effect.gen(function* () {
			const client = getBackendClient();

			const missing = yield* Effect.flip(
				client.call((c) =>
					c.testSupport.triggerPluginCron({
						payload: {
							cronSlug: "e2e-test-trending",
							pluginSlug: PluginSlug.make(trendingPluginSlug),
						},
					}),
				),
			);
			assertTaggedError(missing, "Unauthorized");

			const wrong = yield* Effect.flip(
				client.call(
					(c) =>
						c.testSupport.triggerPluginCron({
							payload: {
								cronSlug: "e2e-test-trending",
								pluginSlug: PluginSlug.make(trendingPluginSlug),
							},
						}),
					adminAccessTokenHeaders("wrong-token"),
				),
			);
			assertTaggedError(wrong, "Unauthorized");
		}),
	);

	it.live("runs a direct media-trending cron script end-to-end and writes ranked self-edges", () =>
		Effect.gen(function* () {
			const result = yield* getBackendClient().call(
				(c) =>
					c.testSupport.triggerPluginCron({
						payload: {
							cronSlug: "e2e-test-trending",
							pluginSlug: PluginSlug.make(trendingPluginSlug),
						},
					}),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			assert(result.status === "executed");
			const { executionId } = result;
			expect(typeof executionId).toBe("string");
			expect(executionId.length).toBeGreaterThan(0);

			const listCandidates = Effect.gen(function* () {
				const relationships = yield* getBackendClient().call(
					(c) =>
						c.testSupport.listGlobalRelationships({
							payload: {
								type: "self",
								relationshipSchemaSlug: RelationshipSchemaSlug.make(mediaTrendingSchemaId),
							},
						}),
					adminHeaders,
				);
				return yield* Effect.all(
					relationships.map((relationship) =>
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
					),
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
