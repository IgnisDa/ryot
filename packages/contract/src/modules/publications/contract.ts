import { Context, Schema } from "effect";
import {
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiMiddleware,
	HttpApiSchema,
	HttpApiSecurity,
	OpenApi,
} from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import type { PublicationId } from "../../schema/brands";
import { DownloadResolutionInput, DownloadResolutionResponse } from "../assets/schemas";
import { ClientCompositionDocument } from "../pages/schemas";
import { RyotQLBadRequest, RyotQLInternalError } from "../ryotql/contract";
import { RyotQLResponse } from "../ryotql/language";
import { DescribeRequest, DescribeResponse, ExecutionRequest } from "../ryotql/request";
import {
	CreatePublicationBody,
	CreatePublicationLinkBody,
	ExchangePublicationLinkBody,
	PUBLICATION_SESSION_HEADER,
	PublicationBadRequest,
	PublicationDocumentBody,
	PublicationDocumentStale,
	PublicationIdBody,
	PublicationLinkIdBody,
	PublicationLinkResponse,
	PublicationNotFound,
	PublicationRateLimited,
	PublicationResponse,
	PublicationsDisabled,
	PublicationSessionResponse,
	PublicationStatusResponse,
	PublicationUnavailable,
	PublicationVisitorPage,
	RepublishPublicationBody,
} from "./schemas";

export type PublicationPrincipalValue = {
	readonly sessionKey: string;
	readonly publicationId: PublicationId;
};

export class PublicationPrincipal extends Context.Service<
	PublicationPrincipal,
	PublicationPrincipalValue
>()("@ryot-app/contract/modules/publications/contract/PublicationPrincipal") {}

export class PublicationMiddleware extends HttpApiMiddleware.Service<
	PublicationMiddleware,
	{ provides: PublicationPrincipal }
>()("PublicationMiddleware", {
	security: { session: HttpApiSecurity.apiKey({ in: "header", key: PUBLICATION_SESSION_HEADER }) },
	error: [
		PublicationUnavailable.pipe(HttpApiSchema.status(410)),
		PublicationRateLimited.pipe(HttpApiSchema.status(429)),
	],
}) {}

const ownerErrors = [
	PublicationNotFound.pipe(HttpApiSchema.status(404)),
	PublicationsDisabled.pipe(HttpApiSchema.status(403)),
	PublicationBadRequest.pipe(HttpApiSchema.status(400)),
];

export const PublicationsGroup = HttpApiGroup.make("publications")
	.annotate(OpenApi.Description, "Publishes read-only presentations of selected user content")
	.add(
		AuthenticatedMutationEndpoint.post("protected")("create", "/publications", {
			error: ownerErrors,
			payload: CreatePublicationBody,
			success: PublicationResponse.pipe(HttpApiSchema.status(201)),
		}).annotate(OpenApi.Description, "Creates a publication from a scope query"),
	)
	.add(
		AuthenticatedMutationEndpoint.put("protected")("republish", "/publications", {
			error: ownerErrors,
			success: PublicationResponse,
			payload: RepublishPublicationBody,
		}).annotate(OpenApi.Description, "Replaces a publication's frozen definition"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")("revoke", "/publications/revoke", {
			error: ownerErrors,
			success: Schema.Void,
			payload: PublicationIdBody,
		}).annotate(OpenApi.Description, "Revokes a publication and all of its links"),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("protected")("delete", "/publications", {
			error: ownerErrors,
			success: Schema.Void,
			payload: PublicationIdBody,
		}).annotate(OpenApi.Description, "Deletes a publication and its links"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")("createLink", "/publications/links", {
			error: ownerErrors,
			payload: CreatePublicationLinkBody,
			success: PublicationLinkResponse.pipe(HttpApiSchema.status(201)),
		}).annotate(
			OpenApi.Description,
			"Mints an unlisted link; the secret is returned once and stored only as a hash",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")("revokeLink", "/publications/links/revoke", {
			error: ownerErrors,
			success: Schema.Void,
			payload: PublicationLinkIdBody,
		}).annotate(OpenApi.Description, "Revokes one publication link"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("status", "/publications/status", {
			error: ownerErrors,
			payload: PublicationIdBody,
			success: PublicationStatusResponse,
		}).annotate(OpenApi.Description, "Evaluates a publication's source as visitors would see it"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("preview", "/publications/preview", {
			error: ownerErrors,
			payload: PublicationIdBody,
			success: PublicationSessionResponse,
		}).annotate(
			OpenApi.Description,
			"Starts a visitor session for the owner to preview exactly what visitors see",
		),
	)
	.middleware(AuthMiddleware);

const visitorErrors = [
	PublicationUnavailable.pipe(HttpApiSchema.status(410)),
	PublicationRateLimited.pipe(HttpApiSchema.status(429)),
];

export const PublicationVisitsGroup = HttpApiGroup.make("publicationVisits")
	.annotate(OpenApi.Description, "Anonymous, read-only access to published content")
	.add(
		HttpApiEndpoint.post("exchange", "/publications/visit/exchange", {
			error: visitorErrors,
			success: PublicationSessionResponse,
			payload: ExchangePublicationLinkBody,
		}).annotate(OpenApi.Description, "Exchanges a link secret for a short-lived visitor session"),
	)
	.add(
		HttpApiEndpoint.post("page", "/publications/visit/page", {
			error: visitorErrors,
			success: PublicationVisitorPage,
		})
			.middleware(PublicationMiddleware)
			.annotate(OpenApi.Description, "Prepares the published page for the visitor session"),
	)
	.add(
		HttpApiEndpoint.post("document", "/publications/visit/document", {
			payload: PublicationDocumentBody,
			success: ClientCompositionDocument,
			error: [...visitorErrors, PublicationDocumentStale.pipe(HttpApiSchema.status(409))],
		})
			.middleware(PublicationMiddleware)
			.annotate(OpenApi.Description, "Generates the published page's composition document"),
	)
	.add(
		HttpApiEndpoint.post("ryotql", "/publications/visit/ryotql", {
			success: RyotQLResponse,
			payload: ExecutionRequest,
			error: [
				...visitorErrors,
				RyotQLBadRequest.pipe(HttpApiSchema.status(400)),
				RyotQLInternalError.pipe(HttpApiSchema.status(500)),
			],
		})
			.middleware(PublicationMiddleware)
			.annotate(
				OpenApi.Description,
				"Reads published rows; only the published subjects are visible",
			),
	)
	.add(
		HttpApiEndpoint.post("describe", "/publications/visit/ryotql/describe", {
			payload: DescribeRequest,
			success: DescribeResponse,
			error: [
				...visitorErrors,
				RyotQLBadRequest.pipe(HttpApiSchema.status(400)),
				RyotQLInternalError.pipe(HttpApiSchema.status(500)),
			],
		})
			.middleware(PublicationMiddleware)
			.annotate(
				OpenApi.Description,
				"Describe query parameters and controls under publication visibility.",
			),
	)
	.add(
		HttpApiEndpoint.post("assets", "/publications/visit/assets", {
			error: visitorErrors,
			payload: DownloadResolutionInput,
			success: DownloadResolutionResponse,
		})
			.middleware(PublicationMiddleware)
			.annotate(
				OpenApi.Description,
				"Resolves download URLs for stored files referenced by published subjects",
			),
	);
