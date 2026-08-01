import { Schema } from "effect";

import { CanonicalBase64 } from "../../schema/base64";
import { ClientRendererId, PluginSlug, SavedViewId } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { AppSchema } from "../../schema/property-schema";
import { strictStruct } from "../../schema/utils";
import { RyotQLDocument } from "../ryotql/language";

export const ClientRendererFile = strictStruct({
	path: Schema.String,
	content: CanonicalBase64,
});

export const ClientRendererDefinition = strictStruct({
	entry: Schema.String,
	settingsSchema: AppSchema,
	automaticEntityPresentations: Schema.Boolean,
	files: Schema.Array(ClientRendererFile),
	pluginDependencies: Schema.Array(PluginSlug),
});
export type ClientRendererDefinition = typeof ClientRendererDefinition.Type;

export const ClientRendererRecord = strictStruct({
	slug: Schema.String,
	name: Schema.String,
	id: ClientRendererId,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	draftRevision: Schema.Int,
	draftDefinition: ClientRendererDefinition,
	publishedHash: Schema.NullOr(Schema.String),
	publishedRevision: Schema.NullOr(Schema.Int),
	publishedDefinition: Schema.NullOr(ClientRendererDefinition),
});
export type ClientRendererRecord = typeof ClientRendererRecord.Type;

export const ClientRendererMetadata = strictStruct({
	slug: Schema.String,
	name: Schema.String,
	id: ClientRendererId,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	draftRevision: Schema.Int,
	publishedHash: Schema.NullOr(Schema.String),
	publishedRevision: Schema.NullOr(Schema.Int),
});

export const CreateClientRendererBody = strictStruct({
	slug: Schema.String,
	name: Schema.String,
	draftDefinition: ClientRendererDefinition,
});

export const ReplaceClientRendererDraftBody = strictStruct({
	expectedDraftRevision: Schema.Int,
	draftDefinition: ClientRendererDefinition,
});

export const PublishClientRendererBody = strictStruct({ expectedDraftRevision: Schema.Int });

export const PublishClientRendererResponse = strictStruct({
	buildId: Schema.String,
	publishedHash: Schema.String,
	publishedRevision: Schema.Int,
});

export const ClientRendererErrorReason = Schema.Union([
	strictStruct({ code: Schema.Literal("renderer-in-use") }),
	strictStruct({ code: Schema.Literal("renderer-not-found") }),
	strictStruct({ code: Schema.Literal("draft-revision-stale") }),
	strictStruct({ code: Schema.Literal("renderer-unpublished") }),
	strictStruct({ code: Schema.Literal("definition-invalid"), message: Schema.String }),
	strictStruct({ code: Schema.Literal("export-not-found"), exportName: Schema.String }),
	strictStruct({ code: Schema.Literal("settings-incompatible"), message: Schema.String }),
	strictStruct({ code: Schema.Literal("dependency-unavailable"), pluginSlug: PluginSlug }),
	strictStruct({ code: Schema.Literal("build-failed"), diagnostics: Schema.Array(Schema.String) }),
]);

export class ClientRendererBadRequest extends Schema.TaggedError<ClientRendererBadRequest>()(
	"ClientRendererBadRequest",
	{ reason: ClientRendererErrorReason },
) {}

export class ClientRendererNotFound extends Schema.TaggedError<ClientRendererNotFound>()(
	"ClientRendererNotFound",
	{ reason: strictStruct({ code: Schema.Literal("renderer-not-found") }) },
) {}

export const ClientPageTarget = strictStruct({
	savedViewId: SavedViewId,
	kind: Schema.Literal("saved-view"),
});

export const PrepareClientPageBody = strictStruct({ target: ClientPageTarget });

export const PreparedClientPageIdentity = strictStruct({
	buildId: Schema.String,
	savedViewId: SavedViewId,
	viewRevision: Schema.Int,
	artifactHash: Schema.String,
	rendererId: ClientRendererId,
	publishedHash: Schema.String,
	publishedRevision: Schema.Int,
});

export const PreparedClientPageContext = strictStruct({
	target: ClientPageTarget,
	dataSources: Schema.NullOr(RyotQLDocument),
	settings: Schema.Record(Schema.String, JsonValue),
	renderer: strictStruct({ kind: Schema.Literal("custom"), id: ClientRendererId }),
});

export const PreparedClientPage = strictStruct({
	context: PreparedClientPageContext,
	identity: PreparedClientPageIdentity,
	artifact: strictStruct({
		format: Schema.Int,
		hash: Schema.String,
		apiVersion: Schema.Int,
		bridgeVersion: Schema.Int,
		compilerVersion: Schema.Int,
	}),
});
export type PreparedClientPage = typeof PreparedClientPage.Type;

export const CreateClientPageSessionBody = strictStruct({ identity: PreparedClientPageIdentity });

export const CreateClientPageSessionResponse = strictStruct({
	token: Schema.String,
	sessionId: Schema.String,
	expiresAt: Schema.String,
});

export const RenewClientPageSessionResponse = strictStruct({ expiresAt: Schema.String });

export class ClientPageStalePreparation extends Schema.TaggedError<ClientPageStalePreparation>()(
	"ClientPageStalePreparation",
	{ reason: strictStruct({ code: Schema.Literal("stale-preparation") }) },
) {}

export class ClientPageSessionNotFound extends Schema.TaggedError<ClientPageSessionNotFound>()(
	"ClientPageSessionNotFound",
	{ reason: strictStruct({ code: Schema.Literal("page-session-not-found") }) },
) {}
