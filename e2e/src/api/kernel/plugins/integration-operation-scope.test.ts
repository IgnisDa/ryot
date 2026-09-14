import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createIntegration,
	createKodiIntegration,
	deleteIntegration,
	installPrivateIntegrationPlugin,
	invokePrivateIntegrationOperation,
	releasePrivatePlugin,
} from "~/fixtures/kernel";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("integration authenticated operation scope", () => {
	it.live("rejects an integration from another installation of the same user", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const declaring = yield* Effect.acquireRelease(
				installPrivateIntegrationPlugin({ client }),
				({ pluginSlug }) => releasePrivatePlugin(client, pluginSlug),
			);
			const other = yield* Effect.acquireRelease(
				installPrivateIntegrationPlugin({ client }),
				({ pluginSlug }) => releasePrivatePlugin(client, pluginSlug),
			);
			const integration = yield* Effect.acquireRelease(
				createIntegration(client, {
					provider: declaring.providerSlug,
					providerSpecifics: { endpoint: "https://private.example.com" },
				}),
				({ id }) =>
					deleteIntegration(client, id).pipe(
						Effect.catchTag("IntegrationNotFoundError", () => Effect.void),
						Effect.asVoid,
						Effect.orDie,
					),
			);
			const kodi = yield* Effect.acquireRelease(createKodiIntegration(client), ({ id }) =>
				deleteIntegration(client, id).pipe(
					Effect.catchTag("IntegrationNotFoundError", () => Effect.void),
					Effect.asVoid,
					Effect.orDie,
				),
			);

			expect(
				(yield* invokePrivateIntegrationOperation({
					client,
					integrationId: integration.id,
					pluginSlug: declaring.pluginSlug,
					operationSlug: declaring.operationSlug,
				})).result,
			).toEqual({ integrationId: integration.id });

			const foreignPrivate = yield* Effect.flip(
				invokePrivateIntegrationOperation({
					client,
					pluginSlug: other.pluginSlug,
					integrationId: integration.id,
					operationSlug: other.operationSlug,
				}),
			);
			assertTaggedError(foreignPrivate, "PluginNotFoundError");
			expect(foreignPrivate.reason).toEqual({
				code: "operation-not-found",
				pluginSlug: other.pluginSlug,
				operationSlug: other.operationSlug,
			});

			const foreignSystem = yield* Effect.flip(
				invokePrivateIntegrationOperation({
					client,
					integrationId: kodi.id,
					pluginSlug: declaring.pluginSlug,
					operationSlug: declaring.operationSlug,
				}),
			);
			assertTaggedError(foreignSystem, "PluginNotFoundError");
			expect(foreignSystem.reason).toEqual({
				code: "operation-not-found",
				pluginSlug: declaring.pluginSlug,
				operationSlug: declaring.operationSlug,
			});
		}),
	);
});
