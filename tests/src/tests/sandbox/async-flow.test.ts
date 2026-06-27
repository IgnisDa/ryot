import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { SandboxScriptId, UserId } from "@ryot/contract/schema/brands";

import {
	afterCreateTriggerSource,
	appConfigSandboxSource,
	adminHeaders,
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
	createSandboxScript,
	createTracker,
	enqueueSandboxScript,
	getBackendClient,
	httpCallSandboxSource,
	invalidTypeScriptSandboxSource,
	literalSandboxSource,
	pollSandboxResult,
	queryEngineSandboxSource,
	requireCompletedSandboxValue,
	throwingSandboxSource,
	userPreferencesSandboxSource,
} from "~/fixtures";
import {
	assertCompleted,
	assertTaggedError,
	requireArray,
	requireObjectRecord,
	requireString,
} from "~/support/assertions";
import { type FakeHttpServer, startFakeHttpServer } from "~/support/fake-http-server";

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
		const stored = await getBackendClient().run(
			(c) =>
				c.testSupport.getSandboxScript({
					path: { scriptId: SandboxScriptId.make(scriptId) },
				}),
			adminHeaders,
		);
		expect(stored).toMatchObject({
			source,
			compiledFormat: 1,
			metadata: script.manifest,
		});
		expect(stored.compiledCode).toContain("sourceMappingURL=data:application/json;base64,");
		await getBackendClient().run(
			(c) =>
				c.testSupport.patchSandboxScript({
					path: { scriptId: SandboxScriptId.make(scriptId) },
					payload: { source: 'throw new Error("authored source must not execute");' },
				}),
			adminHeaders,
		);
		const { jobId } = await enqueueSandboxScript(client, { scriptId, driverName: "main" });

		const result = await pollSandboxResult(client, jobId);

		assertCompleted(result, "sandbox job");

		expect(result.value).toBe(42);
		expect(result.error).toBeNull();
	});

	it("compiles an after-create trigger module through script creation", async () => {
		const { client } = await createAuthenticatedClient();
		const slug = `after-create-trigger-${crypto.randomUUID()}`;
		const source = afterCreateTriggerSource({ name: "After-create trigger", slug });

		const script = await createSandboxScript(client, { source });

		expect(script).toMatchObject({
			slug,
			source,
			name: "After-create trigger",
			manifest: {
				slug,
				kind: "trigger",
				mode: "after_create",
				capabilities: [],
				name: "After-create trigger",
				requiredAppConfigKeys: [],
			},
		});
	});

	it("returns not found when another user polls the job", async () => {
		const owner = await createAuthenticatedClient();
		const other = await createAuthenticatedClient();
		const slug = `cross-user-job-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(owner.client, {
			source: literalSandboxSource({ name: "cross-user-job", slug, value: 42 }),
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
		const slug = `http-call-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(client, {
			source: httpCallSandboxSource({ name: "http-call", slug, url: httpServerUrl }),
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
		const sandboxSlug = `execute-query-engine-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(client, {
			source: queryEngineSandboxSource({
				slug: sandboxSlug,
				name: "execute-query-engine",
				query: {
					source: { type: "entities", alias: "entity", schemas: [slug], where: null },
					output: {
						type: "rows",
						pagination: { page: 1, limit: 10 },
						orderBy: [
							{
								order: "asc",
								expr: {
									type: "ref",
									sourceAlias: "entity",
									field: { type: "system", name: "name" },
								},
							},
						],
						fields: [
							{
								key: "id",
								expr: {
									type: "ref",
									sourceAlias: "entity",
									field: { type: "system", name: "id" },
								},
							},
							{
								key: "name",
								expr: {
									type: "ref",
									sourceAlias: "entity",
									field: { type: "system", name: "name" },
								},
							},
						],
					},
				},
			}),
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
		expect(value.length).toBe(1);
		expect(nameField.value).toBe("Test Entity");
		expect(idField.value).toBeDefined();
	});

	it("returns an error when executeQueryEngine uses a missing schema slug", async () => {
		const { client } = await createAuthenticatedClient();
		const slug = `execute-query-engine-missing-schema-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(client, {
			source: queryEngineSandboxSource({
				name: "execute-query-engine-missing-schema",
				slug,
				query: {
					source: { where: null, alias: "entity", type: "entities", schemas: ["does-not-exist"] },
					output: {
						fields: [],
						type: "rows",
						pagination: { page: 1, limit: 10 },
						orderBy: [
							{
								order: "asc",
								expr: {
									type: "ref",
									sourceAlias: "entity",
									field: { type: "system", name: "name" },
								},
							},
						],
					},
				},
			}),
		});
		const { jobId } = await enqueueSandboxScript(client, { scriptId, driverName: "main" });

		const result = await pollSandboxResult(client, jobId);

		assertCompleted(result, "sandbox job");

		expect(result.error).toMatchObject({
			phase: "execute",
			message: expect.stringContaining("Entity schema 'does-not-exist' not found"),
		});
	});

	it("completes a script that uses getAppConfigValue", async () => {
		const { client } = await createAuthenticatedClient();
		const slug = `get-app-config-value-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(client, {
			source: appConfigSandboxSource({
				slug,
				name: "get-app-config-value",
				key: "scheduler.progressUpdateThresholdHours",
			}),
		});
		const { jobId } = await enqueueSandboxScript(client, { scriptId, driverName: "main" });

		const value = requireCompletedSandboxValue(await pollSandboxResult(client, jobId));
		expect(typeof value).toBe("number");
		expect(value).toBeGreaterThan(0);
	});

	it("completes a script that uses getUserPreferences", async () => {
		const { client } = await createAuthenticatedClient();
		const slug = `get-user-prefs-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(client, {
			source: userPreferencesSandboxSource({ name: "get-user-prefs", slug }),
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
		const slug = `throws-error-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(client, {
			source: throwingSandboxSource({ name: "throws-error", slug, message: "intentional" }),
		});
		const { jobId } = await enqueueSandboxScript(client, { scriptId, driverName: "main" });

		const result = await pollSandboxResult(client, jobId);

		assertCompleted(result, "sandbox job");

		expect(result.value).toBeNull();
		expect(() => requireCompletedSandboxValue(result)).toThrow(/\[execute\] intentional/);
		expect(result.error).toMatchObject({
			phase: "execute",
			message: expect.stringContaining("intentional"),
		});
		expect(result.error?.line).toBeGreaterThan(0);
		expect(result.error?.column).toBeGreaterThan(0);
		expect(result.error?.stack).not.toContain("data:application/javascript");
		expect(result.error?.stack).not.toContain("runner.mjs");
	});

	it("rejects invalid TypeScript without creating a script row", async () => {
		const { client, userId } = await createAuthenticatedClient();
		const slug = `invalid-typescript-${crypto.randomUUID()}`;
		const source = invalidTypeScriptSandboxSource({ name: "Invalid TypeScript", slug });
		const error = await client.runError((c) => c.sandbox.createScript({ payload: { source } }));

		assertTaggedError(error, "SandboxCompilationFailure");
		expect(error.diagnostics.length).toBeGreaterThan(0);
		expect(error.diagnostics[0]).toMatchObject({
			file: "script.ts",
			severity: "error",
		});
		expect(error.diagnostics[0]?.line).toBeGreaterThan(0);
		expect(error.diagnostics[0]?.column).toBeGreaterThan(0);
		expect(error.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "TS2322",
					message: expect.stringContaining("not assignable to type 'number'"),
				}),
			]),
		);

		const rows = await getBackendClient().run(
			(c) => c.testSupport.listSandboxScripts({ urlParams: { userId: UserId.make(userId) } }),
			adminHeaders,
		);
		expect(rows.some((row) => row.source === source)).toBe(false);
	});

	it("returns 404 for a non-existent job id", async () => {
		const { client } = await createAuthenticatedClient();
		const error = await client.runError((c) =>
			c.sandbox.getResult({ path: { jobId: crypto.randomUUID() } }),
		);

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
		const slug = `unauth-poll-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(client, {
			source: literalSandboxSource({ name: "unauth-poll", slug, value: 42 }),
		});
		const { jobId } = await enqueueSandboxScript(client, { scriptId, driverName: "main" });

		const unauthenticatedClient = getBackendClient();
		const error = await unauthenticatedClient.runError((c) =>
			c.sandbox.getResult({ path: { jobId } }),
		);

		assertTaggedError(error, "Unauthorized");
	});
});
