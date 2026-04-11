import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	getImportRun,
	pollImportRunUntilTerminal,
	runOpenScaleImportFixture,
	startOpenScaleImport,
	uploadTemporaryFile,
} from "../fixtures";

describe("OpenScale Import E2E", () => {
	it("completes an OpenScale import and creates measurement entities", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { runId, completedRun } = await runOpenScaleImportFixture(client, cookies);

		expect(completedRun.id).toBe(runId);
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

		const run = await getImportRun(client, cookies, runId);
		expect(run.id).toBe(runId);
		expect(run.status).toBe("completed");
	});

	it("lists runs for the current user", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		await runOpenScaleImportFixture(client, cookies);

		const { data, response } = await client.GET("/imports/runs", {
			headers: { Cookie: cookies },
		});

		expect(response.status).toBe(200);
		expect(data?.data.length).toBeGreaterThan(0);
		expect(data?.data[0]?.source).toBe("open_scale");
	});

	it("returns 404 for unknown run id", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { response } = await client.GET("/imports/runs/{runId}", {
			headers: { Cookie: cookies },
			params: { path: { runId: "nonexistent-run-id" } },
		});

		expect(response.status).toBe(404);
	});

	it("rejects an invalid upload token", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { response } = await client.POST("/imports/runs", {
			headers: { Cookie: cookies },
			body: { source: "open_scale", uploadToken: "bogus-token" },
		});

		expect(response.status).toBe(400);
	});

	it("rejects a non-CSV file extension", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const uploadToken = await uploadTemporaryFile(
			cookies,
			'{"data": "not csv"}',
			"export.json",
			"application/json",
		);

		const { response } = await client.POST("/imports/runs", {
			headers: { Cookie: cookies },
			body: { source: "open_scale", uploadToken },
		});

		expect(response.status).toBe(400);
	});

	it("deletes a completed run", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { runId } = await runOpenScaleImportFixture(client, cookies);

		const { response: deleteResponse } = await client.DELETE("/imports/runs/{runId}", {
			params: { path: { runId } },
			headers: { Cookie: cookies },
		});

		expect(deleteResponse.status).toBe(200);

		const { response: getResponse } = await client.GET("/imports/runs/{runId}", {
			params: { path: { runId } },
			headers: { Cookie: cookies },
		});

		expect(getResponse.status).toBe(404);
	});

	it("returns failures for a run with bad rows", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const badCsv = `dateTime,weight\n2026-01-01 08:00:00,75.0\n,invalid-no-date\n2026-01-03 08:00:00,not-a-number\n`;

		const uploadToken = await uploadTemporaryFile(cookies, badCsv, "openscale-bad.csv", "text/csv");

		const runId = await startOpenScaleImport(client, cookies, uploadToken);
		const completedRun = await pollImportRunUntilTerminal(client, cookies, runId);

		expect(completedRun.status).toBe("completed");
		expect(completedRun.failedItems).toBeGreaterThan(0);
		expect(completedRun.importedItems).toBeGreaterThan(0);

		const { data: failuresData, response } = await client.GET("/imports/runs/{runId}/failures", {
			params: { path: { runId } },
			headers: { Cookie: cookies },
			query: { page: 1, limit: 20 },
		});

		expect(response.status).toBe(200);
		expect(failuresData?.data.items.length).toBeGreaterThan(0);
	});
});
