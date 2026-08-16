import { PluginSlug } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	getBackendClient,
	installTestPlugin,
	operationSandboxSource,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const installEchoOperationPlugin = (client: Client) => {
	const scriptSlug = `e2e-operation-${crypto.randomUUID()}`;
	return Effect.acquireRelease(
		installTestPlugin({
			client,
			pluginSlug: `e2e-operations-${crypto.randomUUID()}`,
			configSchema: { fields: {}, unknownKeys: "strict" },
			source: operationSandboxSource({ name: "E2E Echo Operation", slug: scriptSlug }),
			operations: [
				{
					auth: "user",
					slug: "echo",
					scriptSlug,
					description: "Uppercases every requested title",
				},
			],
			script: {
				capabilities: [],
				slug: scriptSlug,
				kind: "operation",
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				name: "E2E Echo Operation",
			},
		}),
		uninstallTestPlugin,
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
					params: { pluginSlug: plugin.pluginSlug, operationSlug: "echo" },
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
						params: { pluginSlug: plugin.pluginSlug, operationSlug: "echo" },
					}),
				),
			);

			assertTaggedError(failure, "PluginInvocationError");
			expect(failure.reason).toMatchObject({
				code: "runtime-failed",
				diagnostics: [{ code: "sandbox-runtime-error", phase: "input", severity: "error" }],
			});
		}),
	);

	it.live("enforces the operation's declared user authentication", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = yield* installEchoOperationPlugin(client);

			const failure = yield* Effect.flip(
				getBackendClient().call((c) =>
					c.plugins.invoke({
						payload: { payload: { titles: ["dune"] } },
						params: { pluginSlug: plugin.pluginSlug, operationSlug: "echo" },
					}),
				),
			);

			assertTaggedError(failure, "AuthUnauthorized");
		}),
	);
});
