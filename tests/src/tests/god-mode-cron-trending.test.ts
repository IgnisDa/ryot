import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";

import { getBackendClient } from "../fixtures";
import { pollUntil } from "../fixtures/polling";
import { getPgClient } from "../setup";
import { assertPresent, assertTaggedError, requirePresent } from "../test-support/assertions";

const ADMIN_TOKEN = "test-admin-token";
const ADMIN_ACCESS_TOKEN_HEADER = "Admin-Access-Token";

const adminHeaders = (token: string) => ({ [ADMIN_ACCESS_TOKEN_HEADER]: token });

const SCRIPT_SLUG = "movie.e2e-test-trending";
const EXTERNAL_ID_ONE = "e2e-trending-1";
const EXTERNAL_ID_TWO = "e2e-trending-2";

const TRENDING_CODE = `driver("trending", async function () {
	return { items: [
		{ name: "E2E Trending One", externalId: "${EXTERNAL_ID_ONE}" },
		{ name: "E2E Trending Two", externalId: "${EXTERNAL_ID_TWO}" }
	] };
});`;

let scriptId: string;
let movieSchemaId: string;
let entitySchemaSandboxScriptId: string;
let mediaTrendingSchemaId: string;

describe("POST /god-mode/cron/infrequent (media-trending durable workflow)", () => {
	beforeAll(async () => {
		const pg = getPgClient();

		const movieSchema = await pg.query<{ id: string }>(
			`select id from entity_schema
			 where slug = 'movie' and user_id is null and is_builtin = true`,
		);
		movieSchemaId = requirePresent(movieSchema.rows[0], "missing builtin movie schema").id;

		const trendingSchema = await pg.query<{ id: string }>(
			`select id from relationship_schema
			 where slug = 'media-trending' and user_id is null`,
		);
		mediaTrendingSchemaId = requirePresent(
			trendingSchema.rows[0],
			"missing media-trending relationship schema",
		).id;

		scriptId = randomUUID();
		await pg.query(
			`insert into sandbox_script (id, slug, name, code, is_builtin, metadata, user_id)
			 values ($1, $2, $3, $4, true, '{}'::jsonb, null)`,
			[scriptId, SCRIPT_SLUG, "E2E Test Trending", TRENDING_CODE],
		);

		entitySchemaSandboxScriptId = randomUUID();
		await pg.query(
			`insert into entity_schema_sandbox_script (id, entity_schema_id, sandbox_script_id)
			 values ($1, $2, $3)`,
			[entitySchemaSandboxScriptId, movieSchemaId, scriptId],
		);
	});

	afterAll(async () => {
		const pg = getPgClient();
		try {
			await pg.query(
				`delete from relationship r
				 using entity e
				 where r.source_entity_id = e.id and e.sandbox_script_id = $1`,
				[scriptId],
			);
			await pg.query(`delete from entity where sandbox_script_id = $1`, [scriptId]);
			await pg.query(`delete from entity_schema_sandbox_script where id = $1`, [
				entitySchemaSandboxScriptId,
			]);
			await pg.query(`delete from sandbox_script where id = $1`, [scriptId]);
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
			adminHeaders("wrong-token"),
		);
		assertTaggedError(wrong, "Unauthorized");
	});

	it("runs the media-trending workflow end-to-end and writes ranked self-edges", async () => {
		const pg = getPgClient();

		const { executionId } = await getBackendClient().run(
			(c) => c.godMode.triggerInfrequentCron(),
			adminHeaders(ADMIN_TOKEN),
		);
		expect(typeof executionId).toBe("string");
		expect(executionId.length).toBeGreaterThan(0);

		const rows = await pollUntil(
			"media-trending self-edges for seeded provider",
			async () => {
				const result = await pg.query<{
					rank: string | null;
					fetched_at: string | null;
					external_id: string;
				}>(
					`select e.external_id,
						        r.properties->>'rank' as rank,
						        r.properties->>'fetchedAt' as fetched_at
						 from relationship r
						 join entity e on e.id = r.source_entity_id
						 where r.user_id is null
						   and r.source_entity_id = r.target_entity_id
						   and r.relationship_schema_id = $1
						   and e.sandbox_script_id = $2
						   and e.external_id in ($3, $4)
						 order by (r.properties->>'rank')::int asc`,
					[mediaTrendingSchemaId, scriptId, EXTERNAL_ID_ONE, EXTERNAL_ID_TWO],
				);
				return result.rows.length === 2 ? result.rows : null;
			},
			{ timeoutMs: 90_000, intervalMs: 1_000 },
		);

		expect(rows).toHaveLength(2);
		for (const row of rows) {
			expect(row.rank).not.toBeNull();
			expect(row.fetched_at).not.toBeNull();
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
