import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	createEntitySchema,
	createPluginScope,
	deepThrowingSandboxSource,
	enqueueSandboxScript,
	httpCallSandboxSource,
	installSandboxScriptScoped,
	literalSandboxSource,
	pluginConfigSandboxSource,
	pollSandboxResult,
	queryEngineSandboxSource,
	reinstallTestPluginScript,
	requireCompletedSandboxValue,
	systemConfigSandboxSource,
	throwingSandboxSource,
	userPreferencesSandboxSource,
} from "~/fixtures";
import {
	assertCompleted,
	requireArray,
	requireObjectRecord,
	requireString,
} from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import { type FakeHttpServer, startFakeHttpServer } from "~/support/fake-http-server";

let httpServerUrl: string;
let httpServer: FakeHttpServer;

const configFixturePluginSlug = "e2e-sandbox-config-9d6f4b2a";
const configFixtureSchema = {
	unknownKeys: "strict",
	fields: {
		fixtureValue: {
			type: "string",
			label: "Fixture value",
			description: "Deterministic sandbox plugin config fixture",
			validation: { required: true },
		},
		fixtureLimit: {
			type: "integer",
			label: "Fixture limit",
			description: "Deterministic sandbox plugin config batch fixture",
		},
	},
} as const;

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
	it.live("completes a script that returns a plain value", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const slug = `plain-value-${crypto.randomUUID()}`;
			const source = literalSandboxSource({ name: "Plain value", slug, value: 42 });
			const script = yield* installSandboxScriptScoped({ slug, source, name: "Plain value" });
			const { scriptId } = script;
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId });

			const result = yield* pollSandboxResult(userId, jobId);

			assertCompleted(result, "sandbox job");

			expect(result.value).toBe(42);
			expect(result.error).toBeNull();

			const updatedSource = literalSandboxSource({ name: "Plain value", slug, value: 43 });
			const reinstalled = yield* reinstallTestPluginScript(scriptId, updatedSource, {
				slug,
				capabilities: [],
				kind: "script",
				name: "Plain value",
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
			});
			const updatedJob = yield* enqueueSandboxScript(userId, {
				scriptId: reinstalled.scriptId,
			});
			expect(requireCompletedSandboxValue(yield* pollSandboxResult(userId, updatedJob.jobId))).toBe(
				43,
			);
		}),
	);

	it.live("completes a script that uses httpCall", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const slug = `http-call-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "http-call",
				capabilities: ["httpCall"],
				source: httpCallSandboxSource({ name: "http-call", slug, url: httpServerUrl }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, {
				scriptId,
			});

			const value = requireObjectRecord(
				requireCompletedSandboxValue(yield* pollSandboxResult(userId, jobId)),
				"Expected sandbox httpCall result to be an object",
			);
			const data = requireObjectRecord(
				value.data,
				"Expected sandbox httpCall data to be an object",
			);
			expect(value.success).toBe(true);
			expect(data.status).toBe(200);
			expect(
				JSON.parse(requireString(data.body, "Expected sandbox httpCall body to be a string")),
			).toEqual({ ok: true, source: "sandbox-test-server" });
		}),
	);

	it.live("completes a script that uses executeQueryEngine", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const pluginSlug = createPluginScope();
			const { data: schema, slug } = yield* createEntitySchema(client, {
				pluginSlug,
				name: "Sandbox Schema",
				slug: `sandbox-schema-${crypto.randomUUID()}`,
			});
			yield* createEntity(client, {
				properties: {},
				name: "Test Entity",
				entitySchemaSlug: schema.id,
			});
			const sandboxSlug = `execute-query-engine-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug: sandboxSlug,
				name: "execute-query-engine",
				capabilities: ["executeQueryEngine"],
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
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId });

			const value = requireArray(
				requireCompletedSandboxValue(yield* pollSandboxResult(userId, jobId)),
				"Expected executeQueryEngine sandbox result to be an array",
			);
			const first = requireObjectRecord(
				value[0],
				"Expected first query engine item to be an object",
			);
			const idField = requireObjectRecord(
				first.id,
				"Expected query engine id field to be an object",
			);
			const nameField = requireObjectRecord(
				first.name,
				"Expected query engine name field to be an object",
			);
			expect(value.length).toBe(1);
			expect(nameField.value).toBe("Test Entity");
			expect(idField.value).toBeDefined();
		}),
	);

	it.live("returns an error when executeQueryEngine uses a missing schema slug", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const slug = `execute-query-engine-missing-schema-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				capabilities: ["executeQueryEngine"],
				name: "execute-query-engine-missing-schema",
				source: queryEngineSandboxSource({
					slug,
					name: "execute-query-engine-missing-schema",
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
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId });

			const result = yield* pollSandboxResult(userId, jobId);

			assertCompleted(result, "sandbox job");

			expect(result.error).toMatchObject({
				phase: "execute",
				message: expect.stringContaining("Entity schema 'does-not-exist' not found"),
			});
		}),
	);

	it.live("reads declared env-backed plugin config values in one batch", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const slug = `get-plugin-config-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "get-plugin-config",
				configSchema: configFixtureSchema,
				capabilities: ["getPluginConfig"],
				pluginSlug: configFixturePluginSlug,
				requiredPluginConfigKeys: ["fixtureValue", "fixtureLimit"],
				source: pluginConfigSandboxSource({
					slug,
					name: "get-plugin-config",
					keys: ["fixtureValue", "fixtureLimit"],
				}),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId });

			const value = requireCompletedSandboxValue(yield* pollSandboxResult(userId, jobId));
			expect(value).toEqual({ fixtureValue: "sandbox-plugin-config-value", fixtureLimit: 17 });
		}),
	);

	it.live("rejects an undeclared plugin config key", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const slug = `undeclared-plugin-config-value-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				requiredPluginConfigKeys: [],
				name: "undeclared-plugin-config",
				capabilities: ["getPluginConfig"],
				configSchema: configFixtureSchema,
				pluginSlug: configFixturePluginSlug,
				source: pluginConfigSandboxSource({
					slug,
					keys: ["fixtureValue"],
					requiredPluginConfigKeys: [],
					name: "undeclared-plugin-config",
				}),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId });

			const result = yield* pollSandboxResult(userId, jobId);
			assertCompleted(result, "sandbox job");
			expect(result.error).toMatchObject({
				phase: "execute",
				message: 'Plugin config key "fixtureValue" is not declared by this script',
			});
		}),
	);

	it.live("reads declared system config in a batch", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const declaredSlug = `declared-system-config-${crypto.randomUUID()}`;
			const declared = yield* installSandboxScriptScoped({
				slug: declaredSlug,
				name: "declared-system-config",
				capabilities: ["getSystemConfig"],
				requiredSystemConfigKeys: ["timezone"],
				source: systemConfigSandboxSource({
					keys: ["timezone"],
					slug: declaredSlug,
					name: "declared-system-config",
				}),
			});
			const declaredJob = yield* enqueueSandboxScript(userId, { scriptId: declared.scriptId });
			expect(
				requireCompletedSandboxValue(yield* pollSandboxResult(userId, declaredJob.jobId)),
			).toEqual({ timezone: "Etc/GMT" });

			const undeclaredSlug = `undeclared-system-config-${crypto.randomUUID()}`;
			const undeclared = yield* installSandboxScriptScoped({
				slug: undeclaredSlug,
				requiredSystemConfigKeys: [],
				name: "undeclared-system-config",
				capabilities: ["getSystemConfig"],
				source: systemConfigSandboxSource({
					keys: ["timezone"],
					slug: undeclaredSlug,
					requiredSystemConfigKeys: [],
					name: "undeclared-system-config",
				}),
			});
			const undeclaredJob = yield* enqueueSandboxScript(userId, {
				scriptId: undeclared.scriptId,
			});
			const result = yield* pollSandboxResult(userId, undeclaredJob.jobId);

			assertCompleted(result, "sandbox job");
			expect(result.error).toMatchObject({
				phase: "execute",
				message: 'System config key "timezone" is not declared by this script',
			});
		}),
	);

	it.live("completes a script that uses getUserPreferences", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const slug = `get-user-prefs-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "get-user-prefs",
				capabilities: ["getUserPreferences"],
				source: userPreferencesSandboxSource({ name: "get-user-prefs", slug }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId });

			const prefs = requireObjectRecord(
				requireCompletedSandboxValue(yield* pollSandboxResult(userId, jobId)),
				"Expected user preferences sandbox result to be an object",
			);
			expect(prefs.isNsfw).toBe(false);
			expect(prefs.disableIntegrations).toBe(false);
		}),
	);

	it.live("returns a completed result when the script throws", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const slug = `throws-error-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "throws-error",
				source: throwingSandboxSource({ name: "throws-error", slug, message: "intentional" }),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId });

			const result = yield* pollSandboxResult(userId, jobId);

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
		}),
	);

	it.live("preserves the complete mapped stack for deep script errors", () =>
		Effect.gen(function* () {
			const { userId } = yield* createAuthenticatedClient();
			const slug = `deep-throws-error-${crypto.randomUUID()}`;
			const { scriptId } = yield* installSandboxScriptScoped({
				slug,
				name: "deep-throws-error",
				source: deepThrowingSandboxSource({
					slug,
					name: "deep-throws-error",
					message: "deep intentional",
				}),
			});
			const { jobId } = yield* enqueueSandboxScript(userId, { scriptId });

			const result = yield* pollSandboxResult(userId, jobId);

			assertCompleted(result, "deep sandbox job");
			expect(result.error).toMatchObject({
				phase: "execute",
				message: expect.stringContaining("deep intentional"),
			});
			expect(result.error?.stack?.split("\n").length).toBeGreaterThan(10);
			expect(result.error?.stack).not.toContain("data:application/javascript");
			expect(result.error?.stack).not.toContain("runner.mjs");
		}),
	);
});
