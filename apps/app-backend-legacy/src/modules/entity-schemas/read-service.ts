import { resolveRequiredString } from "@ryot/ts-utils/slug";

import { checkReadAccess } from "~/lib/access";
import type { AppConfigPath } from "~/lib/config";
import { appConfigEnvIndex, appConfigPathIndex } from "~/lib/config";
import { type ServiceResult, serviceData, serviceError, wrapServiceValidator } from "~/lib/result";
import { sandboxScriptMetadataSchema } from "~/lib/sandbox/types";
import { getTrackerScopeForUser } from "~/modules/trackers";

import {
	getEntitySchemaByIdForUser,
	type ListedEntitySchemaWithMetadata,
	listEntitySchemasForUser,
} from "./repository";
import type { ListedEntitySchema } from "./schemas";

type EntitySchemaReadError = "not_found" | "validation";

type EntitySchemaReadResult<T> = ServiceResult<T, EntitySchemaReadError>;

const entitySchemaNotFoundError = "Entity schema not found";
const trackerNotFoundError = "Tracker not found";

const isProviderUsable = (provider: { scriptMetadata?: unknown }): boolean => {
	const parsed = sandboxScriptMetadataSchema.safeParse(provider.scriptMetadata);
	const requiredKeys = parsed.success ? (parsed.data.requiredAppConfigKeys ?? []) : [];

	return requiredKeys.every((key) => {
		// oxlint-disable-next-line no-unsafe-type-assertion
		const envKey = appConfigPathIndex[key as AppConfigPath];
		return appConfigEnvIndex[envKey] != null;
	});
};

const stripProviderMetadata = (schema: ListedEntitySchemaWithMetadata): ListedEntitySchema => ({
	...schema,
	providers: schema.providers
		.filter(isProviderUsable)
		.map(({ scriptMetadata: _m, ...provider }) => provider),
});

const resolveEntitySchemaTrackerId = (trackerId: string) =>
	resolveRequiredString(trackerId, "Tracker id");

const resolveEntitySchemaTrackerIdResult = (trackerId: string) =>
	wrapServiceValidator(() => resolveEntitySchemaTrackerId(trackerId), "Tracker id is required");

export const listEntitySchemas = async (input: {
	slugs?: string[];
	trackerId?: string;
	userId: string;
}): Promise<EntitySchemaReadResult<ListedEntitySchema[]>> => {
	if (input.trackerId) {
		const trackerIdResult = resolveEntitySchemaTrackerIdResult(input.trackerId);
		if ("error" in trackerIdResult) {
			return trackerIdResult;
		}

		const trackerResult = checkReadAccess(
			await getTrackerScopeForUser({
				userId: input.userId,
				trackerId: trackerIdResult.data,
			}),
			{ not_found: trackerNotFoundError },
		);
		if ("error" in trackerResult) {
			return serviceError("not_found", trackerResult.message);
		}

		const entitySchemas = await listEntitySchemasForUser({
			slugs: input.slugs,
			userId: input.userId,
			trackerId: trackerIdResult.data,
		});

		return serviceData(entitySchemas.map(stripProviderMetadata));
	}

	const entitySchemas = await listEntitySchemasForUser({
		slugs: input.slugs,
		userId: input.userId,
	});

	return serviceData(entitySchemas.map(stripProviderMetadata));
};

export const getEntitySchemaById = async (input: {
	entitySchemaId: string;
	userId: string;
}): Promise<EntitySchemaReadResult<ListedEntitySchema>> => {
	const foundEntitySchema = await getEntitySchemaByIdForUser({
		userId: input.userId,
		entitySchemaId: input.entitySchemaId,
	});
	if (!foundEntitySchema) {
		return serviceError("not_found", entitySchemaNotFoundError);
	}

	return serviceData(stripProviderMetadata(foundEntitySchema));
};
