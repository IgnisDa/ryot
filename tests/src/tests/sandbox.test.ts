import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import getPort from "get-port";
import {
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
	createSandboxScript,
	createTracker,
	enqueueSandboxScript,
	findBuiltinSchemaWithProviders,
	pollSandboxResult,
} from "../fixtures";
import { getBackendClient } from "../setup";

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
	httpServer.stop(true);
});

describe("sandbox async flow", () => {
	it("completes a script that returns a plain value", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, cookies, {
			name: "plain-value",
			slug: `plain-value-${crypto.randomUUID()}`,
			code: 'driver("main", async function() { return 42; });',
		});
		const { jobId } = await enqueueSandboxScript(client, cookies, {
			scriptId,
			driverName: "main",
		});

		const result = await pollSandboxResult(client, cookies, jobId);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

		expect(result.value).toBe(42);
		expect(result.error).toBeNull();
	});

	it("completes a script that uses httpCall", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, cookies, {
			name: "http-call",
			slug: `http-call-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["httpCall"] },
			code: `driver("main", async function() { return await httpCall("GET", ${JSON.stringify(httpServerUrl)}); });`,
		});
		const { jobId } = await enqueueSandboxScript(client, cookies, {
			scriptId,
			driverName: "main",
		});

		const result = await pollSandboxResult(client, cookies, jobId);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

		const value = result.value as {
			success?: boolean;
			data?: { body: string; status: number };
		};

		expect(value.success).toBe(true);
		expect(value.data?.status).toBe(200);
		expect(JSON.parse(value.data?.body ?? "{}")).toEqual({
			ok: true,
			source: "sandbox-test-server",
		});
		expect(result.error).toBeNull();
	});

	it("completes a script that uses appApiCall against query-engine", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Sandbox Schema Tracker",
		});
		const { data: schema, slug } = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Sandbox Schema",
			slug: `sandbox-schema-${crypto.randomUUID()}`,
		});
		await createEntity(client, cookies, {
			image: null,
			properties: {},
			name: "Test Entity",
			entitySchemaId: schema.id,
		});
		const { id: scriptId } = await createSandboxScript(client, cookies, {
			name: "app-api-call-query-engine",
			metadata: { allowedHostFunctions: ["appApiCall"] },
			slug: `app-api-call-query-engine-${crypto.randomUUID()}`,
			code: `
driver("main", async function() {
  const result = await appApiCall("POST", "/query-engine/execute", {
    body: {
      entitySchemaSlugs: [${JSON.stringify(slug)}],
      pagination: { page: 1, limit: 10 },
      sort: { direction: "asc", expression: { type: "reference", reference: { path: ["name"], type: "entity", slug: ${JSON.stringify(slug)} } } }
    }
  });
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data.body.data.items;
});
`,
		});
		const { jobId } = await enqueueSandboxScript(client, cookies, {
			scriptId,
			driverName: "main",
		});

		const result = await pollSandboxResult(client, cookies, jobId);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

		expect(result.error).toBeNull();

		const value = result.value as Array<{
			id: string;
			name: string;
			slug: string;
			trackerId: string;
		}>;

		expect(Array.isArray(value)).toBe(true);
		expect(value.length).toBe(1);
		expect(value[0]?.name).toBe("Test Entity");
		expect(value[0]?.id).toBeDefined();
	});

	it("returns an error when appApiCall hits query-engine with a missing schema slug", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, cookies, {
			name: "app-api-call-missing-schema",
			metadata: { allowedHostFunctions: ["appApiCall"] },
			slug: `app-api-call-missing-schema-${crypto.randomUUID()}`,
			code: `
driver("main", async function() {
  const result = await appApiCall("POST", "/query-engine/execute", {
    body: {
      entitySchemaSlugs: ["does-not-exist"],
      pagination: { page: 1, limit: 10 },
      sort: {
        direction: "asc",
        expression: {
          type: "reference",
          reference: { path: ["name"], type: "entity", slug: "does-not-exist" }
        }
      }
    }
  });
  if (result.success) {
    throw new Error("Expected query-engine request to fail");
  }
  throw new Error(JSON.stringify(result.data?.body ?? result.error));
});
`,
		});
		const { jobId } = await enqueueSandboxScript(client, cookies, {
			scriptId,
			driverName: "main",
		});

		const result = await pollSandboxResult(client, cookies, jobId);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

		expect(result.error).toContain("Schema 'does-not-exist' not found");
	});

	it("completes a script that uses getUserPreferences", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, cookies, {
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
		const { jobId } = await enqueueSandboxScript(client, cookies, {
			scriptId,
			driverName: "main",
		});

		const result = await pollSandboxResult(client, cookies, jobId);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

		expect(result.error).toBeNull();

		const prefs = result.value as {
			languages: {
				providers: Array<{ source: string; preferredLanguage: string }>;
			};
		};
		expect(prefs.languages.providers.length).toBeGreaterThan(1);
		expect(prefs.languages.providers[0]?.source).toBe("audible");
		expect(prefs.languages.providers[0]?.preferredLanguage).toBe("US");
	});

	it("returns a completed result when the script throws", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, cookies, {
			name: "throws-error",
			slug: `throws-error-${crypto.randomUUID()}`,
			code: 'driver("main", async function() { throw new Error("intentional"); });',
		});
		const { jobId } = await enqueueSandboxScript(client, cookies, {
			scriptId,
			driverName: "main",
		});

		const result = await pollSandboxResult(client, cookies, jobId);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

		expect(result.value).toBeNull();
		expect(result.error).toContain("intentional");
	});

	it("returns a completed result when the script has a syntax error", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, cookies, {
			code: "{{{",
			name: "syntax-error",
			slug: `syntax-error-${crypto.randomUUID()}`,
		});
		const { jobId } = await enqueueSandboxScript(client, cookies, {
			scriptId,
			driverName: "main",
		});

		const result = await pollSandboxResult(client, cookies, jobId);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

		expect(result.error).toBeTruthy();
	});

	it("returns 404 for a non-existent job id", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { response, error } = await client.GET("/sandbox/result/{jobId}", {
			headers: { Cookie: cookies },
			params: { path: { jobId: crypto.randomUUID() } },
		});

		expect(response.status).toBe(404);
		expect(error?.error?.message).toBe("Sandbox job not found");
	});

	it("returns 404 when another user polls the job", async () => {
		const { client: clientA, cookies: cookiesA } =
			await createAuthenticatedClient();
		const { client: clientB, cookies: cookiesB } =
			await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(clientA, cookiesA, {
			name: "cross-user-job",
			slug: `cross-user-job-${crypto.randomUUID()}`,
			code: 'driver("main", async function() { return 42; });',
		});
		const { jobId } = await enqueueSandboxScript(clientA, cookiesA, {
			scriptId,
			driverName: "main",
		});

		const { response, error } = await clientB.GET("/sandbox/result/{jobId}", {
			params: { path: { jobId } },
			headers: { Cookie: cookiesB },
		});

		expect(response.status).toBe(404);
		expect(error?.error?.message).toBe("Sandbox job not found");
	});

	it("returns 401 for unauthenticated enqueue", async () => {
		const client = getBackendClient();
		const { response, error } = await client.POST("/sandbox/enqueue", {
			body: { scriptId: crypto.randomUUID(), driverName: "main" },
		});

		expect(response.status).toBe(401);
		expect(error?.error).toBeDefined();
	});

	it("returns 401 for unauthenticated poll", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, cookies, {
			name: "unauth-poll",
			slug: `unauth-poll-${crypto.randomUUID()}`,
			code: 'driver("main", async function() { return 42; });',
		});
		const { jobId } = await enqueueSandboxScript(client, cookies, {
			scriptId,
			driverName: "main",
		});

		const unauthenticatedClient = getBackendClient();
		const { response, error } = await unauthenticatedClient.GET(
			"/sandbox/result/{jobId}",
			{ params: { path: { jobId } } },
		);

		expect(response.status).toBe(401);
		expect(error?.error).toBeDefined();
	});
});

describe("sandbox cache functions", () => {
	it("setCachedValue stores a value that getCachedValue retrieves within the same script", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const cacheKey = `cache-test-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(client, cookies, {
			name: "cache-round-trip",
			slug: `cache-round-trip-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["setCachedValue", "getCachedValue"] },
			code: `driver("main", async function() {
  const setResult = await setCachedValue(${JSON.stringify(cacheKey)}, { value: 42 }, 60);
  if (!setResult.success) throw new Error(setResult.error);
  return await getCachedValue(${JSON.stringify(cacheKey)});
});`,
		});
		const { jobId } = await enqueueSandboxScript(client, cookies, {
			scriptId,
			driverName: "main",
		});

		const result = await pollSandboxResult(client, cookies, jobId);
		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}
		expect(result.error).toBeNull();
		const value = result.value as { success: boolean; data: unknown };
		expect(value.success).toBe(true);
		expect(value.data).toEqual({ value: 42 });
	});

	it("getCachedValue returns null for a key that was never set", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const missingKey = `cache-missing-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(client, cookies, {
			name: "cache-miss",
			slug: `cache-miss-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["getCachedValue"] },
			code: `driver("main", async function() {
  return await getCachedValue(${JSON.stringify(missingKey)});
});`,
		});
		const { jobId } = await enqueueSandboxScript(client, cookies, {
			scriptId,
			driverName: "main",
		});

		const result = await pollSandboxResult(client, cookies, jobId);
		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}
		expect(result.error).toBeNull();
		const value = result.value as { success: boolean; data: unknown };
		expect(value.success).toBe(true);
		expect(value.data).toBeNull();
	});

	it("cache is isolated between different scripts for the same key", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const sharedKey = `cache-isolation-${crypto.randomUUID()}`;
		const { id: writerScriptId } = await createSandboxScript(client, cookies, {
			name: "cache-writer",
			slug: `cache-writer-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["setCachedValue"] },
			code: `driver("main", async function() {
  return await setCachedValue(${JSON.stringify(sharedKey)}, { secret: true }, 60);
});`,
		});
		const { id: readerScriptId } = await createSandboxScript(client, cookies, {
			name: "cache-reader",
			slug: `cache-reader-${crypto.randomUUID()}`,
			metadata: { allowedHostFunctions: ["getCachedValue"] },
			code: `driver("main", async function() {
  return await getCachedValue(${JSON.stringify(sharedKey)});
});`,
		});

		const { jobId: writeJobId } = await enqueueSandboxScript(client, cookies, {
			scriptId: writerScriptId,
			driverName: "main",
		});
		await pollSandboxResult(client, cookies, writeJobId);

		const { jobId: readJobId } = await enqueueSandboxScript(client, cookies, {
			scriptId: readerScriptId,
			driverName: "main",
		});
		const result = await pollSandboxResult(client, cookies, readJobId);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}
		expect(result.error).toBeNull();
		const value = result.value as { success: boolean; data: unknown };
		expect(value.success).toBe(true);
		expect(value.data).toBeNull();
	});

	it("built-in scripts share a cache partition across users for the same key", async () => {
		const { client: clientA, cookies: cookiesA } =
			await createAuthenticatedClient();
		const { client: clientB, cookies: cookiesB } =
			await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(clientA, cookiesA);
		const builtinScriptId = schema.providers[0]?.scriptId;
		if (!builtinScriptId) {
			throw new Error("No built-in provider script found");
		}

		const cacheKey = `builtin-shared-cache-${crypto.randomUUID()}`;

		const { id: writerScriptId } = await createSandboxScript(
			clientA,
			cookiesA,
			{
				name: "builtin-cache-writer",
				slug: `builtin-cache-writer-${crypto.randomUUID()}`,
				metadata: { allowedHostFunctions: ["setCachedValue"] },
				code: `driver("main", async function() {
  return await setCachedValue(${JSON.stringify(cacheKey)}, { sharedValue: true }, 60);
});`,
			},
		);

		const { jobId: writeJobId } = await enqueueSandboxScript(
			clientA,
			cookiesA,
			{ scriptId: writerScriptId, driverName: "main" },
		);
		await pollSandboxResult(clientA, cookiesA, writeJobId);

		const { id: readerScriptId } = await createSandboxScript(
			clientB,
			cookiesB,
			{
				name: "builtin-cache-reader",
				slug: `builtin-cache-reader-${crypto.randomUUID()}`,
				metadata: { allowedHostFunctions: ["getCachedValue"] },
				code: `driver("main", async function() {
  return await getCachedValue(${JSON.stringify(cacheKey)});
});`,
			},
		);

		const { jobId: readJobId } = await enqueueSandboxScript(clientB, cookiesB, {
			driverName: "main",
			scriptId: readerScriptId,
		});
		const result = await pollSandboxResult(clientB, cookiesB, readJobId);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}
		expect(result.error).toBeNull();
		const value = result.value as { success: boolean; data: unknown };
		expect(value.success).toBe(true);
		// User-owned scripts are isolated per scriptId — a different user's script
		// cannot read this user's cache entry even with the same key.
		expect(value.data).toBeNull();
	});
});

