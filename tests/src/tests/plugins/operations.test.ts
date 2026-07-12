import { Effect } from "effect";
import { PluginSlug } from "@ryot/contract/schema/brands";

import {
	createAuthenticatedClient,
	getBackendClient,
	installTestPlugin,
	operationSandboxSource,
	uninstallTestPlugin,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const installEchoOperationPlugin = () => {
	const scriptSlug = `e2e-operation-${crypto.randomUUID()}`;
	return Effect.acquireRelease(
		installTestPlugin({
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
	it.scopedLive("dispatches an operation and returns its decoded result", () =>
		Effect.gen(function* () {
			const plugin = yield* installEchoOperationPlugin();
			const { client } = yield* createAuthenticatedClient();

			const { result } = yield* client.call((c) =>
				c.plugins.invoke({
					payload: { payload: { titles: ["dune", "arcane"] } },
					path: { pluginSlug: plugin.pluginSlug, operationSlug: "echo" },
				}),
			);

			expect(result).toEqual({ results: ["DUNE", "ARCANE"] });
		}),
	);

	it.scopedLive("rejects unknown plugin and operation slugs", () =>
		Effect.gen(function* () {
			const plugin = yield* installEchoOperationPlugin();
			const { client } = yield* createAuthenticatedClient();

			const unknownPlugin = yield* Effect.flip(
				client.call((c) =>
					c.plugins.invoke({
						payload: { payload: { titles: [] } },
						path: {
							operationSlug: "echo",
							pluginSlug: PluginSlug.make(`missing-${crypto.randomUUID()}`),
						},
					}),
				),
			);
			assertTaggedError(unknownPlugin, "NotFound");

			const unknownOperation = yield* Effect.flip(
				client.call((c) =>
					c.plugins.invoke({
						payload: { payload: { titles: [] } },
						path: { pluginSlug: plugin.pluginSlug, operationSlug: "not-an-operation" },
					}),
				),
			);
			assertTaggedError(unknownOperation, "NotFound");
		}),
	);

	it.scopedLive("surfaces a payload that violates the script input schema", () =>
		Effect.gen(function* () {
			const plugin = yield* installEchoOperationPlugin();
			const { client } = yield* createAuthenticatedClient();

			const failure = yield* Effect.flip(
				client.call((c) =>
					c.plugins.invoke({
						payload: { payload: { titles: "dune" } },
						path: { pluginSlug: plugin.pluginSlug, operationSlug: "echo" },
					}),
				),
			);

			assertTaggedError(failure, "SandboxRunError");
		}),
	);

	it.scopedLive("enforces the operation's declared user authentication", () =>
		Effect.gen(function* () {
			const plugin = yield* installEchoOperationPlugin();

			const failure = yield* Effect.flip(
				getBackendClient().call((c) =>
					c.plugins.invoke({
						payload: { payload: { titles: ["dune"] } },
						path: { pluginSlug: plugin.pluginSlug, operationSlug: "echo" },
					}),
				),
			);

			assertTaggedError(failure, "Unauthorized");
		}),
	);
});
