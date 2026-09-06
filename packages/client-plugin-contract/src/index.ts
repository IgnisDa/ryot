import {
	CollectionResponse,
	CreateCollectionBody,
	CreateMembershipBody,
	DeleteMembershipBody,
	MembershipResponse,
} from "@ryot-app/contract/modules/collections/schemas";
import {
	EntityUpdatedMessage,
	MAX_INTEREST_ENTITY_IDS,
} from "@ryot-app/contract/modules/entity-interest/messages";
import { CLIENT_API_VERSION } from "@ryot-app/contract/modules/plugins/manifest";
import { isPluginSharedSource } from "@ryot-app/contract/modules/plugins/shared-file-policy";
import { RyotQLDocument, RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import { EntityBrowserAddAction } from "@ryot-app/contract/modules/saved-views/schemas";
import {
	ManagedAssetResolutionBatch,
	ManagedAssetLocator,
	TemporaryUploadToken,
} from "@ryot-app/contract/modules/uploads/schemas";
import { CanonicalBase64 } from "@ryot-app/contract/schema/base64";
import { EntityId, EntitySchemaSlug, PluginSlug } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { HttpUrl, IsoUtcString, strictStruct } from "@ryot-app/contract/schema/utils";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Schema } from "effect";

export { CLIENT_API_VERSION };
export const CLIENT_ARTIFACT_FORMAT = 1 as const;
export const CLIENT_COMPILER_VERSION = 2 as const;
export const CLIENT_BRIDGE_MAX_PENDING_REQUESTS = 64;
export const CLIENT_BRIDGE_PROTOCOL_VERSION = 3 as const;
export const CLIENT_BRIDGE_BOOTSTRAP_READY = "ryot-client-bootstrap-ready" as const;

export const KERNEL_SHORTCUTS = {
	commandCenter: "Mod+K",
	workspaceSwitcher: "Mod+Shift+Space",
} as const;

export const MAX_PAGE_SHORTCUTS = 16;

export const PAGE_SHORTCUT_KEYS = [
	"/",
	"A",
	"B",
	"C",
	"D",
	"E",
	"F",
	"G",
	"H",
	"I",
	"J",
	"K",
	"L",
	"M",
	"N",
	"O",
	"P",
	"Q",
	"R",
	"S",
	"T",
	"U",
	"V",
	"W",
	"X",
	"Y",
	"Z",
] as const;

export type PageShortcutKey = (typeof PAGE_SHORTCUT_KEYS)[number];

export const isPageShortcut = (value: string): value is PageShortcutKey =>
	PAGE_SHORTCUT_KEYS.some((key) => key === value);

export const CLIENT_PAGE_ROOT_ELEMENT_ID = "app";
export const CLIENT_COMPOSITION_METADATA_ELEMENT_ID = "ryot-client-composition-metadata";

export const PLUGIN_CLIENT_ARTIFACT_CONTENT_TYPES = [
	"text/html; charset=utf-8",
	"text/css; charset=utf-8",
	"text/javascript; charset=utf-8",
	"image/png",
	"image/gif",
	"image/jpeg",
	"image/webp",
	"image/avif",
	"image/x-icon",
	"image/svg+xml",
	"font/woff2",
	"application/wasm",
] as const;

export const isPluginClientArtifactContentType = (contentType: string) =>
	PLUGIN_CLIENT_ARTIFACT_CONTENT_TYPES.some((supported) => supported === contentType);

export const PLUGIN_CLIENT_TEXT_SOURCE_EXTENSIONS = [".ts", ".tsx", ".css"] as const;

export const PLUGIN_CLIENT_ASSET_EXTENSIONS = [
	".svg",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".avif",
	".ico",
	".woff2",
	".wasm",
] as const;

export type PluginClientAssetExtension = (typeof PLUGIN_CLIENT_ASSET_EXTENSIONS)[number];

export const PLUGIN_CLIENT_ASSET_MIME_TYPES = {
	".png": "image/png",
	".gif": "image/gif",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".avif": "image/avif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".svg": "image/svg+xml",
	".wasm": "application/wasm",
} as const satisfies Readonly<Record<PluginClientAssetExtension, string>>;

