import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { DemoAccessPolicy } from "../../http-annotations";
import {
	CollectionBadRequest,
	CollectionNotFound,
	CollectionResponse,
	CreateCollectionBody,
	CreateMembershipBody,
	DeleteMembershipBody,
	MembershipResponse,
} from "./schemas";

export const CollectionsGroup = HttpApiGroup.make("collections")
	.annotate(OpenApi.Description, "Manages collections and their memberships")
	.add(
		HttpApiEndpoint.post("create", "/collections", {
			payload: CreateCollectionBody,
			success: CollectionResponse.pipe(HttpApiSchema.status(201)),
			error: [CollectionBadRequest.pipe(HttpApiSchema.status(400))],
		})
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(OpenApi.Description, "Creates a collection"),
	)
	.add(
		HttpApiEndpoint.post("createMembership", "/collections/memberships", {
			payload: CreateMembershipBody,
			success: MembershipResponse.pipe(HttpApiSchema.status(201)),
			error: [
				CollectionBadRequest.pipe(HttpApiSchema.status(400)),
				CollectionNotFound.pipe(HttpApiSchema.status(404)),
			],
		})
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(OpenApi.Description, "Adds an entity to a collection"),
	)
	.add(
		HttpApiEndpoint.delete("deleteMembership", "/collections/memberships", {
			success: MembershipResponse,
			payload: DeleteMembershipBody,
			error: [
				CollectionBadRequest.pipe(HttpApiSchema.status(400)),
				CollectionNotFound.pipe(HttpApiSchema.status(404)),
			],
		})
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(OpenApi.Description, "Removes an entity from a collection"),
	)
	.middleware(AuthMiddleware);
