import { pluginPackageSegments } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import {
	createIntegration,
	deleteIntegration,
	createAuthenticatedClient,
	getApiClient,
	installTestPlugin,
	integrationReadOperationSandboxSource,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("sandbox integration reads", () => {
	it.live("resolves current integration from trusted scope and filters integrations", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const slug = `integration-read-${crypto.randomUUID()}`;
			const providerSlug = `integration-read-provider-${crypto.randomUUID()}`;
			const plugin = yield* Effect.acquireRelease(
				installTestPlugin({
					client,
					source: integrationReadOperationSandboxSource({
						slug,
						providerSlug,
						name: "Integration read",
					}),
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
						capabilities: ["getCurrentIntegration", "listIntegrations"],
					},
					integrationProviders: [
						{
							lot: "push",
							slug: providerSlug,
							name: "Integration read provider",
							description: "Owns the integrations this operation reads",
							settingsSchema: {
								unknownKeys: "strict",
								fields: {
									endpoint: { type: "string", label: "Endpoint", description: "Provider URL" },
								},
							},
						},
					],
				}),
				uninstallTestPlugin,
			);
			const release = (integration: { readonly id: string }) =>
				deleteIntegration(client, integration.id).pipe(Effect.asVoid, Effect.orDie);
			const current = yield* Effect.acquireRelease(
				createIntegration(client, {
					providerSpecifics: { endpoint: "https://integration-read.example.com" },
					provider: { slug: providerSlug, owner: { kind: "plugin", pluginId: plugin.pluginId } },
				}),
				release,
			);
			yield* Effect.acquireRelease(
				createIntegration(client, {
					isDisabled: true,
					providerSpecifics: { endpoint: "https://integration-read.example.com" },
					provider: { slug: providerSlug, owner: { kind: "plugin", pluginId: plugin.pluginId } },
				}),
				release,
			);

			const { result } = yield* client.call((c) =>
				c.plugins.invoke({
					payload: { payload: { integrationId: current.id } },
					params: {
						...pluginPackageSegments(plugin.manifest.metadata.packageId),
						operationSlug: "read",
					},
				}),
			);

			expect(result).toEqual({
				current: expect.objectContaining({ id: current.id }),
				enabled: [expect.objectContaining({ id: current.id })],
			});

			const unauthenticated = yield* getApiClient().call((c) =>
				c.plugins.invoke({
					payload: { payload: { integrationId: current.id } },
					params: {
						...pluginPackageSegments(plugin.manifest.metadata.packageId),
						operationSlug: "read",
					},
				}),
			);
			expect(unauthenticated.result).toEqual(result);

			const stale = yield* Effect.flip(
				getApiClient().call((c) =>
					c.plugins.invoke({
						payload: { contentHash: "stale-source-hash", payload: { integrationId: current.id } },
						params: {
							...pluginPackageSegments(plugin.manifest.metadata.packageId),
							operationSlug: "read",
						},
					}),
				),
			);
			assertTaggedError(stale, "PluginConflictError");
			expect(stale.reason.code).toBe("source-revision-stale");
		}),
	);
});
