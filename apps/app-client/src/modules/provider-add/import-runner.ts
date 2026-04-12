import type { EntityId, SandboxProviderId } from "@ryot/contract/schema/brands";
import {
	buildUserLibraryDocument,
	decodeUserLibraryResponse,
} from "@ryot/ryotql-recipes/user-library";
import { Effect, Result } from "effect";

import {
	createInLibraryRelationship,
	executeRyotQL,
	getProviderEntityImportResult,
	startProviderEntityImport,
} from "@/api/queries";

import { importProviderEntity } from "./import-controller";

export const addProviderEntityToLibrary = (input: {
	readonly serverUrl: string;
	readonly entityId: EntityId;
}) =>
	Effect.gen(function* () {
		const response = yield* executeRyotQL(input.serverUrl, buildUserLibraryDocument());
		const decoded = decodeUserLibraryResponse(response);
		if (Result.isFailure(decoded)) {
			return yield* Effect.fail(decoded.failure);
		}
		yield* createInLibraryRelationship(input.serverUrl, {
			sourceEntityId: input.entityId,
			targetEntityId: decoded.success.entityId,
		});
	});

export const runProviderEntityImport = (input: {
	readonly serverUrl: string;
	readonly externalId: string;
	readonly providerId: SandboxProviderId;
	readonly onImported?: ((entityId: EntityId) => Effect.Effect<void, unknown>) | undefined;
}) =>
	importProviderEntity({
		onImported: input.onImported,
		poll: (jobId) => getProviderEntityImportResult(input.serverUrl, jobId),
		start: startProviderEntityImport(input.serverUrl, {
			providerId: input.providerId,
			externalId: input.externalId,
		}),
	});
