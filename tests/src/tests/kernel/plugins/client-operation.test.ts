import { PluginSlug } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	FIXTURE_CLIENT_PLUGIN_SLUG,
	getBackendClient,
	installFixtureClientPlugin,
	installPrivatePluginPackage,
	operationSandboxSource,
	releasePrivatePlugin,
	settledPrivateInstallation,
	testPluginManifest,
} from "~/fixtures/kernel";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const installOtherOperationPlugin = (client: Client) => {
	const scriptSlug = `e2e-operation-${crypto.randomUUID()}`;
	const pluginSlug = PluginSlug.make(`e2e-operations-${crypto.randomUUID()}`);
	const entry = "backend/scripts/operation.sandbox.ts";
	const manifest = testPluginManifest({
		pluginSlug,
		configSchema: { fields: {}, unknownKeys: "strict" },
		operations: [
			{ scriptSlug, auth: "user", slug: "echo", description: "Uppercases every requested title" },
		],
		scripts: [
			{
				entry,
				capabilities: [],
				slug: scriptSlug,
				kind: "operation",
				name: "E2E Echo Operation",
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
			},
		],
	});
	return Effect.acquireRelease(
		Effect.gen(function* () {
			yield* installPrivatePluginPackage({
				client,
				config: {},
				pluginPackage: {
					manifest,
					files: {
						[entry]: operationSandboxSource({ name: "E2E Echo Operation", slug: scriptSlug }),
					},
				},
			});
			yield* settledPrivateInstallation(client, pluginSlug);
			return { pluginSlug };
		}),
		() => releasePrivatePlugin(client, pluginSlug),
	);
};

describe("client plugin operations", () => {
	it.live("invokes an authenticated operation on an installed client plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const installation = yield* installFixtureClientPlugin(client);

			expect(installation).toMatchObject({ health: "ready", isDisabled: false });

			const { result } = yield* client.call((c) =>
				c.plugins.invoke({
					payload: { payload: { name: "Ryot" } },
					params: { pluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG, operationSlug: "greet" },
				}),
			);

			expect(result).toEqual({ greeting: "Hello, Ryot" });
		}),
	);

	it.live("surfaces a payload that violates the operation's input schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			yield* installFixtureClientPlugin(client);

			const failure = yield* Effect.flip(
				client.call((c) =>
					c.plugins.invoke({
						payload: { payload: { name: "" } },
						params: { pluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG, operationSlug: "greet" },
					}),
				),
			);

			assertTaggedError(failure, "PluginInvocationError");
			expect(failure.reason).toMatchObject({
				code: "runtime-failed",
				diagnostics: [{ phase: "input", severity: "error" }],
			});
		}),
	);

	it.live("rejects an unauthenticated caller", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			yield* installFixtureClientPlugin(client);

			const failure = yield* Effect.flip(
				getBackendClient().call((c) =>
					c.plugins.invoke({
						payload: { payload: { name: "Ryot" } },
						params: { pluginSlug: FIXTURE_CLIENT_PLUGIN_SLUG, operationSlug: "greet" },
					}),
				),
			);

			assertTaggedError(failure, "AuthUnauthorized");
		}),
	);

	it.live("rejects invocation under a different plugin's identity", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			yield* installFixtureClientPlugin(client);
			const other = yield* installOtherOperationPlugin(client);

			const failure = yield* Effect.flip(
				client.call((c) =>
					c.plugins.invoke({
						payload: { payload: { name: "Ryot" } },
						params: { pluginSlug: other.pluginSlug, operationSlug: "greet" },
					}),
				),
			);

			assertTaggedError(failure, "PluginNotFoundError");
			expect(failure.reason).toEqual({
				operationSlug: "greet",
				code: "operation-not-found",
				pluginSlug: other.pluginSlug,
			});
		}),
	);
});
