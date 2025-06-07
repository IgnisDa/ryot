import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import getPort from "get-port";
import {
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
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
		const { jobId } = await enqueueSandboxScript(client, cookies, {
			code: "return 42;",
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
		const { jobId } = await enqueueSandboxScript(client, cookies, {
			code: `return await httpCall("GET", ${JSON.stringify(httpServerUrl)});`,
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

	it("completes a script that uses executeQuery", async () => {
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
		const { jobId } = await enqueueSandboxScript(client, cookies, {
			code: `
const result = await executeQuery({
  entitySchemaSlugs: [${JSON.stringify(slug)}],
  pagination: { page: 1, limit: 10 },
  sort: { direction: "asc", expression: { type: "reference", reference: { column: "name", type: "entity-column", slug: ${JSON.stringify(slug)} } } }
});
if (!result.success) {
  throw new Error(result.error);
}
return result.data.items;
`,
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

	it("completes a script that uses getUserPreferences", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { jobId } = await enqueueSandboxScript(client, cookies, {
			code: `
const result = await getUserPreferences();
if (!result.success) {
  throw new Error(result.error);
}
return result.data;
`,
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
		expect(prefs.languages.providers).toHaveLength(1);
		expect(prefs.languages.providers[0]?.source).toBe("audible");
		expect(prefs.languages.providers[0]?.preferredLanguage).toBe("US");
	});

	it("returns a completed result when the script throws", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { jobId } = await enqueueSandboxScript(client, cookies, {
			code: 'throw new Error("intentional");',
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
		const { jobId } = await enqueueSandboxScript(client, cookies, {
			code: "{{{",
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
		const { jobId } = await enqueueSandboxScript(clientA, cookiesA, {
			code: "return 42;",
		});

		const { response, error } = await clientB.GET("/sandbox/result/{jobId}", {
			headers: { Cookie: cookiesB },
			params: { path: { jobId } },
		});

		expect(response.status).toBe(404);
		expect(error?.error?.message).toBe("Sandbox job not found");
	});

	it("returns 401 for unauthenticated enqueue", async () => {
		const client = getBackendClient();
		const { response, error } = await client.POST("/sandbox/enqueue", {
			body: { code: "return 42;" },
		});

		expect(response.status).toBe(401);
		expect(error?.error).toBeDefined();
	});

	it("returns 401 for unauthenticated poll", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { jobId } = await enqueueSandboxScript(client, cookies, {
			code: "return 42;",
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

describe("sandbox enqueue by script ID", () => {
	it("returns 404 when the scriptId does not exist", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const { response } = await client.POST("/sandbox/enqueue", {
			headers: { Cookie: cookies },
			body: { kind: "script", scriptId: crypto.randomUUID() },
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
			kind: "script",
			scriptId: searchScriptId,
			context: { page: 1, pageSize: 5, query: "test" },
		});

		const result = await pollSandboxResult(client, cookies, jobId);

		expect(result.status === "completed" || result.status === "failed").toBe(
			true,
		);
	});
});
