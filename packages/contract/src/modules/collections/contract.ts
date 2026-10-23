import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import {
	CollectionBadRequest,
	CollectionNotFound,
	CollectionResponse,
	CreateCollectionBody,
	CreateMembershipBody,
	DeleteCollectionBody,
	DeleteCollectionResponse,
	DeleteMembershipBody,
	MembershipResponse,
	UpdateCollectionBody,
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
		AuthenticatedMutationEndpoint.patch("allowed")("update", "/collections", {
			success: CollectionResponse,
			payload: UpdateCollectionBody,
			error: [
				CollectionBadRequest.pipe(HttpApiSchema.status(400)),
				CollectionNotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(
			OpenApi.Description,
			"Replaces a collection's name, description, and member fields",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("allowed")("delete", "/collections", {
			payload: DeleteCollectionBody,
			success: DeleteCollectionResponse,
			error: [
				CollectionBadRequest.pipe(HttpApiSchema.status(400)),
				CollectionNotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Deletes a collection and its memberships"),
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