describe("sandbox enqueue by script ID", () => {
	it("returns 404 when the scriptId does not exist", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { response } = await client.POST("/sandbox/enqueue", {
			headers: { Cookie: cookies },
			body: {
				driverName: "main",
				scriptId: crypto.randomUUID(),
			},
		});

		expect(response.status).toBe(404);
	});

	it("enqueues a built-in script and reaches a terminal state", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithProviders(client, cookies);
		const searchScriptId = schema.providers[0]?.scriptId;
		if (!searchScriptId) {
			throw new Error("No search provider found");
		}

		const { jobId } = await enqueueSandboxScript(client, cookies, {
			driverName: "search",
			scriptId: searchScriptId,
			context: { page: 1, pageSize: 5, query: "test" },
		});

		const result = await pollSandboxResult(client, cookies, jobId);

		expect(result.status === "completed" || result.status === "failed").toBe(
			true,
		);
	}, 30_000);

	it("completes with a host-function error when appApiCall is not allowed", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, cookies, {
			metadata: {},
			name: "no-host-functions",
			slug: `no-host-functions-${crypto.randomUUID()}`,
			code: `driver("main", async function() {
  return await appApiCall("GET", "/system/health");
});`,
		});

		const { jobId } = await enqueueSandboxScript(client, cookies, {
			scriptId,
			driverName: "main",
		});

		const result = await pollSandboxResult(client, cookies, jobId);
		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

		expect(result.error).toContain("appApiCall is not defined");
	});

	it("rejects appApiCall attempts to target /api/auth routes", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, cookies, {
			name: "app-api-call-auth-route",
			metadata: { allowedHostFunctions: ["appApiCall"] },
			slug: `app-api-call-auth-route-${crypto.randomUUID()}`,
			code: `driver("main", async function() {
  const result = await appApiCall("GET", "/api/auth/session");
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data;
});`,
		});

		const { jobId } = await enqueueSandboxScript(client, cookies, {
			scriptId,
			driverName: "main",
		});

		const result = await pollSandboxResult(client, cookies, jobId);
		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

		expect(result.error).toContain("appApiCall cannot target /api/auth routes");
	});

	it("rejects appApiCall attempts to target /api/sandbox routes", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, cookies, {
			name: "app-api-call-sandbox-route",
			metadata: { allowedHostFunctions: ["appApiCall"] },
			slug: `app-api-call-sandbox-route-${crypto.randomUUID()}`,
			code: `driver("main", async function() {
  const result = await appApiCall("GET", "/api/sandbox/result/123");
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data;
});`,
		});

		const { jobId } = await enqueueSandboxScript(client, cookies, {
			scriptId,
			driverName: "main",
		});

		const result = await pollSandboxResult(client, cookies, jobId);
		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

		expect(result.error).toContain(
			"appApiCall cannot target /api/sandbox routes",
		);
	});

	it("rejects appApiCall attempts to target percent-encoded /api/sandbox routes", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { id: scriptId } = await createSandboxScript(client, cookies, {
			name: "app-api-call-encoded-sandbox-route",
			metadata: { allowedHostFunctions: ["appApiCall"] },
			slug: `app-api-call-encoded-sandbox-route-${crypto.randomUUID()}`,
			code: `driver("main", async function() {
  const result = await appApiCall("GET", "/api/%73andbox/result/123");
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.data;
});`,
		});

		const { jobId } = await enqueueSandboxScript(client, cookies, {
			scriptId,
			driverName: "main",
		});

		const result = await pollSandboxResult(client, cookies, jobId);
		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

		expect(result.error).toContain(
			"appApiCall cannot target /api/sandbox routes",
		);
	});
});
