import { AuthRateLimited, AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import type { ContractRequest } from "@ryot-app/contract/client";
import {
	CollectionBadRequest,
	CollectionConflict,
	CollectionNotFound,
} from "@ryot-app/contract/modules/collections/schemas";
import { Context, Effect, Layer, Schema } from "effect";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

const isDeclaredFailure = Schema.is(
	Schema.Union([
		AuthRateLimited,
		AuthUnauthorized,
		CollectionBadRequest,
		CollectionConflict,
		CollectionNotFound,
	]),
);

export const classifyCollectionFailure = (
	error: unknown,
): "transport" | "collection-stale" | "collection-failed" => {
	if (!(error instanceof AuthenticatedApiError) || !isDeclaredFailure(error.cause)) {
		return "transport";
	}
	if (error.cause instanceof CollectionConflict && error.cause.reason.code === "order-stale") {
		return "collection-stale";
	}
	return "collection-failed";
};

export class CollectionsApi extends Context.Service<CollectionsApi>()("CollectionsApi", {
	make: Effect.gen(function* () {
		const api = yield* AuthenticatedApi;
		return {
			create: (scope: ApiScope, request: ContractRequest<"collections", "create">) =>
				api.run(scope, (client) => client.collections.create(request)),
			update: (scope: ApiScope, request: ContractRequest<"collections", "update">) =>
				api.run(scope, (client) => client.collections.update(request)),
			delete: (scope: ApiScope, request: ContractRequest<"collections", "delete">) =>
				api.run(scope, (client) => client.collections.delete(request)),
			createMembership: (
				scope: ApiScope,
				request: ContractRequest<"collections", "createMembership">,
			) => api.run(scope, (client) => client.collections.createMembership(request)),
			deleteMembership: (
				scope: ApiScope,
				request: ContractRequest<"collections", "deleteMembership">,
			) => api.run(scope, (client) => client.collections.deleteMembership(request)),
			reorderMembership: (
				scope: ApiScope,
				request: ContractRequest<"collections", "reorderMembership">,
			) => api.run(scope, (client) => client.collections.reorderMembership(request)),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
