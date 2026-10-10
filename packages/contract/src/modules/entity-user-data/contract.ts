import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { EntityId } from "../../schema/brands";
import {
	ClearEntityUserDataResponse,
	MergeEntityUserDataBody,
	MergeEntityUserDataResponse,
	EntityUserDataBadRequest,
	EntityUserDataNotFound,
} from "./schemas";

export const EntityUserDataGroup = HttpApiGroup.make("entityUserData")
	.annotate(OpenApi.Description, "Manage user state for entities.")
	.add(
		AuthenticatedMutationEndpoint.delete("allowed")(
			"clearEntityUserData",
			"/entity-user-data/clear/:entityId",
			{
				params: { entityId: EntityId },
				success: ClearEntityUserDataResponse,
				error: [
					EntityUserDataBadRequest.pipe(HttpApiSchema.status(400)),
					EntityUserDataNotFound.pipe(HttpApiSchema.status(404)),
				],
			},
		).annotate(OpenApi.Description, "Clear the user's state for an entity."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")(
			"mergeEntityUserData",
			"/entity-user-data/merge",
			{
				payload: MergeEntityUserDataBody,
				success: MergeEntityUserDataResponse,
				error: [
					EntityUserDataBadRequest.pipe(HttpApiSchema.status(400)),
					EntityUserDataNotFound.pipe(HttpApiSchema.status(404)),
				],
			},
		).annotate(OpenApi.Description, "Merge changes into the user's entity state."),
	)
	.middleware(AuthMiddleware);
