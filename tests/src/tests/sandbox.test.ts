import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { SandboxScriptId } from "@ryot/app-backend/schema/brands";
import getPort from "get-port";

import {
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
	createSandboxScript,
	createTracker,
	enqueueSandboxScript,
	findBuiltinSchemaWithProviders,
	getBackendClient,
	getFirstProviderScriptId,
	pollSandboxResult,
} from "../fixtures";
import {
	assertPresent,
	assertTaggedError,
	requireArray,
	requireObjectRecord,
	requireString,
} from "../test-support/assertions";

const requireCompletedSandboxValue = (result: Awaited<ReturnType<typeof pollSandboxResult>>) => {
	expect(result.status).toBe("completed");
	if (result.status !== "completed") {
		throw new Error("Expected sandbox job to complete");
	}

	expect(result.error).toBeNull();
	return result.value;
};

let httpServerUrl: string;
let httpServer: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
	const port = await getPort();
	httpServer = Bun.serve({
		port,
		hostname: "127.0.0.1",
		fetch() {
			return Response.json({ ok: true, source: "sandbox-test-server" });
		},
	});
	httpServerUrl = `http://127.0.0.1:${port}/sandbox-http-call`;
});

afterAll(() => {
	void httpServer.stop(true);
});

describe("sandbox async flow", () => {
	it("completes a script that returns a plain value", async () => {
		const { client } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, {
			name: "plain-value",
			slug: `plain-value-${crypto.randomUUID()}`,
			code: 'driver("main", async function() { return 42; });',
		});
		const { jobId } = await enqueueSandboxScript(client, {
			scriptId,
			driverName: "main",
		});

		const result = await pollSandboxResult(client, jobId);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

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
			image: null,
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
    version: 2,
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
  return result.data.data.items;
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
    version: 2,
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

		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

		expect(result.error).toContain("Entity schema 'does-not-exist' not found");
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
		const languages = requireObjectRecord(prefs.languages, "Expected languages to be an object");
		const providers = requireArray(
			languages.providers,
			"Expected languages providers to be an array",
		).map((provider) => requireObjectRecord(provider, "Expected provider to be an object"));
		expect(providers.length).toBeGreaterThan(1);
		expect(providers[0]?.source).toBe("audible");
		expect(providers[0]?.preferredLanguage).toBe("US");
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

		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

		expect(result.value).toBeNull();
		expect(result.error).toContain("intentional");
	});

	it("returns a completed result when the script has a syntax error", async () => {
		const { client } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, {
			code: "{{{",
			name: "syntax-error",
			slug: `syntax-error-${crypto.randomUUID()}`,
		});
		const { jobId } = await enqueueSandboxScript(client, { scriptId, driverName: "main" });

		const result = await pollSandboxResult(client, jobId);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

		expect(result.error).toBeTruthy();
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

describe("sandbox cache functions", () => {
	it("setCachedValue stores a value that getCachedValue retrieves within the same script", async () => {
		const { client } = await createAuthenticatedClient();
		const cacheKey = `cache-test-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(client, {
			name: "cache-round-trip",
			slug: `cache-round-trip-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["setCachedValue", "getCachedValue"] },
			code: `driver("main", async function() {
  const setResult = await setCachedValue(${JSON.stringify(cacheKey)}, { value: 42 }, 60);
  if (!setResult.success) throw new Error(setResult.error);
  return await getCachedValue(${JSON.stringify(cacheKey)});
});`,
		});
		const { jobId } = await enqueueSandboxScript(client, {
			scriptId,
			driverName: "main",
		});

		const value = requireObjectRecord(
			requireCompletedSandboxValue(await pollSandboxResult(client, jobId)),
			"Expected cache write result to be an object",
		);
		expect(value.success).toBe(true);
		expect(value.data).toEqual({ value: 42 });
	});

	it("getCachedValue returns null for a key that was never set", async () => {
		const { client } = await createAuthenticatedClient();
		const missingKey = `cache-missing-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(client, {
			name: "cache-miss",
			slug: `cache-miss-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["getCachedValue"] },
			code: `driver("main", async function() {
  return await getCachedValue(${JSON.stringify(missingKey)});
});`,
		});
		const { jobId } = await enqueueSandboxScript(client, {
			scriptId,
			driverName: "main",
		});

		const value = requireObjectRecord(
			requireCompletedSandboxValue(await pollSandboxResult(client, jobId)),
			"Expected cache miss result to be an object",
		);
		expect(value.success).toBe(true);
		expect(value.data).toBeNull();
	});

	it("cache is isolated between different scripts for the same key", async () => {
		const { client } = await createAuthenticatedClient();
		const sharedKey = `cache-isolation-${crypto.randomUUID()}`;
		const { id: writerScriptId } = await createSandboxScript(client, {
			name: "cache-writer",
			slug: `cache-writer-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["setCachedValue"] },
			code: `driver("main", async function() {
  return await setCachedValue(${JSON.stringify(sharedKey)}, { secret: true }, 60);
});`,
		});
		const { id: readerScriptId } = await createSandboxScript(client, {
			name: "cache-reader",
			slug: `cache-reader-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["getCachedValue"] },
			code: `driver("main", async function() {
  return await getCachedValue(${JSON.stringify(sharedKey)});
});`,
		});

		const { jobId: writeJobId } = await enqueueSandboxScript(client, {
			scriptId: writerScriptId,
			driverName: "main",
		});
		await pollSandboxResult(client, writeJobId);

		const { jobId: readJobId } = await enqueueSandboxScript(client, {
			scriptId: readerScriptId,
			driverName: "main",
		});
		const value = requireObjectRecord(
			requireCompletedSandboxValue(await pollSandboxResult(client, readJobId)),
			"Expected cache isolation read result to be an object",
		);
		expect(value.success).toBe(true);
		expect(value.data).toBeNull();
	});

	it("built-in scripts share a cache partition across users for the same key", async () => {
		const { client: clientA } = await createAuthenticatedClient();
		const { client: clientB } = await createAuthenticatedClient();

		const cacheKey = `builtin-shared-cache-${crypto.randomUUID()}`;

		const { id: writerScriptId } = await createSandboxScript(clientA, {
			name: "builtin-cache-writer",
			slug: `builtin-cache-writer-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["setCachedValue"] },
			code: `driver("main", async function() {
  return await setCachedValue(${JSON.stringify(cacheKey)}, { sharedValue: true }, 60);
});`,
		});

		const { jobId: writeJobId } = await enqueueSandboxScript(clientA, {
			scriptId: writerScriptId,
			driverName: "main",
		});
		await pollSandboxResult(clientA, writeJobId);

		const { id: readerScriptId } = await createSandboxScript(clientB, {
			name: "builtin-cache-reader",
			slug: `builtin-cache-reader-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["getCachedValue"] },
			code: `driver("main", async function() {
  return await getCachedValue(${JSON.stringify(cacheKey)});
});`,
		});

		const { jobId: readJobId } = await enqueueSandboxScript(clientB, {
			driverName: "main",
			scriptId: readerScriptId,
		});
		const value = requireObjectRecord(
			requireCompletedSandboxValue(await pollSandboxResult(clientB, readJobId)),
			"Expected cross-user cache result to be an object",
		);
		expect(value.success).toBe(true);
		// User-owned scripts are isolated per scriptId — a different user's script
		// cannot read this user's cache entry even with the same key.
		expect(value.data).toBeNull();
	});
});

