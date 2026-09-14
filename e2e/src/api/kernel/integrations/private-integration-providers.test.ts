import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel";
import {
	createAuthenticatedClient,
	createIntegration,
	deleteIntegration,
	installPrivateIntegrationPlugin,
	invokePrivateIntegrationOperation,
	listIntegrations,
	releasePrivatePlugin,
	updatePluginState,
} from "~/fixtures/kernel";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const providerSpecifics = { endpoint: "https://private.example.com" };

const scopedIntegration = (client: Client, provider: string) =>
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

			const ownerProviders = yield* owner.client.call((c) => c.integrations.listProviders());
			const outsiderProviders = yield* outsider.client.call((c) => c.integrations.listProviders());

			expect(
				requirePresent(
					ownerProviders.find(({ slug }) => slug === plugin.providerSlug),
					"Private integration provider is missing for its owner",
				),
			).toMatchObject({
				lot: "push",
				isCreatable: true,
				slug: plugin.providerSlug,
				pluginSlug: plugin.pluginSlug,
			});
			expect(outsiderProviders.map(({ slug }) => slug)).not.toContain(plugin.providerSlug);

			const created = yield* scopedIntegration(owner.client, plugin.providerSlug);
			expect(created).toMatchObject({ isDisabled: false, provider: plugin.providerSlug });
			expect((yield* listIntegrations(owner.client)).map(({ id }) => id)).toContain(created.id);
			expect(
				(yield* invokePrivateIntegrationOperation({
					client: owner.client,
					integrationId: created.id,
					pluginSlug: plugin.pluginSlug,
					operationSlug: plugin.operationSlug,
				})).result,
			).toEqual({ integrationId: created.id });

			const failure = yield* Effect.flip(
				createIntegration(outsider.client, { providerSpecifics, provider: plugin.providerSlug }),
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

			const firstPlugin = yield* Effect.acquireRelease(
				installPrivateIntegrationPlugin({
					pluginSlug,
					providerSlug,
					name: "First sink",
					client: first.client,
				}),
				({ pluginSlug: slug }) => releasePrivatePlugin(first.client, slug),
			);
			const secondPlugin = yield* Effect.acquireRelease(
				installPrivateIntegrationPlugin({
					pluginSlug,
					providerSlug,
					name: "Second sink",
					client: second.client,
				}),
				({ pluginSlug: slug }) => releasePrivatePlugin(second.client, slug),
			);

			const firstProviders = (yield* first.client.call((c) =>
				c.integrations.listProviders(),
			)).filter(({ slug }) => slug === providerSlug);
			const secondProviders = (yield* second.client.call((c) =>
				c.integrations.listProviders(),
			)).filter(({ slug }) => slug === providerSlug);
			expect(firstProviders).toMatchObject([{ pluginSlug, name: "First sink" }]);
			expect(secondProviders).toMatchObject([{ pluginSlug, name: "Second sink" }]);

			const firstIntegration = yield* scopedIntegration(first.client, providerSlug);
			const secondIntegration = yield* scopedIntegration(second.client, providerSlug);

			expect((yield* listIntegrations(first.client)).map(({ id }) => id)).toEqual([
				firstIntegration.id,
			]);
			expect((yield* listIntegrations(second.client)).map(({ id }) => id)).toEqual([
				secondIntegration.id,
			]);
			expect(
				(yield* invokePrivateIntegrationOperation({
					client: second.client,
					pluginSlug: secondPlugin.pluginSlug,
					integrationId: secondIntegration.id,
					operationSlug: secondPlugin.operationSlug,
				})).result,
			).toEqual({ integrationId: secondIntegration.id });

			const failure = yield* Effect.flip(
				invokePrivateIntegrationOperation({
					client: first.client,
					pluginSlug: firstPlugin.pluginSlug,
					integrationId: secondIntegration.id,
					operationSlug: firstPlugin.operationSlug,
				}),
			);
			assertTaggedError(failure, "PluginNotFoundError");
			expect(failure.reason).toEqual({
				code: "operation-not-found",
				pluginSlug: firstPlugin.pluginSlug,
				operationSlug: firstPlugin.operationSlug,
			});
		}),
	);

	it.live("withdraws a private provider when its installation is disabled", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = yield* Effect.acquireRelease(
				installPrivateIntegrationPlugin({ client }),
				({ pluginSlug }) => releasePrivatePlugin(client, pluginSlug),
			);

			yield* updatePluginState(client, plugin.pluginSlug, { isDisabled: true });

			const providers = yield* client.call((c) => c.integrations.listProviders());
			expect(providers.map(({ slug }) => slug)).not.toContain(plugin.providerSlug);

			const failure = yield* Effect.flip(
				createIntegration(client, { providerSpecifics, provider: plugin.providerSlug }),
			);
			assertTaggedError(failure, "IntegrationRequestError");
			expect(failure.reason).toEqual({ code: "provider-not-found", provider: plugin.providerSlug });

			yield* updatePluginState(client, plugin.pluginSlug, { isDisabled: false });
			expect(
				(yield* client.call((c) => c.integrations.listProviders())).map(({ slug }) => slug),
			).toContain(plugin.providerSlug);
		}),
	);
});
