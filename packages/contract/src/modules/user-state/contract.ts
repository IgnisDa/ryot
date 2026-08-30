import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { DemoAccessPolicy } from "../../http-annotations";
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
		HttpApiEndpoint.delete("clearUserState", "/user-state/clear/:entityId", {
			params: { entityId: EntityId },
			success: ClearUserStateResponse,
			error: [
				UserStateBadRequest.pipe(HttpApiSchema.status(400)),
				UserStateNotFound.pipe(HttpApiSchema.status(404)),
			],
		})
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(OpenApi.Description, "Clear the user's state for an entity."),
	)
	.add(
		HttpApiEndpoint.post("mergeUserState", "/user-state/merge", {
			payload: MergeUserStateBody,
			success: MergeUserStateResponse,
			error: [
				UserStateBadRequest.pipe(HttpApiSchema.status(400)),
				UserStateNotFound.pipe(HttpApiSchema.status(404)),
			],
		})
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(OpenApi.Description, "Merge changes into the user's entity state."),
	)
	.middleware(AuthMiddleware);