export const PLUGIN_CLIENT_FILE_EXTENSIONS = [
	...PLUGIN_CLIENT_TEXT_SOURCE_EXTENSIONS,
	...PLUGIN_CLIENT_ASSET_EXTENSIONS,
] as const;

export type PluginClientTextSourceExtension = (typeof PLUGIN_CLIENT_TEXT_SOURCE_EXTENSIONS)[number];
export type PluginClientFileExtension = (typeof PLUGIN_CLIENT_FILE_EXTENSIONS)[number];

export const pluginClientFileExtension = (path: string): PluginClientFileExtension | undefined =>
	PLUGIN_CLIENT_FILE_EXTENSIONS.find((extension) => path.endsWith(extension));

const isPluginTestSource = (path: string) =>
	path.slice(path.lastIndexOf("/") + 1).includes(".test.");

export const isPluginSourceFile = (path: string) =>
	!isPluginTestSource(path) &&
	((path.startsWith("backend/") && path.endsWith(".ts")) ||
		isPluginSharedSource(path) ||
		(path.startsWith("client/") && pluginClientFileExtension(path) !== undefined));

export const isPluginClientTextSource = (path: string) =>
	PLUGIN_CLIENT_TEXT_SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));

export const pluginClientAssetMimeType = (path: string) => {
	const extension = PLUGIN_CLIENT_ASSET_EXTENSIONS.find((ext) => path.endsWith(ext));
	return extension === undefined ? undefined : PLUGIN_CLIENT_ASSET_MIME_TYPES[extension];
};

export const PluginThemeMode = Schema.Literals(["light", "dark"]);

export type PluginThemeMode = Schema.Schema.Type<typeof PluginThemeMode>;

export const PluginThemeSnapshot = strictStruct({ resolvedMode: PluginThemeMode });

export type PluginThemeSnapshot = Schema.Schema.Type<typeof PluginThemeSnapshot>;

export const ClientPageTarget = Schema.Union([
	strictStruct({ slug: Schema.String, kind: Schema.Literal("saved-view") }),
	strictStruct({
		path: Schema.String,
		search: Schema.String,
		pluginSlug: PluginSlug,
		kind: Schema.Literal("plugin-route"),
	}),
	strictStruct({
		entityId: EntityId,
		kind: Schema.Literal("entity"),
		entitySchemaSlug: EntitySchemaSlug,
		entitySchemaPluginId: Schema.NullOr(Schema.String),
	}),
]);

export type ClientPageTarget = Schema.Schema.Type<typeof ClientPageTarget>;

export const ClientPageRenderer = Schema.Union([
	strictStruct({ name: Schema.String, kind: Schema.Literal("kernel") }),
	strictStruct({
		pluginId: Schema.String,
		exportName: Schema.String,
		kind: Schema.Literal("plugin"),
	}),
]);

export type ClientPageRenderer = Schema.Schema.Type<typeof ClientPageRenderer>;

export const ClientPageOperationTarget = strictStruct({
	pluginSlug: PluginSlug,
	pluginId: Schema.String,
	sourceHash: Schema.String,
	installationId: Schema.String,
});

export type ClientPageOperationTarget = Schema.Schema.Type<typeof ClientPageOperationTarget>;

export const ClientPageViewIdentity = strictStruct({ icon: Schema.String, name: Schema.String });

export type ClientPageViewIdentity = Schema.Schema.Type<typeof ClientPageViewIdentity>;

export const ClientPageContext = strictStruct({
	target: ClientPageTarget,
	renderer: ClientPageRenderer,
	dataSources: Schema.NullOr(RyotQLDocument),
	view: Schema.NullOr(ClientPageViewIdentity),
	settings: Schema.Record(Schema.String, JsonValue),
	route: strictStruct({ params: Schema.Record(Schema.String, Schema.String) }),
});

export type ClientPageContext = Schema.Schema.Type<typeof ClientPageContext>;

const pluginClientArtifactFile = <Encoded, DecodingServices, EncodingServices>(
	contents: Schema.Codec<Uint8Array, Encoded, DecodingServices, EncodingServices>,
) => strictStruct({ contents, name: Schema.String, contentType: Schema.String });

export const PluginClientArtifactFile = pluginClientArtifactFile(Schema.Uint8Array);

export type PluginClientArtifactFile = Schema.Schema.Type<typeof PluginClientArtifactFile>;

