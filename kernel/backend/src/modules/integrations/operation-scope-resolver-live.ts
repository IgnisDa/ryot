import { badRequest, notFound } from "@ryot-app/contract/errors";
import { IntegrationId, IntegrationWebhookToken } from "@ryot-app/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import { IntegrationOperationScopeResolver } from "#modules/plugins/operations-service";

import { IntegrationsRepository } from "./repository";

const IntegrationPayload = Schema.Union([
	Schema.Struct({ integrationId: Schema.String }),
	Schema.Struct({ webhookToken: Schema.String }),
]);

export const IntegrationOperationScopeResolverLive = Layer.effect(
	IntegrationOperationScopeResolver,
	Effect.gen(function* () {
		const database = yield* Database;
		const repository = yield* IntegrationsRepository;

		return {
			resolve: (payload: unknown) =>
				Effect.gen(function* () {
					const decoded = yield* Schema.decodeUnknownEffect(IntegrationPayload)(payload).pipe(
						Effect.mapError(() => badRequest("integrationId or webhookToken is required")),
					);
					const integration = yield* (
						"webhookToken" in decoded
							? repository.getByWebhookToken(IntegrationWebhookToken.make(decoded.webhookToken))
							: repository.getByIdAnyUser({
									integrationId: IntegrationId.make(decoded.integrationId),
								})
					).pipe(Effect.provideService(Database, database));
					if (!integration || integration.isDisabled) {
						return yield* notFound("Integration not found");
					}
					if ("integrationId" in decoded && integration.lot === "sink") {
						return yield* notFound("Integration not found");
					}
					return {
						userId: integration.userId,
						integrationId: integration.id,
						pluginInstallationId: integration.pluginInstallationId,
					};
				}),
		};
	}),
);
