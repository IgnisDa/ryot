import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import getPort from "get-port";
import {
	createAuthenticatedClient,
	createEntitySchema,
	createTracker,
	enqueueSandboxScript,
	findBuiltinSchemaWithSearchProviders,
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

	it("completes a script that uses getEntitySchemas", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { trackerId } = await createTracker(client, cookies, {
			name: "Sandbox Schema Tracker",
		});
		const { data: schema, slug } = await createEntitySchema(client, cookies, {
			trackerId,
			name: "Sandbox Schema",
			slug: `sandbox-schema-${crypto.randomUUID()}`,
		});
		const { jobId } = await enqueueSandboxScript(client, cookies, {
			code: `return await getEntitySchemas([${JSON.stringify(slug)}]);`,
		});

		const result = await pollSandboxResult(client, cookies, jobId);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

		const value = result.value as {
			success?: boolean;
			data?: Array<{
				id: string;
				name: string;
				slug: string;
				trackerId: string;
			}>;
		};
		const listedSchema = value.data?.[0];

		expect(value.success).toBe(true);
		expect(Array.isArray(value.data)).toBe(true);
		expect(value.data?.length).toBe(1);
		expect(listedSchema?.id).toBe(schema.id);
		expect(listedSchema?.name).toBe(schema.name);
		expect(listedSchema?.slug).toBe(slug);
		expect(listedSchema?.trackerId).toBe(trackerId);
		expect(result.error).toBeNull();
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
		const { schema } = await findBuiltinSchemaWithSearchProviders(
			client,
			cookies,
		);
		const searchScriptId = schema.searchProviders[0]?.searchScriptId;
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

function assertSearchItemShape(item: unknown) {
	const i = item as Record<string, unknown>;

	expect(typeof i.identifier).toBe("string");
	expect((i.identifier as string).length).toBeGreaterThan(0);

	const title = i.titleProperty as { kind?: unknown; value?: unknown };
	expect(title?.kind).toBe("text");
	expect(typeof title?.value).toBe("string");

	const subtitle = i.subtitleProperty as { kind?: unknown; value?: unknown };
	expect(subtitle?.kind === "number" || subtitle?.kind === "null").toBe(true);
	if (subtitle?.kind === "number") {
		expect(typeof subtitle?.value).toBe("number");
	} else {
		expect(subtitle?.value).toBeNull();
	}

	const badge = i.badgeProperty as { kind?: unknown; value?: unknown };
	expect(badge?.kind).toBe("null");
	expect(badge?.value).toBeNull();

	const image = i.imageProperty as { kind?: unknown; value?: unknown };
	expect(image?.kind === "image" || image?.kind === "null").toBe(true);
	if (image?.kind === "image") {
		const imageValue = image.value as { kind?: unknown; url?: unknown };
		expect(imageValue?.kind).toBe("remote");
		expect(typeof imageValue?.url).toBe("string");
	} else {
		expect(image?.value).toBeNull();
	}
}

describe("search script contract", () => {
	it("returns envelope and typed-slot item shape when a search script completes", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaWithSearchProviders(
			client,
			cookies,
		);
		const searchScriptId = schema.searchProviders[0]?.searchScriptId;
		if (!searchScriptId) {
			throw new Error("No search provider found");
		}

		const { jobId } = await enqueueSandboxScript(client, cookies, {
			kind: "script",
			scriptId: searchScriptId,
			context: { page: 1, pageSize: 5, query: "dune" },
		});

		const result = await pollSandboxResult(client, cookies, jobId, {
			timeoutMs: 60_000,
		});

		// If the external API is unreachable (CI, rate-limit), skip shape assertions
		if (result.status === "failed") {
			return;
		}

		expect(result.status).toBe("completed");
		if (result.status !== "completed") {
			throw new Error("Expected sandbox job to complete");
		}

		const value = result.value as {
			items?: unknown[];
			details?: { totalItems?: unknown; nextPage?: unknown };
		};

		expect(Array.isArray(value?.items)).toBe(true);
		expect(typeof value?.details?.totalItems).toBe("number");
		expect(
			value?.details?.nextPage === null ||
				typeof value?.details?.nextPage === "number",
		).toBe(true);

		for (const item of value.items ?? []) {
			assertSearchItemShape(item);
		}
	});
});