export const PluginClientArtifactMetadata = strictStruct({
	hash: Schema.String,
	format: Schema.Literal(CLIENT_ARTIFACT_FORMAT),
	apiVersion: Schema.Literal(CLIENT_API_VERSION),
	compilerVersion: Schema.Literal(CLIENT_COMPILER_VERSION),
	bridgeVersion: Schema.Literal(CLIENT_BRIDGE_PROTOCOL_VERSION),
});

export type PluginClientArtifactMetadata = Schema.Schema.Type<typeof PluginClientArtifactMetadata>;

export const clientArtifactFile = ({
	path,
	bytes,
	contentType,
}: {
	readonly path: string;
	readonly bytes: Uint8Array;
	readonly contentType: string;
}): PluginClientArtifactFile => ({
	name: path,
	contentType,
	contents: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice(),
});

export const clientArtifactMetadata = (
	pluginName: string,
	files: readonly PluginClientArtifactFile[],
): PluginClientArtifactMetadata => {
	const identity = {
		format: CLIENT_ARTIFACT_FORMAT,
		apiVersion: CLIENT_API_VERSION,
		compilerVersion: CLIENT_COMPILER_VERSION,
		bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
	};
	const fileIdentity = files
		.map(({ name, contents, contentType }) => ({ name, contentType, sha256: sha256Hex(contents) }))
		.sort((left, right) => {
			if (left.name < right.name) {
				return -1;
			}
			return left.name > right.name ? 1 : 0;
		});
	return {
		...identity,
		hash: sha256Hex(stableStringify({ name: pluginName, metadata: identity, files: fileIdentity })),
	};
};

const pluginClientArtifact = <Encoded, DecodingServices, EncodingServices>(
	contents: Schema.Codec<Uint8Array, Encoded, DecodingServices, EncodingServices>,
) =>
	strictStruct({
		...PluginClientArtifactMetadata.fields,
		files: Schema.Array(pluginClientArtifactFile(contents)).pipe(
			Schema.check(
				Schema.makeFilter((files) =>
					new Set(files.map(({ name }) => name)).size === files.length
						? true
						: "Expected unique client artifact file names",
				),
			),
		),
	});

export const PluginClientArtifact = pluginClientArtifact(Schema.Uint8Array);

export type PluginClientArtifact = Schema.Schema.Type<typeof PluginClientArtifact>;

const CanonicalUint8ArrayFromBase64 = CanonicalBase64.pipe(
	Schema.decodeTo(Schema.Uint8ArrayFromBase64),
);

export const PluginClientArtifactFromBase64 = pluginClientArtifact(CanonicalUint8ArrayFromBase64);

const pluginBridgeIdentityFields = {
	sessionId: Schema.String,
	compositionHash: Schema.String,
	apiVersion: Schema.Literal(CLIENT_API_VERSION),
	format: Schema.Literal(CLIENT_ARTIFACT_FORMAT),
	compilerVersion: Schema.Literal(CLIENT_COMPILER_VERSION),
	bridgeVersion: Schema.Literal(CLIENT_BRIDGE_PROTOCOL_VERSION),
};

const pluginSafeAreaInset = Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

export const PluginBridgeInit = strictStruct({
	...pluginBridgeIdentityFields,
	mode: PluginThemeMode,
	documentKey: Schema.String,
	safeAreaTop: pluginSafeAreaInset,
	safeAreaBottom: pluginSafeAreaInset,
	page: Schema.optional(ClientPageContext),
});

export type PluginBridgeInit = Schema.Schema.Type<typeof PluginBridgeInit>;

export const PluginBridgeReady = strictStruct(pluginBridgeIdentityFields);

export type PluginBridgeReady = Schema.Schema.Type<typeof PluginBridgeReady>;

export const PluginRouteLocation = strictStruct({
	path: Schema.String,
	search: Schema.String,
	kind: Schema.Literal("route"),
});

export type PluginRouteLocation = Schema.Schema.Type<typeof PluginRouteLocation>;

export const PluginEntityLocation = strictStruct({
	entityId: EntityId,
	search: Schema.String,
	kind: Schema.Literal("entity"),
	entitySchemaSlug: EntitySchemaSlug,
});

export type PluginEntityLocation = Schema.Schema.Type<typeof PluginEntityLocation>;

