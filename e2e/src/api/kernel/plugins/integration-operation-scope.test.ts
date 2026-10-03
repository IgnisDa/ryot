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
				({ installationId }) => releasePrivatePlugin(client, installationId),
			);
			const other = yield* Effect.acquireRelease(
				installPrivateIntegrationPlugin({ client }),
				({ installationId }) => releasePrivatePlugin(client, installationId),
			);
			const integration = yield* Effect.acquireRelease(
				createIntegration(client, {
					providerSpecifics: { endpoint: "https://private.example.com" },
					provider: {
						slug: declaring.providerSlug,
						owner: { kind: "plugin", pluginId: declaring.pluginId },
					},
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
					pluginId: declaring.pluginId,
					integrationId: integration.id,
					operationSlug: declaring.operationSlug,
				})).result,
			).toEqual({ integrationId: integration.id });

			const foreignPrivate = yield* Effect.flip(
				invokePrivateIntegrationOperation({
					client,
					pluginId: other.pluginId,
					integrationId: integration.id,
					operationSlug: other.operationSlug,
				}),
			);
			assertTaggedError(foreignPrivate, "PluginNotFoundError");
			expect(foreignPrivate.reason).toEqual({
				pluginId: other.pluginId,
				code: "operation-not-found",
				operationSlug: other.operationSlug,
			});

			const foreignSystem = yield* Effect.flip(
				invokePrivateIntegrationOperation({
					client,
					integrationId: kodi.id,
					pluginId: declaring.pluginId,
					operationSlug: declaring.operationSlug,
				}),
			);
			assertTaggedError(foreignSystem, "PluginNotFoundError");
			expect(foreignSystem.reason).toEqual({
				pluginId: declaring.pluginId,
				code: "operation-scope-not-found",
				operationSlug: declaring.operationSlug,
			});
		}),
	);
});
