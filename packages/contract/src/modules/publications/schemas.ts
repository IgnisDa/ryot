import { Schema } from "effect";

import { PublicationId, PublicationLinkId } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { IsoUtcString, strictStruct } from "../../schema/utils";
import { ClientPageCodeContributor } from "../pages/schemas";
import { RyotQLDocument } from "../ryotql/authored";
import { EntitySourceReference } from "../ryotql/entity-source";

export const PUBLICATION_SUBJECT_LIMIT = 5000;
export const PUBLICATION_SESSION_HEADER = "x-ryot-publication-session";

const boundedText = (maxLength: number) =>
	Schema.String.pipe(Schema.check(Schema.isMaxLength(maxLength)));

export const PublicationSource = EntitySourceReference;
export type PublicationSource = typeof PublicationSource.Type;

const PublicationDetailsFields = {
	title: boundedText(120),
	source: PublicationSource,
	icon: Schema.NonEmptyString,
	showOwnerName: Schema.Boolean,
	description: Schema.NullOr(boundedText(2000)),
};

export const CreatePublicationBody = strictStruct(PublicationDetailsFields);
export type CreatePublicationBody = typeof CreatePublicationBody.Type;

export const RepublishPublicationBody = strictStruct({
	...PublicationDetailsFields,
	publicationId: PublicationId,
});
export type RepublishPublicationBody = typeof RepublishPublicationBody.Type;

export const PublicationResponse = strictStruct({
	revision: Schema.Int,
	publicationId: PublicationId,
});

export const PublicationIdBody = strictStruct({ publicationId: PublicationId });

export const PublicationStatusResponse = Schema.Union([
	strictStruct({ itemCount: Schema.Int, status: Schema.Literal("ready") }),
	strictStruct({ limit: Schema.Int, status: Schema.Literal("too-large") }),
	strictStruct({ status: Schema.Literal("source-unavailable") }),
]);
export type PublicationStatusResponse = typeof PublicationStatusResponse.Type;

export const CreatePublicationLinkBody = strictStruct({
	label: boundedText(80),
	publicationId: PublicationId,
	expiresAt: Schema.NullOr(IsoUtcString),
});
export type CreatePublicationLinkBody = typeof CreatePublicationLinkBody.Type;

export const PublicationLinkResponse = strictStruct({
	secret: Schema.String,
	linkId: PublicationLinkId,
});

export const PublicationLinkIdBody = strictStruct({ linkId: PublicationLinkId });

export const PublicationSessionResponse = strictStruct({
	expiresAt: IsoUtcString,
	sessionToken: Schema.String,
});

export const ExchangePublicationLinkBody = strictStruct({
	secret: Schema.String,
	publicationId: PublicationId,
});

const PublicationPresentation = strictStruct({
	icon: Schema.String,
	title: Schema.String,
	revision: Schema.Int,
	itemCount: Schema.Int,
	publicationId: PublicationId,
	ownerName: Schema.NullOr(Schema.String),
	description: Schema.NullOr(Schema.String),
});

const PublicationPageContext = strictStruct({
	dataSources: Schema.NullOr(RyotQLDocument),
	settings: Schema.Record(Schema.String, JsonValue),
	contributors: Schema.Array(ClientPageCodeContributor),
	route: strictStruct({ params: Schema.Record(Schema.String, Schema.String) }),
	renderer: strictStruct({ name: Schema.String, kind: Schema.Literal("kernel") }),
	view: Schema.NullOr(strictStruct({ icon: Schema.String, name: Schema.String })),
	target: strictStruct({ publicationId: PublicationId, kind: Schema.Literal("publication") }),
});

export const PublicationVisitorPage = strictStruct({
	context: PublicationPageContext,
	publication: PublicationPresentation,
	composition: strictStruct({
		format: Schema.Int,
		hash: Schema.String,
		apiVersion: Schema.Int,
		bridgeVersion: Schema.Int,
		compilerVersion: Schema.Int,
	}),
});
export type PublicationVisitorPage = typeof PublicationVisitorPage.Type;

export const PublicationDocumentBody = strictStruct({ compositionHash: Schema.String });

const PublicationBadRequestReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("source-unavailable") }),
	Schema.Struct({ limit: Schema.Int, code: Schema.Literal("scope-too-large") }),
	Schema.Struct({
		code: Schema.Literal("required-field"),
		field: Schema.Literals(["title", "icon", "label"]),
	}),
	Schema.Struct({ code: Schema.Literal("expiry-in-past") }),
	Schema.Struct({ code: Schema.Literal("publication-revoked") }),
]);

export class PublicationBadRequest extends Schema.TaggedError<
	PublicationBadRequest,
	{ readonly brand: unique symbol }
>()("PublicationBadRequest", { reason: PublicationBadRequestReason }) {}

const PublicationNotFoundReason = Schema.Union([
	Schema.Struct({ publicationId: PublicationId, code: Schema.Literal("publication-not-found") }),
	Schema.Struct({ linkId: PublicationLinkId, code: Schema.Literal("link-not-found") }),
]);

export class PublicationNotFound extends Schema.TaggedError<
	PublicationNotFound,
	{ readonly brand: unique symbol }
>()("PublicationNotFound", { reason: PublicationNotFoundReason }) {}

export class PublicationsDisabled extends Schema.TaggedError<
	PublicationsDisabled,
	{ readonly brand: unique symbol }
>()("PublicationsDisabled", {
	reason: Schema.Struct({ code: Schema.Literal("publications-disabled") }),
}) {}

export const PublicationUnavailableCode = Schema.Literals([
	"disabled",
	"expired",
	"revoked",
	"not-found",
	"too-large",
	"unavailable",
	"session-expired",
]);
export type PublicationUnavailableCode = typeof PublicationUnavailableCode.Type;

export class PublicationUnavailable extends Schema.TaggedError<
	PublicationUnavailable,
	{ readonly brand: unique symbol }
>()("PublicationUnavailable", { reason: Schema.Struct({ code: PublicationUnavailableCode }) }) {}

export class PublicationRateLimited extends Schema.TaggedError<
	PublicationRateLimited,
	{ readonly brand: unique symbol }
>()("PublicationRateLimited", {
	reason: Schema.Struct({ code: Schema.Literal("publication-rate-limited") }),
}) {}

export class PublicationDocumentStale extends Schema.TaggedError<
	PublicationDocumentStale,
	{ readonly brand: unique symbol }
>()("PublicationDocumentStale", {
	reason: Schema.Struct({ code: Schema.Literal("publication-document-stale") }),
}) {}