export const PluginLogicalLocation = Schema.Union([PluginRouteLocation, PluginEntityLocation]);

export type PluginLogicalLocation = Schema.Schema.Type<typeof PluginLogicalLocation>;

export const KernelPage = Schema.Literals(["import-data"]);

export type KernelPage = Schema.Schema.Type<typeof KernelPage>;

export const kernelPagePaths = { "import-data": "/settings/import-data" } as const satisfies Record<
	KernelPage,
	string
>;

export const PluginNavigationTarget = Schema.Union([
	strictStruct({ slug: Schema.String, kind: Schema.Literal("saved-view") }),
	strictStruct({ page: KernelPage, kind: Schema.Literal("kernel-page") }),
	strictStruct({ entityId: EntityId, kind: Schema.Literal("entity") }),
	strictStruct({
		path: Schema.String,
		search: Schema.String,
		pluginSlug: PluginSlug,
		kind: Schema.Literal("plugin-route"),
	}),
]);

export type PluginNavigationTarget = Schema.Schema.Type<typeof PluginNavigationTarget>;

export const PluginLeadingIntent = Schema.Literals(["back", "drawer", "none"]);

export type PluginLeadingIntent = Schema.Schema.Type<typeof PluginLeadingIntent>;

export const PluginBridgeLocation = strictStruct({
	index: Schema.Int,
	key: Schema.String,
	compact: Schema.Boolean,
	edgeBack: Schema.Boolean,
	leading: PluginLeadingIntent,
	location: PluginLogicalLocation,
	type: Schema.Literal("location"),
});

export type PluginBridgeLocation = Schema.Schema.Type<typeof PluginBridgeLocation>;

export const PluginBridgeDocument = strictStruct({
	documentKey: Schema.String,
	type: Schema.Literal("document"),
	navigation: PluginBridgeLocation,
	page: Schema.optional(ClientPageContext),
});

export type PluginBridgeDocument = Schema.Schema.Type<typeof PluginBridgeDocument>;

export const PluginBridgeNavigateBack = strictStruct({ type: Schema.Literal("navigate-back") });

export type PluginBridgeNavigateBack = Schema.Schema.Type<typeof PluginBridgeNavigateBack>;

export const PluginBridgeOverlayState = strictStruct({
	type: Schema.Literal("overlay-state"),
	count: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});

export type PluginBridgeOverlayState = Schema.Schema.Type<typeof PluginBridgeOverlayState>;

export const PluginBridgeDismissOverlay = strictStruct({
	requestId: Schema.String,
	type: Schema.Literal("dismiss-overlay"),
});

export type PluginBridgeDismissOverlay = Schema.Schema.Type<typeof PluginBridgeDismissOverlay>;

export const PluginBridgeDismissOverlayResult = strictStruct({
	requestId: Schema.String,
	dismissed: Schema.Boolean,
	type: Schema.Literal("dismiss-overlay-result"),
});

export type PluginBridgeDismissOverlayResult = Schema.Schema.Type<
	typeof PluginBridgeDismissOverlayResult
>;

export const PluginBridgeOpenDrawer = strictStruct({ type: Schema.Literal("open-drawer") });

export type PluginBridgeOpenDrawer = Schema.Schema.Type<typeof PluginBridgeOpenDrawer>;

export const KernelShortcut = Schema.Literals(["command-center", "workspace-switcher"]);

export type KernelShortcut = Schema.Schema.Type<typeof KernelShortcut>;

export const PluginBridgeKernelShortcut = strictStruct({
	shortcut: KernelShortcut,
	type: Schema.Literal("kernel-shortcut"),
});

export type PluginBridgeKernelShortcut = Schema.Schema.Type<typeof PluginBridgeKernelShortcut>;

export const PluginBridgePageShortcuts = strictStruct({
	type: Schema.Literal("page-shortcuts"),
	shortcuts: Schema.Array(Schema.String).pipe(Schema.check(Schema.isMaxLength(MAX_PAGE_SHORTCUTS))),
});

export type PluginBridgePageShortcuts = Schema.Schema.Type<typeof PluginBridgePageShortcuts>;

export const PluginBridgePageShortcutPress = strictStruct({
	shortcut: Schema.String,
	type: Schema.Literal("page-shortcut-press"),
});

