import { badRequest, notFound } from "@ryot/contract/errors";
import { IntegrationId } from "@ryot/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import { IntegrationOperationScopeResolver } from "#modules/plugins/operations-service";

import { IntegrationsRepository } from "./repository";

const IntegrationPayload = Schema.Struct({ integrationId: Schema.String });

export const IntegrationOperationScopeResolverLive = Layer.effect(
	IntegrationOperationScopeResolver,
	Effect.gen(function* () {
		const database = yield* Database;
		const repository = yield* IntegrationsRepository;

		return {
			resolve: (payload: unknown) =>
				Effect.gen(function* () {
					const decoded = yield* Schema.decodeUnknownEffect(IntegrationPayload)(payload).pipe(
						Effect.mapError(() => badRequest("integrationId is required")),
					);
					const integrationId = IntegrationId.make(decoded.integrationId);
					const integration = yield* repository
						.getByIdAnyUser({ integrationId })
						.pipe(Effect.provideService(Database, database));
					if (!integration || integration.isDisabled) {
						return yield* notFound("Integration not found");
					}
					return {
						integrationId,
						userId: integration.userId,
						pluginInstallationId: integration.pluginInstallationId,
					};
				}),
		};
	}),
);
