import { describe, expect, it } from "bun:test";

import { ImportRunId } from "@ryot/app-backend/schema/brands";
import type { QueryResultRow } from "pg";

import {
	createAuthenticatedClient,
	getImportRun,
	listEventSlugs,
	pollImportRunUntilTerminal,
	runHevyImportFixture,
	runOpenScaleImportFixture,
	startOpenScaleImport,
	uploadTemporaryFile,
	waitForEventSlugs,
} from "../fixtures";
import { getPgClient } from "../setup";
import { assertTaggedError, requirePresent } from "../test-support/assertions";

describe("OpenScale Import E2E", () => {
	it("completes an OpenScale import and creates measurement entities", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { runId, completedRun } = await runOpenScaleImportFixture(client, cookies);

		expect(completedRun.id).toBe(ImportRunId.make(runId));
		expect(completedRun.status).toBe("completed");
		expect(completedRun.source).toBe("open_scale");
		expect(completedRun.importedItems).toBeGreaterThan(0);
		expect(completedRun.totalItems).toBe(3);
		expect(completedRun.failedItems).toBe(0);
		expect(completedRun.progress).toBe(100);
		expect(completedRun.startedAt).not.toBeNull();
		expect(completedRun.finishedAt).not.toBeNull();
	});

	it("returns the run via GET /imports/runs/:id", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { runId } = await runOpenScaleImportFixture(client, cookies);

		const run = await getImportRun(client, runId);
		expect(run.id).toBe(ImportRunId.make(runId));
		expect(run.status).toBe("completed");
	});

	it("lists runs for the current user", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		await runOpenScaleImportFixture(client, cookies);

		const data = await client.run((c) => c.imports.listRuns());

		expect(data.length).toBeGreaterThan(0);
		expect(data[0]?.source).toBe("open_scale");
	});

	it("returns 404 for unknown run id", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.imports.getRun({ path: { runId: ImportRunId.make("nonexistent-run-id") }, urlParams: {} }),
		);

		assertTaggedError(error, "NotFound");
	});

	it("rejects an invalid upload token", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.imports.createRun({ payload: { source: "open_scale", uploadToken: "bogus-token" } }),
		);

		assertTaggedError(error, "BadRequest");
	});

	it("rejects a non-CSV file extension", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const uploadToken = await uploadTemporaryFile(
			cookies,
			'{"data": "not csv"}',
			"export.json",
			"application/octet-stream",
		);

		const error = await client.runError((c) =>
			c.imports.createRun({ payload: { source: "open_scale", uploadToken } }),
		);

		assertTaggedError(error, "BadRequest");
	});

	it("deletes a completed run", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { runId } = await runOpenScaleImportFixture(client, cookies);

		await client.run((c) => c.imports.deleteRun({ path: { runId: ImportRunId.make(runId) } }));

		const error = await client.runError((c) =>
			c.imports.getRun({ path: { runId: ImportRunId.make(runId) }, urlParams: {} }),
		);

		assertTaggedError(error, "NotFound");
	});

	it("returns failures for a run with bad rows", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const badCsv = `dateTime,weight\n2026-01-01 08:00:00,75.0\n,invalid-no-date\n2026-01-03 08:00:00,not-a-number\n`;

		const uploadToken = await uploadTemporaryFile(cookies, badCsv, "openscale-bad.csv", "text/csv");

		const runId = await startOpenScaleImport(client, uploadToken);
		const completedRun = await pollImportRunUntilTerminal(client, runId);

		expect(completedRun.status).toBe("completed");
		expect(completedRun.failedItems).toBeGreaterThan(0);
		expect(completedRun.importedItems).toBeGreaterThan(0);

		const runData = await client.run((c) =>
			c.imports.getRun({
				path: { runId: ImportRunId.make(runId) },
				urlParams: { page: 1, limit: 20 },
			}),
		);

		expect(runData.failures.items.length).toBeGreaterThan(0);
	});
});

describe("Hevy Workout Import E2E", () => {
	it("imports a Hevy workout into exercise/workout entities and events", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { runId, completedRun } = await runHevyImportFixture(client, cookies);

		expect(completedRun.id).toBe(ImportRunId.make(runId));
		expect(completedRun.source).toBe("hevy");
		expect(completedRun.status).toBe("completed");
		expect(completedRun.failedItems).toBe(0);
		expect(completedRun.importedItems).toBeGreaterThan(0);
		expect(completedRun.progress).toBe(100);
	});
});

async function querySingle<T extends QueryResultRow>(sql: string, params: unknown[]): Promise<T> {
	const result = await getPgClient().query<T>(sql, params);
	return requirePresent(result.rows[0], `No row returned for: ${sql}`);
}