export type PluginBridgePageShortcutPress = Schema.Schema.Type<
	typeof PluginBridgePageShortcutPress
>;

export const PluginBridgeNavigate = strictStruct({
	target: PluginNavigationTarget,
	type: Schema.Literal("navigate"),
	mode: Schema.Literals(["push", "replace"]),
});

export type PluginBridgeNavigate = Schema.Schema.Type<typeof PluginBridgeNavigate>;

export const PluginPageSearchUpdate = Schema.Record(Schema.String, Schema.NullOr(Schema.String));

export type PluginPageSearchUpdate = Schema.Schema.Type<typeof PluginPageSearchUpdate>;

export const PluginBridgePageSearch = strictStruct({
	update: PluginPageSearchUpdate,
	type: Schema.Literal("page-search"),
	mode: Schema.Literals(["push", "replace"]),
});

export type PluginBridgePageSearch = Schema.Schema.Type<typeof PluginBridgePageSearch>;

export const ProviderSearchScreenRequest = strictStruct({
	initialQuery: Schema.optional(Schema.String),
	ownerPluginId: EntityBrowserAddAction.fields.ownerPluginId,
	entitySchemaSlug: EntityBrowserAddAction.fields.entitySchemaSlug,
});

export type ProviderSearchScreenRequest = Schema.Schema.Type<typeof ProviderSearchScreenRequest>;

export const PluginBridgeProviderSearchScreen = strictStruct({
	...ProviderSearchScreenRequest.fields,
	type: Schema.Literal("provider-search-screen"),
});

export type PluginBridgeProviderSearchScreen = Schema.Schema.Type<
	typeof PluginBridgeProviderSearchScreen
>;

export const PluginBridgePageRefresh = strictStruct({ type: Schema.Literal("page-refresh") });

export type PluginBridgePageRefresh = Schema.Schema.Type<typeof PluginBridgePageRefresh>;

export const PluginBridgeScreenState = strictStruct({
	index: Schema.Int,
	key: Schema.String,
	hasPreviousScreen: Schema.Boolean,
	type: Schema.Literal("screen-state"),
});

export type PluginBridgeScreenState = Schema.Schema.Type<typeof PluginBridgeScreenState>;

export const PLUGIN_HEADER_TITLE_MAX = 120;

export const PluginHeaderContent = strictStruct({
	title: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(PLUGIN_HEADER_TITLE_MAX))),
});

export type PluginHeaderContent = Schema.Schema.Type<typeof PluginHeaderContent>;

export const PluginBridgeHeader = strictStruct({
	index: Schema.Int,
	key: Schema.String,
	type: Schema.Literal("header"),
	header: Schema.NullOr(PluginHeaderContent),
});

export type PluginBridgeHeader = Schema.Schema.Type<typeof PluginBridgeHeader>;

export const PluginBridgeViewport = strictStruct({
	type: Schema.Literal("viewport"),
	safeAreaTop: pluginSafeAreaInset,
	safeAreaBottom: pluginSafeAreaInset,
});

export type PluginBridgeViewport = Schema.Schema.Type<typeof PluginBridgeViewport>;

export const PluginBridgeTheme = strictStruct({
	mode: PluginThemeMode,
	type: Schema.Literal("theme"),
});

export type PluginBridgeTheme = Schema.Schema.Type<typeof PluginBridgeTheme>;

export const PluginBridgeLifecycleClose = strictStruct({
	type: Schema.Literal("lifecycle-close"),
	reason: Schema.Literals(["disposed", "failed"]),
});

export type PluginBridgeLifecycleClose = Schema.Schema.Type<typeof PluginBridgeLifecycleClose>;

export const PluginOperationBridgeErrorReason = Schema.Literals([
	"transport",
	"operation-failed",
	"malformed-result",
]);

export type PluginOperationBridgeErrorReason = Schema.Schema.Type<
	typeof PluginOperationBridgeErrorReason
>;

export const PluginAssetBridgeErrorReason = Schema.Literals([
	"transport",
	"asset-failed",
	"malformed-result",
]);

export type PluginAssetBridgeErrorReason = Schema.Schema.Type<typeof PluginAssetBridgeErrorReason>;

export const PluginUploadBridgeErrorReason = Schema.Literals([
	"transport",
	"operation-failed",
	"malformed-result",
]);

