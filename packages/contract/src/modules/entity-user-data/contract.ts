import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { EntityId } from "../../schema/brands";
import {
	ClearEntityUserDataRequest,
	ClearEntityUserDataResponse,
	EntityUserDataBadRequest,
	EntityUserDataNotFound,
	MergeEntityUserDataRequest,
	MergeEntityUserDataResponse,
} from "./schemas";

export const EntityUserDataGroup = HttpApiGroup.make("entityUserData")
	.annotate(OpenApi.Description, "Manage user state for entities.")
	.add(
		AuthenticatedMutationEndpoint.delete("protected")(
			"clearEntityUserData",
			"/entity-user-data/clear/:entityId",
			{
				params: { entityId: EntityId },
				payload: ClearEntityUserDataRequest,
				success: ClearEntityUserDataResponse,
				error: [
					EntityUserDataBadRequest.pipe(HttpApiSchema.status(400)),
					EntityUserDataNotFound.pipe(HttpApiSchema.status(404)),
				],
			},
		).annotate(OpenApi.Description, "Clear the user's state for an entity."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")(
			"mergeEntityUserData",
			"/entity-user-data/merge",
			{
				payload: MergeEntityUserDataRequest,
				success: MergeEntityUserDataResponse,
				error: [
					EntityUserDataBadRequest.pipe(HttpApiSchema.status(400)),
					EntityUserDataNotFound.pipe(HttpApiSchema.status(404)),
				],
			},
		).annotate(OpenApi.Description, "Merge changes into the user's entity state."),
	)
	.middleware(AuthMiddleware);
