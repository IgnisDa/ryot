import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

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
import { describe, expect, it } from "~/support/effect-test";

const installEchoOperationPlugin = (client: Client) => {
	const scriptSlug = `e2e-operation-${crypto.randomUUID()}`;
	const pluginSlug = PluginSlug.make(`e2e-operations-${crypto.randomUUID()}`);
	const entry = "backend/scripts/operation.sandbox.ts";
	const manifest = testPluginManifest({
		pluginSlug,
		configSchema: { fields: {}, unknownKeys: "strict" },
		operations: [
			{
				scriptSlug,
				auth: "user",
				slug: "echo",
				demoAccess: "allowed",
				description: "Uppercases every requested title",
			},
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
						[entry]: new TextEncoder().encode(
							operationSandboxSource({ slug: scriptSlug, name: "E2E Echo Operation" }),
						),
					},
				},
			});
			yield* settledPrivateInstallation(client, pluginSlug);
			return { pluginSlug };
		}),
		() => releasePrivatePlugin(client, pluginSlug),
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
					params: { operationSlug: "echo", pluginSlug: plugin.pluginSlug },
				}),
			);

			expect(result).toEqual({ results: ["DUNE", "ARCANE"] });
		}),
	);

	it.live("rejects unknown plugin and operation slugs", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = yield* installEchoOperationPlugin(client);

			const unknownPlugin = yield* Effect.flip(
				client.call((c) =>
					c.plugins.invoke({
						payload: { payload: { titles: [] } },
						params: {
							operationSlug: "echo",
							pluginSlug: PluginSlug.make(`missing-${crypto.randomUUID()}`),
						},
					}),
				),
			);
			assertTaggedError(unknownPlugin, "PluginNotFoundError");
			expect(unknownPlugin.reason).toEqual({
				operationSlug: "echo",
				code: "operation-not-found",
				pluginSlug: unknownPlugin.reason.pluginSlug,
			});

			const unknownOperation = yield* Effect.flip(
				client.call((c) =>
					c.plugins.invoke({
						payload: { payload: { titles: [] } },
						params: { pluginSlug: plugin.pluginSlug, operationSlug: "not-an-operation" },
					}),
				),
			);
			assertTaggedError(unknownOperation, "PluginNotFoundError");
			expect(unknownOperation.reason).toEqual({
				code: "operation-not-found",
				pluginSlug: plugin.pluginSlug,
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
						params: { operationSlug: "echo", pluginSlug: plugin.pluginSlug },
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
						params: { operationSlug: "echo", pluginSlug: plugin.pluginSlug },
					}),
				),
			);

			assertTaggedError(failure, "AuthUnauthorized");
		}),
	);
});