export type PluginUploadBridgeErrorReason = Schema.Schema.Type<
	typeof PluginUploadBridgeErrorReason
>;

export const RyotClientErrorReason = Schema.Literals([
	"disposed",
	"protocol",
	"transport",
	"asset-failed",
	"collection-failed",
	"query-failed",
	"invalid-input",
	"operation-failed",
	"malformed-result",
	"unsupported-capability",
]);

export type RyotClientErrorReason = Schema.Schema.Type<typeof RyotClientErrorReason>;

export const PluginCollectionBridgeErrorReason = Schema.Literals([
	"transport",
	"collection-failed",
	"malformed-result",
]);

export type PluginCollectionBridgeErrorReason = Schema.Schema.Type<
	typeof PluginCollectionBridgeErrorReason
>;

const collectionRequestVariants = [
	strictStruct({ input: CreateCollectionBody, action: Schema.Literal("create") }),
	strictStruct({ input: CreateMembershipBody, action: Schema.Literal("upsert-membership") }),
	strictStruct({ input: DeleteMembershipBody, action: Schema.Literal("remove-membership") }),
] as const;

export const PluginCollectionRequest = Schema.Union(collectionRequestVariants);

export type PluginCollectionRequest = Schema.Schema.Type<typeof PluginCollectionRequest>;

export const PluginBridgeCollectionRequest = Schema.Union(
	collectionRequestVariants.map((variant) =>
		strictStruct({
			...variant.fields,
			requestId: Schema.String,
			type: Schema.Literal("collection-request"),
		}),
	),
);

export type PluginBridgeCollectionRequest = Schema.Schema.Type<
	typeof PluginBridgeCollectionRequest
>;

const pluginCollectionSuccessFields = {
	outcome: Schema.Literal("success"),
	response: Schema.Union([CollectionResponse, MembershipResponse]),
};

const pluginCollectionFailureFields = {
	outcome: Schema.Literal("failure"),
	reason: PluginCollectionBridgeErrorReason,
};

const pluginBridgeCollectionResultFields = {
	requestId: Schema.String,
	type: Schema.Literal("collection-result"),
};

export const PluginCollectionOutcome = Schema.Union([
	strictStruct(pluginCollectionSuccessFields),
	strictStruct(pluginCollectionFailureFields),
]);

export type PluginCollectionOutcome = Schema.Schema.Type<typeof PluginCollectionOutcome>;

export const PluginBridgeCollectionResult = Schema.Union([
	strictStruct({ ...pluginCollectionSuccessFields, ...pluginBridgeCollectionResultFields }),
	strictStruct({ ...pluginCollectionFailureFields, ...pluginBridgeCollectionResultFields }),
]);

export type PluginBridgeCollectionResult = Schema.Schema.Type<typeof PluginBridgeCollectionResult>;

export const PluginManagedAssetResolution = strictStruct({
	url: HttpUrl,
	expiresAt: IsoUtcString,
	asset: ManagedAssetLocator,
});

export type PluginManagedAssetResolution = Schema.Schema.Type<typeof PluginManagedAssetResolution>;

export const PluginAssetRequest = strictStruct({ assets: ManagedAssetResolutionBatch });

export type PluginAssetRequest = Schema.Schema.Type<typeof PluginAssetRequest>;

export const PluginBridgeAssetRequest = strictStruct({
	requestId: Schema.String,
	assets: ManagedAssetResolutionBatch,
	type: Schema.Literal("asset-request"),
});

export type PluginBridgeAssetRequest = Schema.Schema.Type<typeof PluginBridgeAssetRequest>;

export const PluginBridgeAssetCancel = strictStruct({
	requestId: Schema.String,
	type: Schema.Literal("asset-cancel"),
});

export type PluginBridgeAssetCancel = Schema.Schema.Type<typeof PluginBridgeAssetCancel>;

const pluginAssetSuccessFields = {
	outcome: Schema.Literal("success"),
	resolutions: Schema.Array(PluginManagedAssetResolution),
};

const pluginAssetFailureFields = {
	outcome: Schema.Literal("failure"),
	reason: PluginAssetBridgeErrorReason,
};

const pluginBridgeAssetResultFields = {
	requestId: Schema.String,
	type: Schema.Literal("asset-result"),
};

