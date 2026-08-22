import { Schema } from "effect";

import { CanonicalBase64 } from "../../schema/base64";
import {
	ClientRendererId,
	EntityId,
	EntitySchemaSlug,
	PluginSlug,
	SavedViewId,
} from "../../schema/brands";
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

const SavedViewClientPageTarget = strictStruct({
	savedViewId: SavedViewId,
	kind: Schema.Literal("saved-view"),
});
const PluginClientPageTarget = Schema.Union([
	strictStruct({ entityId: EntityId, kind: Schema.Literal("entity") }),
	strictStruct({
		path: Schema.String,
		search: Schema.String,
		pluginId: Schema.String,
		kind: Schema.Literal("plugin-route"),
	}),
]);
export const ClientPageTarget = Schema.Union([SavedViewClientPageTarget, PluginClientPageTarget]);
export type ClientPageTarget = typeof ClientPageTarget.Type;

const PreparedClientPageTarget = Schema.Union([
	SavedViewClientPageTarget,
	PluginClientPageTarget.members[1],
	strictStruct({
		entityId: EntityId,
		entitySchemaSlug: EntitySchemaSlug,
		kind: Schema.Literal("entity"),
		entitySchemaPluginId: Schema.NullOr(Schema.String),
	}),
]);

export const PrepareClientPageBody = strictStruct({ target: ClientPageTarget });

export const ClientPagePreparationErrorReason = Schema.Union([
	strictStruct({ code: Schema.Literal("entity-not-found"), entityId: EntityId }),
	strictStruct({ code: Schema.Literal("plugin-unavailable"), pluginId: Schema.String }),
	strictStruct({
		path: Schema.String,
		pluginId: Schema.String,
		code: Schema.Literal("plugin-route-not-registered"),
	}),
	strictStruct({
		entityId: EntityId,
		ownerPluginId: Schema.NullOr(Schema.String),
		code: Schema.Literal("entity-owner-unavailable"),
	}),
	strictStruct({
		entityId: EntityId,
		ownerPluginId: Schema.String,
		entitySchemaSlug: EntitySchemaSlug,
		code: Schema.Literal("entity-detail-page-not-registered"),
	}),
]);

export class ClientPagePreparationError extends Schema.TaggedError<ClientPagePreparationError>()(
	"ClientPagePreparationError",
	{ reason: ClientPagePreparationErrorReason },
) {}

export const ClientPageCodeContributor = Schema.Union([
	strictStruct({
		sourceHash: Schema.String,
		rendererId: ClientRendererId,
		kind: Schema.Literal("renderer"),
	}),
	strictStruct({
		pluginSlug: PluginSlug,
		pluginId: Schema.String,
		sourceHash: Schema.String,
		installationId: Schema.String,
		kind: Schema.Literal("plugin"),
	}),
]);
export type ClientPageCodeContributor = typeof ClientPageCodeContributor.Type;

export const ClientPageOperationTarget = strictStruct({
	pluginId: Schema.String,
	pluginSlug: PluginSlug,
	sourceHash: Schema.String,
	installationId: Schema.String,
});
export type ClientPageOperationTarget = typeof ClientPageOperationTarget.Type;

const ClientPagePublicExportIdentity = strictStruct({
	name: Schema.String,
	entry: Schema.String,
	automaticEntityPresentations: Schema.Boolean,
	settingsSchema: Schema.optional(AppSchema),
	kind: Schema.Literals(["component", "page", "presentation"]),
});

export const ClientPageAutomaticRegistryIdentity = strictStruct({
	ownerPluginId: Schema.String,
	exportSpecifier: Schema.String,
	entitySchemaSlug: Schema.String,
	layout: Schema.Literals(["grid", "list"]),
});

export const ClientPageGraphIdentity = strictStruct({
	format: Schema.Int,
	apiVersion: Schema.Int,
	bridgeVersion: Schema.Int,
	compilerVersion: Schema.Int,
	selectedExports: Schema.Array(Schema.String),
	automaticRegistry: Schema.Array(ClientPageAutomaticRegistryIdentity),
	entry: strictStruct({ contributor: Schema.String, path: Schema.String }),
	kernelAutomaticFallback: Schema.NullOr(
		strictStruct({
			provider: Schema.Literal("kernel"),
			runtimeVersion: Schema.Int,
			layouts: Schema.Tuple([Schema.Literal("grid"), Schema.Literal("list")]),
		}),
	),
	contributors: Schema.Array(
		Schema.Union([
			strictStruct({
				name: Schema.String,
				entry: Schema.String,
				namespace: Schema.String,
				sourceHash: Schema.String,
				rendererId: ClientRendererId,
				kind: Schema.Literal("renderer"),
				automaticEntityPresentations: Schema.Boolean,
				pluginDependencies: Schema.Array(PluginSlug),
			}),
			strictStruct({
				pluginSlug: PluginSlug,
				pluginId: Schema.String,
				namespace: Schema.String,
				sourceHash: Schema.String,
				installationId: Schema.String,
				kind: Schema.Literal("plugin"),
				pluginDependencies: Schema.Array(PluginSlug),
				exports: Schema.Array(ClientPagePublicExportIdentity),
			}),
		]),
	),
});
export type ClientPageGraphIdentity = typeof ClientPageGraphIdentity.Type;

const PreparedClientPageIdentityBase = {
	buildId: Schema.String,
	graphHash: Schema.String,
	artifactHash: Schema.String,
	contributors: Schema.Array(ClientPageCodeContributor),
	operationTargets: Schema.Array(ClientPageOperationTarget),
} as const;

export const PreparedClientPageIdentity = Schema.Union([
	strictStruct({
		...PreparedClientPageIdentityBase,
		savedViewId: SavedViewId,
		viewRevision: Schema.Int,
		rendererId: ClientRendererId,
		publishedHash: Schema.String,
		publishedRevision: Schema.Int,
		target: SavedViewClientPageTarget,
		kind: Schema.Literal("saved-view"),
	}),
	strictStruct({
		...PreparedClientPageIdentityBase,
		pluginId: Schema.String,
		sourceHash: Schema.String,
		exportName: Schema.String,
		installationId: Schema.String,
		target: PluginClientPageTarget,
		kind: Schema.Literal("plugin-page"),
	}),
]);

export const PreparedClientPageContext = strictStruct({
	target: PreparedClientPageTarget,
	dataSources: Schema.NullOr(RyotQLDocument),
	settings: Schema.Record(Schema.String, JsonValue),
	route: strictStruct({ params: Schema.Record(Schema.String, Schema.String) }),
	renderer: Schema.Union([
		strictStruct({ kind: Schema.Literal("custom"), id: ClientRendererId }),
		strictStruct({
			pluginId: Schema.String,
			exportName: Schema.String,
			kind: Schema.Literal("plugin"),
		}),
	]),
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
