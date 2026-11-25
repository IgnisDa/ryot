import type { ContractClient } from "@ryot-app/contract/client";
import {
	BROWSER_SESSION_HEADER,
	BROWSER_SESSION_PATH,
	BrowserSessionProfile,
} from "@ryot-app/contract/oauth";
import { pluginPackageSegments } from "@ryot-app/contract/schema/brands";
import { webRequest } from "@ryot-app/testing/web-request";
import { Effect, Schema } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import {
	type Client,
	createAuthenticatedClient,
	getApiClient,
	installPrivatePluginPackage,
	operationSandboxSource,
	releasePrivatePlugin,
	settledPrivateInstallation,
	testPluginManifest,
} from "~/fixtures/kernel";
import { assertTaggedError } from "~/support/assertions";
import { signInThroughHostedOAuth } from "~/support/browser";
import { describe, expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const installEchoOperationPlugin = (client: Client) => {
	const scriptSlug = `e2e-operation-${crypto.randomUUID()}`;
	const pluginSlug = `e2e-operations-${crypto.randomUUID()}`;
	const entry = "backend/scripts/operation.sandbox.ts";
	const manifest = testPluginManifest({
		pluginSlug,
		configSchema: { fields: {}, unknownKeys: "strict" },
		scripts: [
			{
				entry,
				capabilities: [],
				slug: scriptSlug,
				kind: "operation",
				name: "E2E Echo Operation",
				requiredPluginConfigKeys: [],
			},
		],
		operations: [
			{
				scriptSlug,
				auth: "user",
				slug: "echo",
				demoAccess: "allowed",
				title: "Fixture operation",
				description: "Uppercases every requested title",
				hints: { readOnly: true, idempotent: true, destructive: false },
				input: {
					type: "object",
					required: ["titles"],
					additionalProperties: false,
					properties: { titles: { type: "array", items: { type: "string" } } },
				},
				output: {
					type: "object",
					required: ["results"],
					additionalProperties: false,
					properties: { results: { type: "array", items: { type: "string" } } },
				},
			},
		],
	});
	return Effect.acquireRelease(
		Effect.gen(function* () {
			const installed = yield* installPrivatePluginPackage({
				client,
				config: {},
				pluginPackage: {
					manifest,
					files: {
						[entry]: new TextEncoder().encode(
							operationSandboxSource({ slug: scriptSlug, name: "E2E Echo Operation" }),
						),
					},
				},
			});
			yield* settledPrivateInstallation(client, installed.id);
			return { pluginSlug, installationId: installed.id, packageId: manifest.metadata.packageId };
		}),
		({ installationId }) => releasePrivatePlugin(client, installationId),
	);
};

describe("plugin operations", () => {
	it.live("dispatches an operation and returns its decoded result", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = yield* installEchoOperationPlugin(client);

			const { result } = yield* client.call((c) =>
				c.plugins.invoke({
					payload: { payload: { titles: ["dune", "arcane"] } },
					params: { ...pluginPackageSegments(plugin.packageId), operationSlug: "echo" },
				}),
			);

			expect(result).toEqual({ results: ["DUNE", "ARCANE"] });
		}),
	);

	it.live("rejects unknown plugin identities and operation slugs", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = yield* installEchoOperationPlugin(client);

			const unknownPlugin = yield* Effect.flip(
				client.call((c) =>
					c.plugins.invoke({
						payload: { payload: { titles: [] } },
						params: {
							publisher: "test",
							operationSlug: "echo",
							name: `missing-${crypto.randomUUID()}`,
						},
					}),
				),
			);
			assertTaggedError(unknownPlugin, "PluginNotFoundError");
			expect(unknownPlugin.reason.code).toBe("operation-not-found");

			const unknownOperation = yield* Effect.flip(
				client.call((c) =>
					c.plugins.invoke({
						payload: { payload: { titles: [] } },
						params: {
							...pluginPackageSegments(plugin.packageId),
							operationSlug: "not-an-operation",
						},
					}),
				),
			);
			assertTaggedError(unknownOperation, "PluginNotFoundError");
			expect(unknownOperation.reason).toEqual({
				packageId: plugin.packageId,
				code: "operation-not-found",
				operationSlug: "not-an-operation",
			});
		}),
	);

	it.live("surfaces a payload that violates the script input schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = yield* installEchoOperationPlugin(client);

			const failure = yield* Effect.flip(
				client.call((c) =>
					c.plugins.invoke({
						payload: { payload: { titles: "dune" } },
						params: { ...pluginPackageSegments(plugin.packageId), operationSlug: "echo" },
					}),
				),
			);

			assertTaggedError(failure, "PluginInvocationError");
			expect(failure.reason).toMatchObject({
				code: "runtime-failed",
				diagnostics: [{ phase: "input", severity: "error", code: "sandbox-runtime-error" }],
			});
		}),
	);

	it.live("enforces the operation's declared user authentication", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = yield* installEchoOperationPlugin(client);

			const failure = yield* Effect.flip(
				getApiClient().call((c) =>
					c.plugins.invoke({
						payload: { payload: { titles: ["dune"] } },
						params: { ...pluginPackageSegments(plugin.packageId), operationSlug: "echo" },
					}),
				),
			);

			assertTaggedError(failure, "AuthUnauthorized");
		}),
	);

	it.live("rejects plugin calls from a stale browser session or a different origin", () =>
		Effect.gen(function* () {
			const { email, client, password } = yield* createAuthenticatedClient();
			const plugin = yield* installEchoOperationPlugin(client);
			const browser = yield* Playwright.Browser;
			const origin = new URL(getFrontendUrl()).origin;
			const signIn = () =>
				Effect.gen(function* () {
					const page = yield* browser.newPage();
					yield* signInThroughHostedOAuth(page, email, password);
					const cookies = yield* page.use((raw) => raw.context().cookies(origin));
					const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
					const response = yield* webRequest(new URL(BROWSER_SESSION_PATH, origin), {
						headers: { cookie },
					});
					expect(response.ok).toBe(true);
					const { session } = yield* Schema.decodeUnknownEffect(BrowserSessionProfile)(
						yield* Effect.promise(() => response.json()),
					);
					return { cookie, session };
				});
			const previous = yield* signIn();
			const current = yield* signIn();
			const headers = { origin, cookie: current.cookie, [BROWSER_SESSION_HEADER]: current.session };
			const invoke = (c: ContractClient) =>
				c.plugins.invoke({
					payload: { payload: { titles: ["dune"] } },
					params: { ...pluginPackageSegments(plugin.packageId), operationSlug: "echo" },
				});
			const browserClient = getApiClient();
			expect((yield* browserClient.call(invoke, headers)).result).toEqual({ results: ["DUNE"] });

			const stale = yield* Effect.flip(
				browserClient.call(invoke, { ...headers, [BROWSER_SESSION_HEADER]: previous.session }),
			);
			assertTaggedError(stale, "AuthUnauthorized");
			expect(stale.reason.code).toBe("authentication-required");

			const wrongOrigin = yield* Effect.flip(
				browserClient.call(invoke, { ...headers, origin: "https://other.example.test" }),
			);
			assertTaggedError(wrongOrigin, "AuthUnauthorized");
			expect(wrongOrigin.reason.code).toBe("authentication-required");
		}).pipe(PlaywrightSpawner.withBrowser),
	);
});
