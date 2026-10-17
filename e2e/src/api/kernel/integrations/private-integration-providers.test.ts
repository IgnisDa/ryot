import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { integrationProvidersRecipe } from "@ryot-app/ryotql-recipes/integration-providers";
import { Effect, Option } from "effect";

import type { Client } from "~/fixtures/kernel";
import {
	collectRyotQLRecipeItems,
	createAuthenticatedClient,
	createIntegration,
	deleteIntegration,
	getIntegration,
	installPrivateIntegrationPlugin,
	invokePrivateIntegrationOperation,
	listIntegrations,
	releasePrivatePlugin,
	testPluginPackageId,
	updatePluginState,
} from "~/fixtures/kernel";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const providerSpecifics = { endpoint: "https://private.example.com" };

const listProviders = (client: Client) =>
	collectRyotQLRecipeItems(client, (after) => integrationProvidersRecipe({ after, limit: 100 }));

const scopedIntegration = (
	client: Client,
	provider: Parameters<typeof createIntegration>[1]["provider"],
) =>
	Effect.acquireRelease(createIntegration(client, { provider, providerSpecifics }), ({ id }) =>
		deleteIntegration(client, id).pipe(
			Effect.catchTag("IntegrationNotFoundError", () => Effect.void),
			Effect.asVoid,
			Effect.orDie,
		),
	);

describe("private integration providers", () => {
	it.live("offers a private provider only to its owner", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const outsider = yield* createAuthenticatedClient();
			const plugin = yield* Effect.acquireRelease(
				installPrivateIntegrationPlugin({ client: owner.client }),
				({ pluginSlug }) => releasePrivatePlugin(owner.client, pluginSlug),
			);

			const ownerProviders = yield* listProviders(owner.client);
			const outsiderProviders = yield* listProviders(outsider.client);

			expect(
				requirePresent(
					ownerProviders.find(({ slug }) => slug === plugin.providerSlug),
					"Private integration provider is missing for its owner",
				),
			).toMatchObject({
				lot: "push",
				hasScript: true,
				slug: plugin.providerSlug,
				reference: { slug: plugin.providerSlug, owner: definitionOwner(plugin.pluginId) },
			});
			expect(outsiderProviders.map(({ slug }) => slug)).not.toContain(plugin.providerSlug);

			const provider = { slug: plugin.providerSlug, owner: definitionOwner(plugin.pluginId) };
			const created = yield* scopedIntegration(owner.client, provider);
			const detail = requirePresent(
				Option.getOrUndefined(yield* getIntegration(owner.client, created.id)),
				"Expected owned integration",
			);
			expect(detail).toMatchObject({ isDisabled: false, provider: plugin.providerSlug });
			expect((yield* listIntegrations(owner.client)).map(({ id }) => id)).toContain(created.id);
			expect(
				(yield* invokePrivateIntegrationOperation({
					client: owner.client,
					integrationId: created.id,
					operationSlug: plugin.operationSlug,
					packageId: plugin.manifest.metadata.packageId,
				})).result,
			).toEqual({ integrationId: created.id });

			const failure = yield* Effect.flip(
				createIntegration(outsider.client, { provider, providerSpecifics }),
			);
			assertTaggedError(failure, "IntegrationRequestError");
			expect(failure.reason).toEqual({ code: "provider-not-found", provider: plugin.providerSlug });
		}),
	);

	it.live("keeps identical provider slugs bound to each user's own installation", () =>
		Effect.gen(function* () {
			const first = yield* createAuthenticatedClient();
			const second = yield* createAuthenticatedClient();
			const suffix = crypto.randomUUID();
			const providerSlug = `e2e-shared-private-provider-${suffix}`;
			const pluginSlug = `e2e-shared-private-integration-plugin-${suffix}`;
			const packageId = testPluginPackageId();

			const firstPlugin = yield* Effect.acquireRelease(
				installPrivateIntegrationPlugin({
					packageId,
					pluginSlug,
					providerSlug,
					name: "First sink",
					client: first.client,
				}),
				({ pluginSlug: slug }) => releasePrivatePlugin(first.client, slug),
			);
			const secondPlugin = yield* Effect.acquireRelease(
				installPrivateIntegrationPlugin({
					packageId,
					pluginSlug,
					providerSlug,
					name: "Second sink",
					client: second.client,
				}),
				({ pluginSlug: slug }) => releasePrivatePlugin(second.client, slug),
			);

			const firstProviders = (yield* listProviders(first.client)).filter(
				({ slug }) => slug === providerSlug,
			);
			const secondProviders = (yield* listProviders(second.client)).filter(
				({ slug }) => slug === providerSlug,
			);
			expect(firstProviders).toMatchObject([{ packageId, name: "First sink" }]);
			expect(secondProviders).toMatchObject([{ packageId, name: "Second sink" }]);

			const firstIntegration = yield* scopedIntegration(first.client, {
				slug: providerSlug,
				owner: definitionOwner(firstPlugin.pluginId),
			});
			const secondIntegration = yield* scopedIntegration(second.client, {
				slug: providerSlug,
				owner: definitionOwner(secondPlugin.pluginId),
			});

			expect((yield* listIntegrations(first.client)).map(({ id }) => id)).toEqual([
				firstIntegration.id,
			]);
			expect((yield* listIntegrations(second.client)).map(({ id }) => id)).toEqual([
				secondIntegration.id,
			]);
			expect(
				(yield* invokePrivateIntegrationOperation({
					client: second.client,
					integrationId: secondIntegration.id,
					operationSlug: secondPlugin.operationSlug,
					packageId: secondPlugin.manifest.metadata.packageId,
				})).result,
			).toEqual({ integrationId: secondIntegration.id });

			const failure = yield* Effect.flip(
				invokePrivateIntegrationOperation({
					client: first.client,
					integrationId: secondIntegration.id,
					operationSlug: firstPlugin.operationSlug,
					packageId: firstPlugin.manifest.metadata.packageId,
				}),
			);
			assertTaggedError(failure, "PluginNotFoundError");
			expect(failure.reason).toEqual({
				code: "operation-not-found",
				operationSlug: firstPlugin.operationSlug,
				packageId: firstPlugin.manifest.metadata.packageId,
			});
		}),
	);

	it.live("withdraws a private provider when its installation is hidden", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = yield* Effect.acquireRelease(
				installPrivateIntegrationPlugin({ client }),
				({ installationId }) => releasePrivatePlugin(client, installationId),
			);

			yield* updatePluginState(client, plugin.installationId, { isHidden: true });

			const providers = yield* listProviders(client);
			expect(providers.map(({ slug }) => slug)).not.toContain(plugin.providerSlug);

			const failure = yield* Effect.flip(
				createIntegration(client, {
					providerSpecifics,
					provider: { slug: plugin.providerSlug, owner: definitionOwner(plugin.pluginId) },
				}),
			);
			assertTaggedError(failure, "IntegrationRequestError");
			expect(failure.reason).toEqual({ code: "provider-not-found", provider: plugin.providerSlug });

			yield* updatePluginState(client, plugin.installationId, { isHidden: false });
			expect((yield* listProviders(client)).map(({ slug }) => slug)).toContain(plugin.providerSlug);
		}),
	);
});
