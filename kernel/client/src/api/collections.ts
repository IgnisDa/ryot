import { AuthRateLimited, AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import type { ContractRequest } from "@ryot-app/contract/client";
import {
	CollectionBadRequest,
	CollectionNotFound,
} from "@ryot-app/contract/modules/collections/schemas";
import { Context, Effect, Layer, Schema } from "effect";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

const isDeclaredFailure = Schema.is(
	Schema.Union([AuthRateLimited, AuthUnauthorized, CollectionBadRequest, CollectionNotFound]),
);

export const classifyCollectionFailure = (error: unknown) =>
	error instanceof AuthenticatedApiError && isDeclaredFailure(error.cause)
		? "collection-failed"
		: "transport";

export class CollectionsApi extends Context.Service<CollectionsApi>()("CollectionsApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		return {
			create: (scope: ApiScope, request: ContractRequest<"collections", "create">) =>
				api.run(scope, (client) => client.collections.create(request)),
			createMembership: (
				scope: ApiScope,
				request: ContractRequest<"collections", "createMembership">,
			) => api.run(scope, (client) => client.collections.createMembership(request)),
			deleteMembership: (
				scope: ApiScope,
				request: ContractRequest<"collections", "deleteMembership">,
			) => api.run(scope, (client) => client.collections.deleteMembership(request)),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
