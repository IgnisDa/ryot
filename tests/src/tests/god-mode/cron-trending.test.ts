import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
	EntitySchemaId,
	RelationshipSchemaId,
	SandboxScriptId,
} from "@ryot/contract/schema/brands";

import {
	ADMIN_TOKEN,
	adminAccessTokenHeaders,
	adminHeaders,
	type Client,
	createAndPromoteSandboxScript,
	createAuthenticatedClient,
	findBuiltinSchemaBySlug,
	getBackendClient,
	getEntity,
	listRelationshipSchemas,
	requireRelationshipSchemaBySlug,
	trendingSandboxSource,
} from "~/fixtures";
import { pollUntil } from "~/fixtures/polling";
import { assertPresent, assertTaggedError, requireObjectRecord } from "~/support/assertions";

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

describe("POST /god-mode/cron/infrequent (media-trending durable workflow)", () => {
	beforeAll(async () => {
		const { client } = await createAuthenticatedClient();
		queryClient = client;

		const [{ schema: movieSchema }, relationshipSchemas] = await Promise.all([
			findBuiltinSchemaBySlug(client, "movie"),
			listRelationshipSchemas(client, { slugs: ["media-trending"] }),
		]);
		movieSchemaId = movieSchema.id;
		mediaTrendingSchemaId = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"media-trending",
		).id;

		const script = await createAndPromoteSandboxScript(client, TRENDING_SOURCE);
		scriptId = script.id;

		await getBackendClient().run(
			(c) =>
				c.testSupport.linkSandboxScriptToEntitySchema({
					path: {
						scriptId: SandboxScriptId.make(scriptId),
						entitySchemaId: EntitySchemaId.make(movieSchemaId),
					},
				}),
			adminHeaders,
		);
	});

	afterAll(async () => {
		try {
			await getBackendClient().run(
				(c) =>
					c.testSupport.deleteSandboxScript({
						path: { scriptId: SandboxScriptId.make(scriptId) },
					}),
				adminHeaders,
			);
		} catch (error) {
			console.error("[god-mode-cron-trending] cleanup failed (non-fatal)", error);
		}
	});

	it("rejects the trigger without a valid admin token", async () => {
		const client = getBackendClient();

		const missing = await client.runError((c) => c.godMode.triggerInfrequentCron());
		assertTaggedError(missing, "Unauthorized");

		const wrong = await client.runError(
			(c) => c.godMode.triggerInfrequentCron(),
			adminAccessTokenHeaders("wrong-token"),
		);
		assertTaggedError(wrong, "Unauthorized");
	});

	it("runs the media-trending workflow end-to-end and writes ranked self-edges", async () => {
		const { executionId } = await getBackendClient().run(
			(c) => c.godMode.triggerInfrequentCron(),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(typeof executionId).toBe("string");
		expect(executionId.length).toBeGreaterThan(0);

		const rows = await pollUntil(
			"media-trending self-edges for seeded provider",
			async () => {
				const relationships = await getBackendClient().run(
					(c) =>
						c.testSupport.listGlobalRelationships({
							payload: {
								type: "self",
								relationshipSchemaId: RelationshipSchemaId.make(mediaTrendingSchemaId),
							},
						}),
					adminHeaders,
				);
				const candidates = await Promise.all(
					relationships.map(async (relationship) => {
						const entity = await getEntity(queryClient, relationship.sourceEntityId);
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
				);
				const matching = candidates
					.filter(
						(row) =>
							row.sandboxScriptId === scriptId &&
							(row.external_id === EXTERNAL_ID_ONE || row.external_id === EXTERNAL_ID_TWO),
					)
					.sort((a, b) => Number(a.rank) - Number(b.rank));
				return matching.length === 2 ? matching : null;
			},
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
	});
});
