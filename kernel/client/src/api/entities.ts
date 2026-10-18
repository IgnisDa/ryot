import { AuthRateLimited, AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import type { ContractRequest } from "@ryot-app/contract/client";
import { EntityEditorRefused } from "@ryot-app/contract/modules/entities/editor";
import {
	EntityBadRequest,
	EntityEnrichmentRefused,
	EntityNotFound,
} from "@ryot-app/contract/modules/entities/schemas";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import { Context, Effect, Layer, Schema } from "effect";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

const isDeclaredFailure = Schema.is(
	Schema.Union([
		AuthRateLimited,
		AuthUnauthorized,
		EntityBadRequest,
		EntityNotFound,
		EntityEditorRefused,
		RelationshipBadRequest,
		RelationshipNotFound,
	]),
);

export const isDeclaredEntitySaveFailure = (error: unknown) =>
	error instanceof AuthenticatedApiError && isDeclaredFailure(error.cause);

const isDeclaredRetryFailure = Schema.is(
	Schema.Union([AuthRateLimited, AuthUnauthorized, EntityNotFound, EntityEnrichmentRefused]),
);

export const isDeclaredEnrichmentFailure = (error: unknown) =>
	error instanceof AuthenticatedApiError && isDeclaredRetryFailure(error.cause);

export class EntitiesApi extends Context.Service<EntitiesApi>()("EntitiesApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		return {
			saveEditor: (scope: ApiScope, request: ContractRequest<"entities", "saveEditor">) =>
				api.run(scope, (client) => client.entities.saveEditor(request)),
			requestEnrichment: (
				scope: ApiScope,
				request: ContractRequest<"entities", "requestEnrichment">,
			) => api.run(scope, (client) => client.entities.requestEnrichment(request)),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
