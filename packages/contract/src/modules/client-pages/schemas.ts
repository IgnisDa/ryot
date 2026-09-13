import { Schema } from "effect";

import { CanonicalBase64 } from "../../schema/base64";
import { EntityId, EntitySchemaSlug, PluginSlug, SavedViewId } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { AppSchema } from "../../schema/property-schema";
import { strictStruct } from "../../schema/utils";
import { RyotQLDocument } from "../ryotql/language";

export const ClientRendererFile = strictStruct({ path: Schema.String, content: CanonicalBase64 });

export const ClientRendererDefinition = strictStruct({
	entry: Schema.String,
	settingsSchema: AppSchema,
	files: Schema.Array(ClientRendererFile),
	automaticEntityPresentations: Schema.Boolean,
	pluginDependencies: Schema.Array(PluginSlug),
});
export type ClientRendererDefinition = typeof ClientRendererDefinition.Type;

const SavedViewClientPageTarget = strictStruct({
	slug: Schema.String,
	kind: Schema.Literal("saved-view"),
});
const PluginClientPageTarget = Schema.Union([
	strictStruct({ entityId: EntityId, kind: Schema.Literal("entity") }),
	strictStruct({
		path: Schema.String,
		search: Schema.String,
		pluginSlug: PluginSlug,
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
		kind: Schema.Literal("entity"),
		entitySchemaSlug: EntitySchemaSlug,
		entitySchemaPluginId: Schema.NullOr(Schema.String),
	}),
]);

export const PrepareClientPageBody = strictStruct({ target: ClientPageTarget });

export const ClientPagePreparationErrorReason = Schema.Union([
	strictStruct({ entityId: EntityId, code: Schema.Literal("entity-not-found") }),
	strictStruct({ pluginId: Schema.String, code: Schema.Literal("plugin-unavailable") }),
	strictStruct({ pluginSlug: PluginSlug, code: Schema.Literal("dependency-unavailable") }),
	strictStruct({ exportName: Schema.String, code: Schema.Literal("export-not-found") }),
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
		entitySchemaSlug: EntitySchemaSlug,
		ownerPluginId: Schema.NullOr(Schema.String),
		code: Schema.Literal("entity-detail-page-not-registered"),
	}),
	strictStruct({ code: Schema.Literal("saved-view-unavailable") }),
]);

export class ClientPagePreparationError extends Schema.TaggedError<ClientPagePreparationError>()(
	"ClientPagePreparationError",
	{ reason: ClientPagePreparationErrorReason },
) {}

