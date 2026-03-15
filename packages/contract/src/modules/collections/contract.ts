import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import {
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
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Creates a collection"),
	)
	.add(
		HttpApiEndpoint.post("createMembership", "/collections/memberships", {
			payload: CreateMembershipBody,
			success: MembershipResponse.pipe(HttpApiSchema.status(201)),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Adds an entity to a collection"),
	)
	.add(
		HttpApiEndpoint.delete("deleteMembership", "/collections/memberships", {
			payload: DeleteMembershipBody,
			success: MembershipResponse,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Removes an entity from a collection"),
	)
	.middleware(AuthMiddleware);
