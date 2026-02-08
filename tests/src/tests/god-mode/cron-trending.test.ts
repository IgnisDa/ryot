import { RelationshipSchemaSlug } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	ADMIN_TOKEN,
	adminAccessTokenHeaders,
	adminHeaders,
	type Client,
	createAuthenticatedClient,
	findBuiltinSchemaBySlug,
	getBackendClient,
	getEntity,
	installTestPlugin,
	listRelationshipSchemas,
	requireRelationshipSchemaBySlug,
	trendingSandboxSource,
	pollUntil,
	type InstalledTestPlugin,
	uninstallTestPlugin,
} from "~/fixtures";
import { assertPresent, assertTaggedError, requireObjectRecord } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";

const SCRIPT_SLUG = "movie.e2e-test-trending";
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

let scriptId: string;
let queryClient: Client;
let movieSchemaId: string;
let mediaTrendingSchemaId: string;
let trendingPlugin: InstalledTestPlugin | undefined;

describe("POST /test-support/cron/infrequent (media-trending durable workflow)", () => {
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

				trendingPlugin = yield* installTestPlugin({
					source: TRENDING_SOURCE,
					linkToEntitySchemaSlug: movieSchemaId,
					script: {
						kind: "provider",
						capabilities: [],
						slug: SCRIPT_SLUG,
						name: "E2E Test Trending",
						requiredAppConfigKeys: [],
						providerInformation: { source: "e2e" },
					},
				});
				scriptId = trendingPlugin.scriptId;
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

			const missing = yield* Effect.flip(client.call((c) => c.testSupport.triggerInfrequentCron()));
			assertTaggedError(missing, "Unauthorized");

			const wrong = yield* Effect.flip(
				client.call(
					(c) => c.testSupport.triggerInfrequentCron(),
					adminAccessTokenHeaders("wrong-token"),
				),
			);
			assertTaggedError(wrong, "Unauthorized");
		}),
	);

	it.live("runs the media-trending workflow end-to-end and writes ranked self-edges", () =>
		Effect.gen(function* () {
			const { executionId } = yield* getBackendClient().call(
				(c) => c.testSupport.triggerInfrequentCron(),
				adminAccessTokenHeaders(ADMIN_TOKEN),
			);
			expect(typeof executionId).toBe("string");
			expect(executionId.length).toBeGreaterThan(0);

			const rows = yield* pollUntil(
				"media-trending self-edges for seeded provider",
				Effect.gen(function* () {
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
					const candidates = yield* Effect.all(
						relationships.map((relationship) =>
							Effect.gen(function* () {
								const entity = yield* getEntity(queryClient, relationship.sourceEntityId);
								const properties = requireObjectRecord(
									relationship.properties,
									"Trending relationship properties",
								);
								return {
									rank: properties["rank"],
									external_id: entity.externalId,
									fetched_at: properties["fetchedAt"],
									sandboxScriptId: entity.sandboxScriptId,
								};
							}),
						),
					);
					const matching = candidates
						.filter(
							(row) =>
								row.sandboxScriptId === scriptId &&
								(row.external_id === EXTERNAL_ID_ONE || row.external_id === EXTERNAL_ID_TWO),
						)
						.sort((a, b) => Number(a.rank) - Number(b.rank));
					return matching.length === 2 ? matching : null;
				}),
				{ timeoutMs: 90_000, intervalMs: 1_000 },
			);

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
