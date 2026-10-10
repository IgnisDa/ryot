import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { EntityId } from "../../schema/brands";
import {
	ClearUserStateResponse,
	MergeUserStateBody,
	MergeUserStateResponse,
	UserStateBadRequest,
	UserStateNotFound,
} from "./schemas";

export const UserStateGroup = HttpApiGroup.make("userState")
	.annotate(OpenApi.Description, "Manage user state for entities.")
	.add(
		AuthenticatedMutationEndpoint.delete("allowed")(
			"clearUserState",
			"/user-state/clear/:entityId",
			{
				params: { entityId: EntityId },
				success: ClearUserStateResponse,
				error: [
					UserStateBadRequest.pipe(HttpApiSchema.status(400)),
					UserStateNotFound.pipe(HttpApiSchema.status(404)),
				],
			},
		).annotate(OpenApi.Description, "Clear the user's state for an entity."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("mergeUserState", "/user-state/merge", {
			payload: MergeUserStateBody,
			success: MergeUserStateResponse,
			error: [
				UserStateBadRequest.pipe(HttpApiSchema.status(400)),
				UserStateNotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Merge changes into the user's entity state."),
	)
	.middleware(AuthMiddleware);
