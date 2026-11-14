import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { SubmissionExpired } from "../../errors";
import { EntityId } from "../../schema/brands";
import { PopulateEntitiesBody } from "../live-updates/messages";
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
	.add(
		AuthenticatedMutationEndpoint.post("demo-write")("populate", "/entities/populate", {
			payload: PopulateEntitiesBody,
		}).annotate(
			OpenApi.Description,
			"Queue provider work for the entities a page shows that are missing data or stale.",
		),
	)
	.annotate(OpenApi.Description, "Create entities.")
	.add(
		AuthenticatedMutationEndpoint.post("write")("create", "/entities", {
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
		AuthenticatedMutationEndpoint.post("write")("saveEditor", "/entities/editor", {
			success: EntityEditorSaveResult,
			payload: EntityEditorSaveRequest,
			error: [
				EntityBadRequest.pipe(HttpApiSchema.status(400)),
				RelationshipBadRequest.pipe(HttpApiSchema.status(400)),
				EntityNotFound.pipe(HttpApiSchema.status(404)),
				RelationshipNotFound.pipe(HttpApiSchema.status(404)),
				EntityEditorRefused.pipe(HttpApiSchema.status(409)),
				SubmissionExpired.pipe(HttpApiSchema.status(410)),
			],
		}).annotate(
			OpenApi.Description,
			"Save or delete a user entity and its declared relationships through its schema editor.",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.post("demo-write")(
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