describe("Watcharr Show Import E2E (episode resolution)", () => {
	it("attaches per-episode history to the episode entity and drops unresolvable locators", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		// Builtin show schema + its TMDB population script, plus the structural
		// sub-entity schemas/relationships seeded on boot.
		const show = await querySingle<{ schemaId: string; scriptId: string }>(
			`select ess.entity_schema_id as "schemaId", ess.sandbox_script_id as "scriptId"
			 from sandbox_script ss
			 join entity_schema_script ess on ess.sandbox_script_id = ss.id
			 where ss.slug = 'show.tmdb' and ss.user_id is null
			 order by ss.created_at desc limit 1`,
			[],
		);
		const seasonSchema = await querySingle<{ id: string }>(
			`select id from entity_schema where slug = 'show-season' and user_id is null limit 1`,
			[],
		);
		const episodeSchema = await querySingle<{ id: string }>(
			`select id from entity_schema where slug = 'show-episode' and user_id is null limit 1`,
			[],
		);
		const showToSeason = await querySingle<{ id: string }>(
			`select id from relationship_schema where slug = 'show-to-show-season' and user_id is null limit 1`,
			[],
		);
		const seasonToEpisode = await querySingle<{ id: string }>(
			`select id from relationship_schema where slug = 'show-season-to-show-episode' and user_id is null limit 1`,
			[],
		);

		// Pre-seed an already-populated show → season → episode tree so the import
		// resolves the episode positionally without any external provider calls.
		const tmdbId = String(Math.floor(Math.random() * 1_000_000_000));
		const showId = crypto.randomUUID();
		const seasonId = crypto.randomUUID();
		const episodeId = crypto.randomUUID();
		const pg = getPgClient();
		await pg.query(
			`insert into entity (id, name, external_id, entity_schema_id, sandbox_script_id, user_id, populated_at, properties)
			 values
			 ($1,'Test Show',$2,$3,$4,null,now(),'{"totalSeasons":1,"totalEpisodes":1}'::jsonb),
			 ($5,'Season 1',$6,$7,$4,null,now(),'{"seasonNumber":1}'::jsonb),
			 ($8,'Episode 2',$9,$10,$4,null,now(),'{"seasonNumber":1,"episodeNumber":2}'::jsonb)`,
			[
				showId,
				tmdbId,
				show.schemaId,
				show.scriptId,
				seasonId,
				`season-${tmdbId}`,
				seasonSchema.id,
				episodeId,
				`ep-${tmdbId}`,
				episodeSchema.id,
			],
		);
		await pg.query(
			`insert into relationship (id, source_entity_id, target_entity_id, relationship_schema_id, user_id)
			 values ($1,$2,$3,$4,null), ($5,$6,$7,$8,null)`,
			[
				crypto.randomUUID(),
				showId,
				seasonId,
				showToSeason.id,
				crypto.randomUUID(),
				seasonId,
				episodeId,
				seasonToEpisode.id,
			],
		);

		// One resolvable watched episode (S1E2) and one unresolvable locator (S1E99).
		const watcharrExport = JSON.stringify([
			{
				rating: 0,
				activity: [],
				thoughts: "",
				pinned: false,
				status: "WATCHING",
				content: { type: "tv", title: "Test Show", tmdbId: Number(tmdbId) },
				watchedEpisodes: [
					{
						seasonNumber: 1,
						episodeNumber: 2,
						status: "FINISHED",
						createdAt: "2026-01-01T00:00:00Z",
					},
					{
						seasonNumber: 1,
						episodeNumber: 99,
						status: "FINISHED",
						createdAt: "2026-01-01T00:00:00Z",
					},
				],
			},
		]);
		const uploadToken = await uploadTemporaryFile(
			cookies,
			watcharrExport,
			"watcharr.json",
			"application/json",
		);
		const created = await client.run((c) =>
			c.imports.createRun({ payload: { source: "watcharr", uploadToken } }),
		);
		const completedRun = await pollImportRunUntilTerminal(client, created.id);

		expect(completedRun.status).toBe("completed");
		expect(completedRun.progress).toBe(100);

		// The resolvable episode's progress lands on the episode, never the show.
		const episodeEvents = await waitForEventSlugs(episodeId, "progress");
		const showEvents = await listEventSlugs(showId);
		expect(episodeEvents).toContain("progress");
		expect(showEvents).not.toContain("progress");

		// The unresolvable locator is reported as a failure, not mis-attached.
		const runWithFailures = await client.run((c) =>
			c.imports.getRun({
				urlParams: { page: 1, limit: 20 },
				path: { runId: ImportRunId.make(created.id) },
			}),
		);
		const failureMessages = runWithFailures.failures.items.map((failure) => failure.message);
		expect(failureMessages.some((message) => message.includes("S1E99"))).toBe(true);
	}, 60_000);
});
