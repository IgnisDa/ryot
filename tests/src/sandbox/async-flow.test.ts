import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { SandboxScriptId } from "@ryot/contract/schema/brands";

import {
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
	createSandboxScript,
	createTracker,
	enqueueSandboxScript,
	getBackendClient,
	literalSandboxSource,
	pollSandboxResult,
} from "../fixtures";
import { getPgClient } from "../setup";
import {
	assertCompleted,
	assertTaggedError,
	requireArray,
	requireObjectRecord,
	requireString,
} from "../test-support/assertions";
import { type FakeHttpServer, startFakeHttpServer } from "../test-support/fake-http-server";

const requireCompletedSandboxValue = (result: Awaited<ReturnType<typeof pollSandboxResult>>) => {
	assertCompleted(result, "sandbox job");

	expect(result.error).toBeNull();
	return result.value;
};

let httpServerUrl: string;
let httpServer: FakeHttpServer;

beforeAll(async () => {
	httpServer = await startFakeHttpServer(() =>
		Response.json({ ok: true, source: "sandbox-test-server" }),
	);
	httpServerUrl = `${httpServer.url}/sandbox-http-call`;
});

afterAll(() => {
	httpServer.stop();
});

describe("sandbox async flow", () => {
	it("completes a script that returns a plain value", async () => {
		const { client } = await createAuthenticatedClient();
		const slug = `plain-value-${crypto.randomUUID()}`;
		const source = literalSandboxSource({ name: "Plain value", slug, value: 42 });
		const script = await createSandboxScript(client, {
			source,
		});
		const { id: scriptId } = script;
		expect(script).toMatchObject({
			slug,
			source,
			name: "Plain value",
			manifest: {
				slug,
				kind: "script",
				capabilities: [],
				name: "Plain value",
				requiredAppConfigKeys: [],
			},
		});
		expect("compiledCode" in script).toBe(false);
		const stored = await getPgClient().query<{
			source: string;
			metadata: unknown;
			compiledCode: string;
			compiledFormat: number;
		}>(
			`select source, compiled_code as "compiledCode", compiled_format as "compiledFormat", metadata
			 from sandbox_script where id = $1`,
			[scriptId],
		);
		expect(stored.rows[0]).toMatchObject({
			source,
			compiledFormat: 1,
			metadata: script.manifest,
		});
		expect(stored.rows[0]?.compiledCode).toContain(
			"sourceMappingURL=data:application/json;base64,",
		);
		await getPgClient().query(`update sandbox_script set source = $1 where id = $2`, [
			'throw new Error("authored source must not execute");',
			scriptId,
		]);
		const { jobId } = await enqueueSandboxScript(client, {
			scriptId,
			driverName: "main",
		});

		const result = await pollSandboxResult(client, jobId);

		assertCompleted(result, "sandbox job");

		expect(result.value).toBe(42);
		expect(result.error).toBeNull();
	});

	it("returns not found when another user polls the job", async () => {
		const owner = await createAuthenticatedClient();
		const other = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(owner.client, {
			name: "cross-user-job",
			slug: `cross-user-job-${crypto.randomUUID()}`,
			code: 'driver("main", async function() { return 42; });',
		});
		const { jobId } = await enqueueSandboxScript(owner.client, {
			scriptId,
			driverName: "main",
		});

		const error = await other.client.runError((c) => c.sandbox.getResult({ path: { jobId } }));

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Sandbox job not found");
	});

	it("completes a script that uses httpCall", async () => {
		const { client } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, {
			name: "http-call",
			slug: `http-call-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["httpCall"] },
			code: `driver("main", async function() { return await httpCall("GET", ${JSON.stringify(httpServerUrl)}); });`,
		});
		const { jobId } = await enqueueSandboxScript(client, {
			scriptId,
			driverName: "main",
		});

		const value = requireObjectRecord(
			requireCompletedSandboxValue(await pollSandboxResult(client, jobId)),
			"Expected sandbox httpCall result to be an object",
		);
		const data = requireObjectRecord(value.data, "Expected sandbox httpCall data to be an object");
		expect(value.success).toBe(true);
		expect(data.status).toBe(200);
		expect(
			JSON.parse(requireString(data.body, "Expected sandbox httpCall body to be a string")),
		).toEqual({ ok: true, source: "sandbox-test-server" });
	});

	it("completes a script that uses executeQueryEngine", async () => {
		const { client } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, {
			name: "Sandbox Schema Tracker",
		});
		const { data: schema, slug } = await createEntitySchema(client, {
			trackerId,
			name: "Sandbox Schema",
			slug: `sandbox-schema-${crypto.randomUUID()}`,
		});
		await createEntity(client, {
			properties: {},
			name: "Test Entity",
			entitySchemaId: schema.id,
		});
		const { id: scriptId } = await createSandboxScript(client, {
			name: "execute-query-engine",
			slug: `execute-query-engine-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["executeQueryEngine"] },
			code: `
driver("main", async function() {
  const result = await executeQueryEngine({
    source: { type: "entities", alias: "entity", schemas: [${JSON.stringify(slug)}], where: null },
    output: {
      type: "rows",
      pagination: { page: 1, limit: 10 },
      orderBy: [{ order: "asc", expr: { type: "ref", sourceAlias: "entity", field: { type: "system", name: "name" } } }],
      fields: [
        { key: "id", expr: { type: "ref", sourceAlias: "entity", field: { type: "system", name: "id" } } },
        { key: "name", expr: { type: "ref", sourceAlias: "entity", field: { type: "system", name: "name" } } }
      ]
    }
  });
  if (!result.success) {
    throw new Error(result.error);
  }
  return (result.data as { data: { items: unknown[] } }).data.items;
});
`,
		});
		const { jobId } = await enqueueSandboxScript(client, {
			scriptId,
			driverName: "main",
		});

		const value = requireArray(
			requireCompletedSandboxValue(await pollSandboxResult(client, jobId)),
			"Expected executeQueryEngine sandbox result to be an array",
		);
		const first = requireObjectRecord(value[0], "Expected first query engine item to be an object");
		const idField = requireObjectRecord(first.id, "Expected query engine id field to be an object");
		const nameField = requireObjectRecord(
			first.name,
			"Expected query engine name field to be an object",
		);
		expect(Array.isArray(value)).toBe(true);
		expect(value.length).toBe(1);
		expect(nameField.value).toBe("Test Entity");
		expect(idField.value).toBeDefined();
	});

	it("returns an error when executeQueryEngine uses a missing schema slug", async () => {
		const { client } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, {
			name: "execute-query-engine-missing-schema",
			metadata: { allowedHostFunctions: ["executeQueryEngine"] },
			slug: `execute-query-engine-missing-schema-${crypto.randomUUID()}`,
			code: `
driver("main", async function() {
  const result = await executeQueryEngine({
    source: { type: "entities", alias: "entity", schemas: ["does-not-exist"], where: null },
    output: {
      type: "rows",
      fields: [],
      pagination: { page: 1, limit: 10 },
      orderBy: [{ order: "asc", expr: { type: "ref", sourceAlias: "entity", field: { type: "system", name: "name" } } }]
    }
  });
  if (result.success) {
    throw new Error("Expected query-engine request to fail");
  }
  throw new Error(result.error);
});
`,
		});
		const { jobId } = await enqueueSandboxScript(client, {
			scriptId,
			driverName: "main",
		});

		const result = await pollSandboxResult(client, jobId);

		assertCompleted(result, "sandbox job");

		expect(result.error).toMatchObject({
			phase: "execute",
			message: expect.stringContaining("Entity schema 'does-not-exist' not found"),
		});
	});

	it("completes a script that uses getAppConfigValue", async () => {
		const { client } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, {
			name: "get-app-config-value",
			slug: `get-app-config-value-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["getAppConfigValue"] },
			code: `
driver("main", async function() {
  const result = await getAppConfigValue("scheduler.progressUpdateThresholdHours");
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data;
});
`,
		});
		const { jobId } = await enqueueSandboxScript(client, {
			scriptId,
			driverName: "main",
		});

		const value = requireCompletedSandboxValue(await pollSandboxResult(client, jobId));
		expect(typeof value).toBe("number");
		expect(value).toBeGreaterThan(0);
	});

	it("completes a script that uses getUserPreferences", async () => {
		const { client } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, {
			name: "get-user-prefs",
			slug: `get-user-prefs-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["getUserPreferences"] },
			code: `
driver("main", async function() {
  const result = await getUserPreferences();
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data;
});
`,
		});
		const { jobId } = await enqueueSandboxScript(client, { scriptId, driverName: "main" });

		const prefs = requireObjectRecord(
			requireCompletedSandboxValue(await pollSandboxResult(client, jobId)),
			"Expected user preferences sandbox result to be an object",
		);
		expect(prefs.isNsfw).toBe(false);
		expect(prefs.disableIntegrations).toBe(false);
	});

	it("returns a completed result when the script throws", async () => {
		const { client } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, {
			name: "throws-error",
			slug: `throws-error-${crypto.randomUUID()}`,
			code: 'driver("main", async function() { throw new Error("intentional"); });',
		});
		const { jobId } = await enqueueSandboxScript(client, { scriptId, driverName: "main" });

		const result = await pollSandboxResult(client, jobId);

		assertCompleted(result, "sandbox job");

		expect(result.value).toBeNull();
		expect(result.error).toMatchObject({
			phase: "execute",
			message: expect.stringContaining("intentional"),
		});
	});

	it("rejects invalid TypeScript without creating a script row", async () => {
		const { client } = await createAuthenticatedClient();
		const source = "const invalid: number = 'not a number';";
		const error = await client.runError((c) => c.sandbox.createScript({ payload: { source } }));

		assertTaggedError(error, "SandboxCompilationFailure");
		expect(error.diagnostics.length).toBeGreaterThan(0);
		expect(error.diagnostics[0]).toMatchObject({
			file: "script.ts",
			severity: "error",
		});
		expect(error.diagnostics[0]?.line).toBeGreaterThan(0);
		expect(error.diagnostics[0]?.column).toBeGreaterThan(0);

		const rows = await getPgClient().query<{ id: string }>(
			`select id from sandbox_script where source = $1`,
			[source],
		);
		expect(rows.rowCount).toBe(0);
	});

	it("returns 404 for a non-existent job id", async () => {
		const { client } = await createAuthenticatedClient();
		const error = await client.runError((c) =>
			c.sandbox.getResult({ path: { jobId: crypto.randomUUID() } }),
		);

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Sandbox job not found");
	});

	it("returns 404 when another user polls the job", async () => {
		const { client: clientA } = await createAuthenticatedClient();
		const { client: clientB } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(clientA, {
			name: "cross-user-job",
			slug: `cross-user-job-${crypto.randomUUID()}`,
			code: 'driver("main", async function() { return 42; });',
		});
		const { jobId } = await enqueueSandboxScript(clientA, {
			scriptId,
			driverName: "main",
		});

		const error = await clientB.runError((c) => c.sandbox.getResult({ path: { jobId } }));

		assertTaggedError(error, "NotFound");
		expect(error.message).toBe("Sandbox job not found");
	});

	it("returns 401 for unauthenticated enqueue", async () => {
		const client = getBackendClient();
		const error = await client.runError((c) =>
			c.sandbox.enqueue({
				payload: { scriptId: SandboxScriptId.make(crypto.randomUUID()), driverName: "main" },
			}),
		);

		assertTaggedError(error, "Unauthorized");
	});

	it("returns 401 for unauthenticated poll", async () => {
		const { client } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, {
			name: "unauth-poll",
			slug: `unauth-poll-${crypto.randomUUID()}`,
			code: 'driver("main", async function() { return 42; });',
		});
		const { jobId } = await enqueueSandboxScript(client, { scriptId, driverName: "main" });

		const unauthenticatedClient = getBackendClient();
		const error = await unauthenticatedClient.runError((c) =>
			c.sandbox.getResult({ path: { jobId } }),
		);

		assertTaggedError(error, "Unauthorized");
	});
});
