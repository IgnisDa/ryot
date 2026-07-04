import { Effect } from "effect";

import {
	createIntegration,
	createAuthenticatedClient,
	createKodiIntegration,
	installTestPlugin,
	integrationReadOperationSandboxSource,
	uninstallTestPlugin,
} from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox integration reads", () => {
	it.live("resolves current integration from trusted scope and filters integrations", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const current = yield* createKodiIntegration(client);
			yield* createIntegration(client, {
				isDisabled: true,
				provider: "kodi",
				providerSpecifics: { kind: "kodi" },
			});
			const slug = `integration-read-${crypto.randomUUID()}`;
			const plugin = yield* Effect.acquireRelease(
				installTestPlugin({
					source: integrationReadOperationSandboxSource({ slug, name: "Integration read" }),
					operations: [
						{
							slug: "read",
							scriptSlug: slug,
							auth: "integration",
							description: "Reads integration scope",
						},
					],
					script: {
						slug,
						kind: "operation",
						name: "Integration read",
						requiredPluginConfigKeys: [],
						requiredSystemConfigKeys: [],
						capabilities: ["getCurrentIntegration", "listIntegrations"],
					},
				}),
				uninstallTestPlugin,
			);

			const { result } = yield* client.call((c) =>
				c.plugins.invoke({
					payload: { payload: { integrationId: current.id } },
					params: { operationSlug: "read", pluginSlug: plugin.pluginSlug },
				}),
			);

			expect(result).toEqual({
				current: expect.objectContaining({ id: current.id }),
				enabled: [expect.objectContaining({ id: current.id })],
			});
		}),
	);
});
