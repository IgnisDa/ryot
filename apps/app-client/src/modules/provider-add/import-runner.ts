import type { EntityId, SandboxProviderId } from "@ryot/contract/schema/brands";
import { RelationshipSchemaSlug } from "@ryot/contract/schema/brands";
import { userLibraryRecipe } from "@ryot/ryotql-recipes/user-library";
import { Effect } from "effect";

import { appClient } from "@/api/client";
import { getProviderEntityImportResult, startProviderEntityImport } from "@/api/provider-entities";
import type { ApiScope } from "@/api/request-key";

import { importProviderEntity } from "./import-controller";

export const addProviderEntityToLibrary = (input: {
	readonly scope: ApiScope;
	readonly entityId: EntityId;
}) =>
	Effect.gen(function* () {
		const client = appClient(input.scope);
		const library = yield* client.ryotql.execute(userLibraryRecipe());
		yield* client.request.pipe(
			Effect.flatMap((requestClient) =>
				requestClient.relationships.create({
					payload: {
						properties: {},
						sourceEntityId: input.entityId,
						targetEntityId: library.entityId,
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