export const PluginAssetOutcome = Schema.Union([
	strictStruct(pluginAssetSuccessFields),
	strictStruct(pluginAssetFailureFields),
]);

export type PluginAssetOutcome = Schema.Schema.Type<typeof PluginAssetOutcome>;

export const PluginBridgeAssetResult = Schema.Union([
	strictStruct({ ...pluginAssetSuccessFields, ...pluginBridgeAssetResultFields }),
	strictStruct({ ...pluginAssetFailureFields, ...pluginBridgeAssetResultFields }),
]);

export type PluginBridgeAssetResult = Schema.Schema.Type<typeof PluginBridgeAssetResult>;

export const PluginOperationRequest = strictStruct({
	input: JsonValue,
	pluginSlug: PluginSlug,
	operationSlug: Schema.String,
});

export type PluginOperationRequest = Schema.Schema.Type<typeof PluginOperationRequest>;

export const PluginBridgeOperationRequest = strictStruct({
	input: JsonValue,
	pluginSlug: PluginSlug,
	requestId: Schema.String,
	operationSlug: Schema.String,
	type: Schema.Literal("operation-request"),
});

export type PluginBridgeOperationRequest = Schema.Schema.Type<typeof PluginBridgeOperationRequest>;

const pluginOperationSuccessFields = { value: JsonValue, outcome: Schema.Literal("success") };

const pluginOperationFailureFields = {
	outcome: Schema.Literal("failure"),
	reason: PluginOperationBridgeErrorReason,
};

const pluginBridgeOperationResultFields = {
	requestId: Schema.String,
	type: Schema.Literal("operation-result"),
};

export const PluginOperationOutcome = Schema.Union([
	strictStruct(pluginOperationSuccessFields),
	strictStruct(pluginOperationFailureFields),
]);

export type PluginOperationOutcome = Schema.Schema.Type<typeof PluginOperationOutcome>;

export const PluginBridgeOperationResult = Schema.Union([
	strictStruct({ ...pluginOperationSuccessFields, ...pluginBridgeOperationResultFields }),
	strictStruct({ ...pluginOperationFailureFields, ...pluginBridgeOperationResultFields }),
]);

export type PluginBridgeOperationResult = Schema.Schema.Type<typeof PluginBridgeOperationResult>;

export const PluginUploadSource = Schema.declare<Blob>((value) => value instanceof Blob).annotate({
	identifier: "PluginUploadSource",
});

export const PluginUploadRequest = strictStruct({
	fileName: Schema.String,
	contentType: Schema.String,
	source: PluginUploadSource,
});

export type PluginUploadRequest = Schema.Schema.Type<typeof PluginUploadRequest>;

export const PluginBridgeUploadRequest = strictStruct({
	...PluginUploadRequest.fields,
	requestId: Schema.String,
	type: Schema.Literal("upload-request"),
});

export type PluginBridgeUploadRequest = Schema.Schema.Type<typeof PluginBridgeUploadRequest>;

const pluginUploadSuccessFields = {
	token: TemporaryUploadToken,
	outcome: Schema.Literal("success"),
};

const pluginUploadFailureFields = {
	outcome: Schema.Literal("failure"),
	reason: PluginUploadBridgeErrorReason,
};

const pluginBridgeUploadResultFields = {
	requestId: Schema.String,
	type: Schema.Literal("upload-result"),
};

export const PluginUploadOutcome = Schema.Union([
	strictStruct(pluginUploadSuccessFields),
	strictStruct(pluginUploadFailureFields),
]);

export type PluginUploadOutcome = Schema.Schema.Type<typeof PluginUploadOutcome>;

export const PluginBridgeUploadResult = Schema.Union([
	strictStruct({ ...pluginUploadSuccessFields, ...pluginBridgeUploadResultFields }),
	strictStruct({ ...pluginUploadFailureFields, ...pluginBridgeUploadResultFields }),
]);

export type PluginBridgeUploadResult = Schema.Schema.Type<typeof PluginBridgeUploadResult>;

export const PluginRyotQLFailureReason = Schema.Literals(["query-failed", "transport"]);

export type PluginRyotQLFailureReason = Schema.Schema.Type<typeof PluginRyotQLFailureReason>;

export const PluginBridgeRyotQLRequest = strictStruct({
	document: RyotQLDocument,
	requestId: Schema.String,
	type: Schema.Literal("ryotql-request"),
});

