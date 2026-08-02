import type { EntityId, SandboxProviderId } from "@ryot/contract/schema/brands";
import { RelationshipSchemaSlug } from "@ryot/contract/schema/brands";
import {
	buildUserLibraryDocument,
	decodeUserLibraryResponse,
} from "@ryot/ryotql-recipes/user-library";
import { Effect, Result } from "effect";

import { appClient, retryQueryResponse } from "@/api/client";
import { getProviderEntityImportResult, startProviderEntityImport } from "@/api/provider-entities";
import type { ApiScope } from "@/api/request-key";

import { importProviderEntity } from "./import-controller";

export const addProviderEntityToLibrary = (input: {
	readonly scope: ApiScope;
	readonly entityId: EntityId;
}) =>
	Effect.gen(function* () {
		const request = appClient(input.scope).request;
		const response = yield* request.pipe(
			Effect.flatMap((client) => client.ryotql.execute({ payload: buildUserLibraryDocument() })),
			retryQueryResponse,
		);
		const decoded = decodeUserLibraryResponse(response);
		if (Result.isFailure(decoded)) {
			return yield* Effect.fail(decoded.failure);
		}
		yield* request.pipe(
			Effect.flatMap((client) =>
				client.relationships.create({
					payload: {
						properties: {},
						sourceEntityId: input.entityId,
						targetEntityId: decoded.success.entityId,
						relationshipSchemaSlug: RelationshipSchemaSlug.make("in-library"),
					},
				}),
			),
		);
		return undefined;
	});

export const runProviderEntityImport = (input: {
	readonly scope: ApiScope;
	readonly externalId: string;
	readonly providerId: SandboxProviderId;
	readonly onImported?: ((entityId: EntityId) => Effect.Effect<void, unknown>) | undefined;
}) =>
	importProviderEntity({
		onImported: input.onImported,
		poll: (jobId) => getProviderEntityImportResult(input.scope, jobId),
		start: startProviderEntityImport(input.scope, {
			providerId: input.providerId,
			externalId: input.externalId,
		}),
	});
