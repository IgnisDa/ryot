import { Schema } from "effect";

import { CanonicalBase64 } from "../../schema/base64";
import {
	EntityId,
	EntitySchemaSlug,
	PluginId,
	PluginPackageId,
	SavedViewId,
} from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { AppSchema } from "../../schema/property-schema";
import { strictStruct } from "../../schema/utils";
import { PluginClientDependencies } from "../plugins/manifest";
import { PluginPackageReference, SavedViewReference } from "../plugins/references";
import { RyotQLDocument } from "../ryotql/language";

export const ClientRendererFile = strictStruct({ path: Schema.String, content: CanonicalBase64 });

export const ClientRendererDefinition = strictStruct({
	entry: Schema.String,
	settingsSchema: AppSchema,
	files: Schema.Array(ClientRendererFile),
	automaticEntityPresentations: Schema.Boolean,
	pluginDependencies: PluginClientDependencies,
});
export type ClientRendererDefinition = typeof ClientRendererDefinition.Type;

export const SavedViewClientPageTarget = strictStruct({
	reference: SavedViewReference,
	kind: Schema.Literal("saved-view"),
});
const EntityClientPageTarget = strictStruct({ entityId: EntityId, kind: Schema.Literal("entity") });
const PluginRouteClientPageTarget = strictStruct({
	path: Schema.String,
	search: Schema.String,
	packageId: PluginPackageId,
	kind: Schema.Literal("plugin-route"),
});
const PluginClientPageTarget = Schema.Union([EntityClientPageTarget, PluginRouteClientPageTarget]);
const SavedViewOrRouteClientPageTarget = Schema.Union([
	SavedViewClientPageTarget,
	PluginRouteClientPageTarget,
]);
export const ClientPageTarget = Schema.Union([SavedViewClientPageTarget, PluginClientPageTarget]);
export type ClientPageTarget = typeof ClientPageTarget.Type;