export type PluginBridgeRyotQLRequest = Schema.Schema.Type<typeof PluginBridgeRyotQLRequest>;

export type PluginRyotQLRequest = Pick<PluginBridgeRyotQLRequest, "document">;

export const PluginBridgeRyotQLCancel = strictStruct({
	requestId: Schema.String,
	type: Schema.Literal("ryotql-cancel"),
});

export type PluginBridgeRyotQLCancel = Schema.Schema.Type<typeof PluginBridgeRyotQLCancel>;

const pluginRyotQLSuccessFields = { response: RyotQLResponse, outcome: Schema.Literal("success") };

const pluginRyotQLFailureFields = {
	reason: PluginRyotQLFailureReason,
	outcome: Schema.Literal("failure"),
};

const pluginBridgeRyotQLResultFields = {
	requestId: Schema.String,
	type: Schema.Literal("ryotql-result"),
};

export const PluginRyotQLOutcome = Schema.Union([
	strictStruct(pluginRyotQLSuccessFields),
	strictStruct(pluginRyotQLFailureFields),
]);

export type PluginRyotQLOutcome = Schema.Schema.Type<typeof PluginRyotQLOutcome>;

export const PluginBridgeRyotQLResult = Schema.Union([
	strictStruct({ ...pluginRyotQLSuccessFields, ...pluginBridgeRyotQLResultFields }),
	strictStruct({ ...pluginRyotQLFailureFields, ...pluginBridgeRyotQLResultFields }),
]);

export type PluginBridgeRyotQLResult = Schema.Schema.Type<typeof PluginBridgeRyotQLResult>;

export const EntityInterest = strictStruct({
	visible: Schema.Array(EntityId),
	foreground: Schema.Array(EntityId),
});

export type EntityInterest = Schema.Codec.Encoded<typeof EntityInterest>;

export const PluginBridgeEntityInterest = strictStruct({
	...EntityInterest.fields,
	type: Schema.Literal("entity-interest"),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			({ visible, foreground }) =>
				foreground.length + visible.length <= MAX_INTEREST_ENTITY_IDS ||
				"Too many entity interests",
		),
	),
);

export type PluginBridgeEntityInterest = Schema.Schema.Type<typeof PluginBridgeEntityInterest>;

export const PluginBridgeEntityUpdated = strictStruct({
	...EntityUpdatedMessage.fields,
	type: Schema.Literal("entity-updated"),
});

export type PluginBridgeEntityUpdated = Schema.Schema.Type<typeof PluginBridgeEntityUpdated>;

export const PluginBridgeClientMessage = Schema.Union([
	PluginBridgeHeader,
	PluginBridgeNavigate,
	PluginBridgePageSearch,
	PluginBridgeOpenDrawer,
	PluginBridgeScreenState,
	PluginBridgeAssetCancel,
	PluginBridgeAssetRequest,
	PluginBridgeRyotQLCancel,
	PluginBridgeNavigateBack,
	PluginBridgeOverlayState,
	PluginBridgeRyotQLRequest,
	PluginBridgeUploadRequest,
	PluginBridgePageShortcuts,
	PluginBridgeLifecycleClose,
	PluginBridgeKernelShortcut,
	PluginBridgeEntityInterest,
	PluginBridgeOperationRequest,
	PluginBridgeCollectionRequest,
	PluginBridgeDismissOverlayResult,
	PluginBridgeProviderSearchScreen,
]);

export type PluginBridgeClientMessage = Schema.Schema.Type<typeof PluginBridgeClientMessage>;

export const PluginBridgeHostMessage = Schema.Union([
	PluginBridgeDocument,
	PluginBridgeTheme,
	PluginBridgeLocation,
	PluginBridgeViewport,
	PluginBridgeAssetResult,
	PluginBridgePageRefresh,
	PluginBridgeRyotQLResult,
	PluginBridgeUploadResult,
	PluginBridgeEntityUpdated,
	PluginBridgeLifecycleClose,
	PluginBridgeDismissOverlay,
	PluginBridgeOperationResult,
	PluginBridgeCollectionResult,
	PluginBridgePageShortcutPress,
]);

export type PluginBridgeHostMessage = Schema.Schema.Type<typeof PluginBridgeHostMessage>;