export const ClientPageCodeContributor = Schema.Union([
	strictStruct({
		name: Schema.String,
		sourceHash: Schema.String,
		kind: Schema.Literal("kernel-renderer"),
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
	pluginSlug: PluginSlug,
	pluginId: Schema.String,
	sourceHash: Schema.String,
	installationId: Schema.String,
});
export type ClientPageOperationTarget = typeof ClientPageOperationTarget.Type;

const ClientPagePublicExportIdentity = strictStruct({
	name: Schema.String,
	entry: Schema.String,
	settingsSchema: Schema.optional(AppSchema),
	automaticEntityPresentations: Schema.Boolean,
	kind: Schema.Literals(["component", "page", "presentation"]),
});

export const ClientPageAutomaticRegistryIdentity = strictStruct({
	ownerPluginId: Schema.String,
	exportSpecifier: Schema.String,
	entitySchemaSlug: Schema.String,
	layout: Schema.Literals(["grid", "list"]),
	artifactClosure: Schema.Array(Schema.String),
});

export const ClientArtifactFileReference = strictStruct({
	file: Schema.String,
	artifactHash: Schema.String,
});
export type ClientArtifactFileReference = typeof ClientArtifactFileReference.Type;

export const ClientCompositionModuleReference = strictStruct({
	binding: Schema.String,
	specifier: Schema.String,
});
export type ClientCompositionModuleReference = typeof ClientCompositionModuleReference.Type;

export const ClientCompositionPresentationRegistration = strictStruct({
	ownerPluginId: Schema.String,
	entitySchemaSlug: Schema.String,
	module: ClientCompositionModuleReference,
	layout: Schema.Literals(["grid", "list"]),
	artifactClosure: Schema.Array(Schema.String),
	stylesheets: Schema.Array(ClientArtifactFileReference),
});
export type ClientCompositionPresentationRegistration =
	typeof ClientCompositionPresentationRegistration.Type;

export const ClientPageCompositionIdentity = strictStruct({
	format: Schema.Int,
	name: Schema.String,
	apiVersion: Schema.Int,
	bridgeVersion: Schema.Int,
	compilerVersion: Schema.Int,
	runtimeArtifactHash: Schema.String,
	selectedExports: Schema.Array(Schema.String),
	eagerArtifactHashes: Schema.Array(Schema.String),
	application: Schema.Literals(["page", "plugin-route"]),
	automaticRegistry: Schema.Array(ClientPageAutomaticRegistryIdentity),
	entry: strictStruct({ path: Schema.String, contributor: Schema.String }),
	kernelAutomaticFallback: Schema.NullOr(
		strictStruct({
			runtimeVersion: Schema.Int,
			provider: Schema.Literal("kernel"),
			layouts: Schema.Tuple([Schema.Literal("grid"), Schema.Literal("list")]),
		}),
	),
	routeRegistry: Schema.NullOr(
		strictStruct({
			home: Schema.String,
			notFound: Schema.optional(Schema.String),
			routes: Schema.Array(strictStruct({ path: Schema.String, exportSpecifier: Schema.String })),
		}),
	),
	contributors: Schema.Array(
		Schema.Union([
			strictStruct({
				name: Schema.String,
				entry: Schema.String,
				namespace: Schema.String,
				sourceHash: Schema.String,
				artifactHash: Schema.String,
				kind: Schema.Literal("kernel-renderer"),
				automaticEntityPresentations: Schema.Boolean,
				pluginDependencies: Schema.Array(PluginSlug),
			}),
			strictStruct({
				pluginSlug: PluginSlug,
				pluginId: Schema.String,
				namespace: Schema.String,
				sourceHash: Schema.String,
				kind: Schema.Literal("plugin"),
				clientArtifactHash: Schema.String,
				pluginDependencies: Schema.Array(PluginSlug),
				exports: Schema.Array(ClientPagePublicExportIdentity),
			}),
		]),
	),
});
export type ClientPageCompositionIdentity = typeof ClientPageCompositionIdentity.Type;

export const ClientPageCompositionManifest = strictStruct({
	bootstrap: ClientArtifactFileReference,
	identity: ClientPageCompositionIdentity,
	imports: Schema.Record(Schema.String, ClientArtifactFileReference),
	descriptor: strictStruct({
		application: Schema.Literals(["page", "plugin-route"]),
		entry: Schema.optional(ClientCompositionModuleReference),
		automaticRegistry: Schema.Array(ClientCompositionPresentationRegistration),
		routes: Schema.optional(
			strictStruct({
				home: ClientCompositionModuleReference,
				notFound: Schema.optional(ClientCompositionModuleReference),
				routes: Schema.Array(
					strictStruct({ path: Schema.String, module: ClientCompositionModuleReference }),
				),
			}),
		),
	}),
});
export type ClientPageCompositionManifest = typeof ClientPageCompositionManifest.Type;

const PreparedClientPageIdentityBase = {
	compositionKey: Schema.String,
	compositionHash: Schema.String,
	contributors: Schema.Array(ClientPageCodeContributor),
	operationTargets: Schema.Array(ClientPageOperationTarget),
} as const;

export const PreparedClientPageIdentity = Schema.Union([
	strictStruct({
		...PreparedClientPageIdentityBase,
		savedViewId: SavedViewId,
		viewRevision: Schema.Int,
		sourceHash: Schema.String,
		rendererName: Schema.String,
		target: SavedViewClientPageTarget,
		kind: Schema.Literal("kernel-saved-view"),
	}),
	strictStruct({
		...PreparedClientPageIdentityBase,
		pluginId: Schema.String,
		savedViewId: SavedViewId,
		viewRevision: Schema.Int,
		sourceHash: Schema.String,
		exportName: Schema.String,
		installationId: Schema.String,
		target: SavedViewClientPageTarget,
		kind: Schema.Literal("plugin-saved-view"),
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
	strictStruct({
		...PreparedClientPageIdentityBase,
		sourceHash: Schema.String,
		rendererName: Schema.String,
		entitySchemaSlug: EntitySchemaSlug,
		target: PluginClientPageTarget.members[0],
		kind: Schema.Literal("kernel-entity-page"),
	}),
]);

export const PreparedClientPageViewIdentity = strictStruct({
	icon: Schema.String,
	name: Schema.String,
});

export const PreparedClientPageContext = strictStruct({
	target: PreparedClientPageTarget,
	dataSources: Schema.NullOr(RyotQLDocument),
	settings: Schema.Record(Schema.String, JsonValue),
	view: Schema.NullOr(PreparedClientPageViewIdentity),
	route: strictStruct({ params: Schema.Record(Schema.String, Schema.String) }),
	renderer: Schema.Union([
		strictStruct({ name: Schema.String, kind: Schema.Literal("kernel") }),
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
	composition: strictStruct({
		format: Schema.Int,
		hash: Schema.String,
		apiVersion: Schema.Int,
		bridgeVersion: Schema.Int,
		compilerVersion: Schema.Int,
		documentGrant: strictStruct({
			src: Schema.String,
			grantId: Schema.String,
			expiresAt: Schema.String,
		}),
	}),
});
export type PreparedClientPage = typeof PreparedClientPage.Type;

export const CheckClientPageFreshnessBody = strictStruct({ identity: PreparedClientPageIdentity });
export const CheckClientPageFreshnessResponse = strictStruct({ current: Schema.Boolean });

export class ClientDocumentGrantNotFound extends Schema.TaggedError<ClientDocumentGrantNotFound>()(
	"ClientDocumentGrantNotFound",
	{ reason: strictStruct({ code: Schema.Literal("document-grant-not-found") }) },
) {}

export class ClientAssetNotFound extends Schema.TaggedError<ClientAssetNotFound>()(
	"ClientAssetNotFound",
	{ reason: strictStruct({ code: Schema.Literal("client-asset-not-found") }) },
) {}