const PreparedClientPageTarget = Schema.Union([
	...SavedViewOrRouteClientPageTarget.members,
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
	strictStruct({ packageId: PluginPackageId, code: Schema.Literal("plugin-package-unavailable") }),
	strictStruct({
		reference: PluginPackageReference,
		code: Schema.Literal("dependency-unavailable"),
	}),
	strictStruct({
		importer: Schema.String,
		reference: PluginPackageReference,
		code: Schema.Literal("dependency-undeclared"),
	}),
	strictStruct({ pluginIds: Schema.Array(PluginId), code: Schema.Literal("dependency-cycle") }),
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

export class ClientPagePreparationError extends Schema.TaggedError<
	ClientPagePreparationError,
	{ readonly brand: unique symbol }
>()("ClientPagePreparationError", { reason: ClientPagePreparationErrorReason }) {}

export const ClientPageCodeContributor = Schema.Union([
	strictStruct({
		name: Schema.String,
		sourceHash: Schema.String,
		kind: Schema.Literal("kernel-renderer"),
	}),
	strictStruct({
		pluginId: PluginId,
		revisionId: Schema.String,
		contentHash: Schema.String,
		packageId: PluginPackageId,
		installationId: Schema.String,
		kind: Schema.Literal("plugin"),
	}),
]);
export type ClientPageCodeContributor = typeof ClientPageCodeContributor.Type;

export const ClientPageOperationTarget = strictStruct({
	pluginId: PluginId,
	contentHash: Schema.String,
	packageId: PluginPackageId,
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
	binding: Schema.NonEmptyString,
	specifier: Schema.NonEmptyString,
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

const ClientCompositionRoutes = strictStruct({
	home: Schema.optional(ClientCompositionModuleReference),
	notFound: Schema.optional(ClientCompositionModuleReference),
	routes: Schema.Array(
		strictStruct({ path: Schema.String, module: ClientCompositionModuleReference }),
	),
});

const ClientPageCompositionIdentityBase = {
	format: Schema.Int,
	name: Schema.String,
	apiVersion: Schema.Int,
	bridgeVersion: Schema.Int,
	compilerVersion: Schema.Int,
	runtimeArtifactHash: Schema.String,
	eagerArtifactHashes: Schema.Array(Schema.String),
	automaticRegistry: Schema.Array(ClientPageAutomaticRegistryIdentity),
	kernelAutomaticFallback: Schema.NullOr(
		strictStruct({
			runtimeVersion: Schema.Int,
			provider: Schema.Literal("kernel"),
			layouts: Schema.Tuple([Schema.Literal("grid"), Schema.Literal("list")]),
		}),
	),
	contributors: Schema.Array(
		Schema.Union([
			strictStruct({
				name: Schema.String,
				sourceHash: Schema.String,
				artifactHash: Schema.String,
				kind: Schema.Literal("kernel-renderer"),
				automaticEntityPresentations: Schema.Boolean,
				pluginDependencies: PluginClientDependencies,
			}),
			strictStruct({
				pluginId: PluginId,
				revisionId: Schema.String,
				contentHash: Schema.String,
				packageId: PluginPackageId,
				kind: Schema.Literal("plugin"),
				clientArtifactHash: Schema.String,
				scope: PluginPackageReference.fields.scope,
				pluginDependencies: PluginClientDependencies,
				exports: Schema.Array(ClientPagePublicExportIdentity),
			}),
		]),
	),
};
export const ClientPageCompositionIdentity = Schema.Union([
	strictStruct({
		...ClientPageCompositionIdentityBase,
		application: Schema.Literal("page"),
		entry: ClientCompositionModuleReference,
	}),
	strictStruct({
		...ClientPageCompositionIdentityBase,
		routes: ClientCompositionRoutes,
		application: Schema.Literal("plugin-route"),
	}),
]);
export type ClientPageCompositionIdentity = typeof ClientPageCompositionIdentity.Type;

const clientCompositionDescriptor = <Registration extends Schema.Top>(registration: Registration) =>
	Schema.Union([
		strictStruct({
			application: Schema.Literal("page"),
			entry: ClientCompositionModuleReference,
			automaticRegistry: Schema.Array(registration),
		}),
		strictStruct({
			routes: ClientCompositionRoutes,
			application: Schema.Literal("plugin-route"),
			automaticRegistry: Schema.Array(registration),
		}),
	]);

export const ClientPageCompositionManifest = strictStruct({
	bootstrap: ClientArtifactFileReference,
	identity: ClientPageCompositionIdentity,
	imports: Schema.Record(Schema.String, ClientArtifactFileReference),
	descriptor: clientCompositionDescriptor(ClientCompositionPresentationRegistration),
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
		target: SavedViewOrRouteClientPageTarget,
		kind: Schema.Literal("kernel-saved-view"),
	}),
	strictStruct({
		...PreparedClientPageIdentityBase,
		pluginId: Schema.String,
		savedViewId: SavedViewId,
		viewRevision: Schema.Int,
		exportName: Schema.String,
		contentHash: Schema.String,
		installationId: Schema.String,
		target: SavedViewOrRouteClientPageTarget,
		kind: Schema.Literal("plugin-saved-view"),
	}),
	strictStruct({
		...PreparedClientPageIdentityBase,
		pluginId: Schema.String,
		exportName: Schema.String,
		contentHash: Schema.String,
		installationId: Schema.String,
		target: PluginClientPageTarget,
		kind: Schema.Literal("plugin-page"),
	}),
	strictStruct({
		...PreparedClientPageIdentityBase,
		sourceHash: Schema.String,
		rendererName: Schema.String,
		target: EntityClientPageTarget,
		entitySchemaSlug: EntitySchemaSlug,
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
	contributors: Schema.Array(ClientPageCodeContributor),
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
	}),
});
export type PreparedClientPage = typeof PreparedClientPage.Type;

export const CheckClientPageFreshnessBody = strictStruct({ identity: PreparedClientPageIdentity });
export const CheckClientPageFreshnessResponse = strictStruct({ current: Schema.Boolean });

export const ClientCompositionDocumentBody = strictStruct({ identity: PreparedClientPageIdentity });

export const ClientCompositionDocument = strictStruct({
	title: Schema.String,
	bootstrap: Schema.String,
	stylesheets: Schema.Array(Schema.String),
	modulepreloads: Schema.Array(Schema.String),
	importMap: strictStruct({ imports: Schema.Record(Schema.String, Schema.String) }),
	preloads: Schema.Array(
		strictStruct({
			href: Schema.String,
			type: Schema.String,
			as: Schema.Literals(["font", "image", "fetch"]),
		}),
	),
	metadata: strictStruct({
		format: Schema.Int,
		hash: Schema.String,
		apiVersion: Schema.Int,
		bridgeVersion: Schema.Int,
		compilerVersion: Schema.Int,
	}),
	descriptor: clientCompositionDescriptor(
		strictStruct({
			stylesheets: Schema.Array(Schema.String),
			layout: ClientCompositionPresentationRegistration.fields.layout,
			module: ClientCompositionPresentationRegistration.fields.module,
			ownerPluginId: ClientCompositionPresentationRegistration.fields.ownerPluginId,
			entitySchemaSlug: ClientCompositionPresentationRegistration.fields.entitySchemaSlug,
		}),
	),
});
export type ClientCompositionDocument = typeof ClientCompositionDocument.Type;

export class PageBundleFileNotFound extends Schema.TaggedError<
	PageBundleFileNotFound,
	{ readonly brand: unique symbol }
>()("PageBundleFileNotFound", {
	reason: strictStruct({ code: Schema.Literal("client-asset-not-found") }),
}) {}

export class ClientPageDocumentStale extends Schema.TaggedError<
	ClientPageDocumentStale,
	{ readonly brand: unique symbol }
>()("ClientPageDocumentStale", {
	reason: strictStruct({ code: Schema.Literal("client-page-document-stale") }),
}) {}
