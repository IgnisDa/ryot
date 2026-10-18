import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { EntityId } from "../../schema/brands";
import { RelationshipBadRequest, RelationshipNotFound } from "../relationships/schemas";
import { EntityEditorRefused, EntityEditorSaveRequest, EntityEditorSaveResult } from "./editor";
import {
	CreateEntityBody,
	EntityBadRequest,
	EntityEnrichmentRefused,
	EntityMutationResult,
	EntityNotFound,
	EntityStale,
	RequestEntityEnrichmentBody,
	RequestEntityEnrichmentResult,
} from "./schemas";

export const EntitiesGroup = HttpApiGroup.make("entities")
	.annotate(OpenApi.Description, "Create entities.")
	.add(
		AuthenticatedMutationEndpoint.post("protected")("create", "/entities", {
			payload: CreateEntityBody,
			success: EntityMutationResult.pipe(HttpApiSchema.status(201)),
			error: [
				EntityBadRequest.pipe(HttpApiSchema.status(400)),
				EntityNotFound.pipe(HttpApiSchema.status(404)),
				EntityStale.pipe(HttpApiSchema.status(409)),
			],
		}).annotate(OpenApi.Description, "Create an entity."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")("saveEditor", "/entities/editor", {
			success: EntityEditorSaveResult,
			payload: EntityEditorSaveRequest,
			error: [
				EntityBadRequest.pipe(HttpApiSchema.status(400)),
				RelationshipBadRequest.pipe(HttpApiSchema.status(400)),
				EntityNotFound.pipe(HttpApiSchema.status(404)),
				RelationshipNotFound.pipe(HttpApiSchema.status(404)),
				EntityEditorRefused.pipe(HttpApiSchema.status(409)),
			],
		}).annotate(
			OpenApi.Description,
			"Save a user entity and its declared outgoing relationships through its schema editor.",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")(
			"requestEnrichment",
			"/entities/:entityId/enrichment",
			{
				params: { entityId: EntityId },
				payload: RequestEntityEnrichmentBody,
				success: RequestEntityEnrichmentResult,
				error: [
					EntityNotFound.pipe(HttpApiSchema.status(404)),
					EntityEnrichmentRefused.pipe(HttpApiSchema.status(409)),
				],
			},
		).annotate(
			OpenApi.Description,
			"Refresh provider data or retry enrichment for a visible entity.",
		),
	)
	.middleware(AuthMiddleware);
