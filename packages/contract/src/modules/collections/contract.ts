import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
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
		AuthenticatedMutationEndpoint.post("allowed")("create", "/collections", {
			payload: CreateCollectionBody,
			success: CollectionResponse.pipe(HttpApiSchema.status(201)),
			error: [CollectionBadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Creates a collection"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("createMembership", "/collections/memberships", {
			payload: CreateMembershipBody,
			success: MembershipResponse.pipe(HttpApiSchema.status(201)),
			error: [
				CollectionBadRequest.pipe(HttpApiSchema.status(400)),
				CollectionNotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Adds an entity to a collection"),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("allowed")(
			"deleteMembership",
			"/collections/memberships",
			{
				success: MembershipResponse,
				payload: DeleteMembershipBody,
				error: [
					CollectionBadRequest.pipe(HttpApiSchema.status(400)),
					CollectionNotFound.pipe(HttpApiSchema.status(404)),
				],
			},
		).annotate(OpenApi.Description, "Removes an entity from a collection"),
	)
	.middleware(AuthMiddleware);