describe("sandbox enqueue by script ID", () => {
	it("returns 404 when the scriptId does not exist", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.sandbox.enqueue({
				payload: { driverName: "main", scriptId: SandboxScriptId.make(crypto.randomUUID()) },
			}),
		);

		assertTaggedError(error, "NotFound");
	});

	it("enqueues a built-in script and reaches a terminal state", async () => {
		const { client } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client);
		const searchScriptId = getFirstProviderScriptId(schema);

		const { jobId } = await enqueueSandboxScript(client, {
			driverName: "search",
			scriptId: searchScriptId,
			context: { page: 1, pageSize: 5, query: "test" },
		});

		const result = await pollSandboxResult(client, jobId);
		expect(result.status).not.toBe("pending");
	}, 30_000);

	it("completes with a host-function error when executeQueryEngine is not allowed", async () => {
		const { client } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, {
			metadata: {},
			name: "no-host-functions",
			slug: `no-host-functions-${crypto.randomUUID()}`,
			code: `driver("main", async function() {
  return await executeQueryEngine({ version: 2, source: { type: "entities", alias: "entity", schemas: ["movie"], where: null }, output: { type: "rows", fields: [], pagination: { page: 1, limit: 1 }, orderBy: [{ order: "asc", expr: { type: "ref", sourceAlias: "entity", field: { type: "system", name: "name" } } }] } });
});`,
		});

		const { jobId } = await enqueueSandboxScript(client, { scriptId, driverName: "main" });

		const result = await pollSandboxResult(client, jobId);
		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

		expect(result.error).toContain("executeQueryEngine is not defined");
	});
});

describe("sandbox result observability", () => {
	it("completed result includes timing with totalMs and executionMs", async () => {
		const { client } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, {
			name: "observability-check",
			slug: `observability-check-${crypto.randomUUID()}`,
			code: 'driver("main", async function() { return true; });',
		});
		const { jobId } = await enqueueSandboxScript(client, { scriptId, driverName: "main" });

		const result = await pollSandboxResult(client, jobId);
		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

		assertPresent(result.timing, "Expected timing to be present");
		expect(result.timing.totalMs).toBeGreaterThan(0);
		expect(result.timing.executionMs).toBeGreaterThanOrEqual(0);
	});
});
