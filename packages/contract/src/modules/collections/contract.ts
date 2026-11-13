import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import {
	CollectionBadRequest,
	CollectionConflict,
	CollectionNotFound,
	CollectionResponse,
	CreateCollectionBody,
	CreateMembershipBody,
	DeleteCollectionBody,
	DeleteCollectionResponse,
	DeleteMembershipBody,
	MembershipResponse,
	ReorderMembershipBody,
	ReorderMembershipResponse,
	UpdateCollectionBody,
} from "./schemas";

export const CollectionsGroup = HttpApiGroup.make("collections")
	.annotate(OpenApi.Description, "Manages collections and their memberships")
	.add(
		AuthenticatedMutationEndpoint.post("demo-write")("create", "/collections", {
			payload: CreateCollectionBody,
			success: CollectionResponse.pipe(HttpApiSchema.status(201)),
			error: [CollectionBadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Creates a collection"),
	)
	.add(
		AuthenticatedMutationEndpoint.patch("demo-write")("update", "/collections", {
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
		AuthenticatedMutationEndpoint.delete("demo-write")("delete", "/collections", {
			payload: DeleteCollectionBody,
			success: DeleteCollectionResponse,
			error: [
				CollectionBadRequest.pipe(HttpApiSchema.status(400)),
				CollectionNotFound.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Deletes a collection and its memberships"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("demo-write")(
			"createMembership",
			"/collections/memberships",
			{
				payload: CreateMembershipBody,
				success: MembershipResponse.pipe(HttpApiSchema.status(201)),
				error: [
					CollectionBadRequest.pipe(HttpApiSchema.status(400)),
					CollectionNotFound.pipe(HttpApiSchema.status(404)),
				],
			},
		).annotate(OpenApi.Description, "Adds an entity to a collection"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("demo-write")(
			"reorderMembership",
			"/collections/memberships/reorder",
			{
				payload: ReorderMembershipBody,
				success: ReorderMembershipResponse,
				error: [
					CollectionNotFound.pipe(HttpApiSchema.status(404)),
					CollectionConflict.pipe(HttpApiSchema.status(409)),
				],
			},
		).annotate(OpenApi.Description, "Moves a member in the collection's manual order"),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("demo-write")(
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
