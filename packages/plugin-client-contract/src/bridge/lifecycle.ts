import { ProviderLibraryMembership } from "@ryot-app/contract/modules/entity-providers/schemas";
import { EntitySchemaReference } from "@ryot-app/contract/modules/plugins/references";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import { Schema } from "effect";

import { clientVersionFields } from "../artifact";
import {
	ClientPageContext,
	KernelShortcut,
	MAX_PAGE_SHORTCUTS,
	PluginLeadingIntent,
	PluginLogicalLocation,
	PluginNavigationTarget,
} from "../navigation";
import { RyotClientErrorReason } from "./capabilities";

export const CLIENT_BRIDGE_MAX_PENDING_REQUESTS = 64;
export const CLIENT_BRIDGE_BOOTSTRAP_READY = "ryot-client-bootstrap-ready" as const;

export const CLIENT_PAGE_ROOT_ELEMENT_ID = "app";
export const CLIENT_COMPOSITION_DESCRIPTOR_ELEMENT_ID = "ryot-client-composition";
export const CLIENT_COMPOSITION_METADATA_ELEMENT_ID = "ryot-client-composition-metadata";

export const PluginThemeMode = Schema.Literals(["light", "dark"]);

export type PluginThemeMode = Schema.Schema.Type<typeof PluginThemeMode>;

export const PluginThemeSnapshot = strictStruct({ resolvedMode: PluginThemeMode });

export type PluginThemeSnapshot = Schema.Schema.Type<typeof PluginThemeSnapshot>;

const pluginBridgeIdentityFields = {
	sessionId: Schema.String,
	compositionHash: Schema.String,
	...clientVersionFields,
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

export const PickEntityRequest = strictStruct({
	schema: EntitySchemaReference,
	initialQuery: Schema.optional(Schema.String),
	library: Schema.optional(ProviderLibraryMembership),
});

export type PickEntityRequest = Schema.Schema.Type<typeof PickEntityRequest>;

export const PluginBridgePickEntityScreen = strictStruct({
	...PickEntityRequest.fields,
	requestId: Schema.String,
	type: Schema.Literal("pick-entity-screen"),
});

export type PluginBridgePickEntityScreen = Schema.Schema.Type<typeof PluginBridgePickEntityScreen>;

export const PickEntityOutcome = Schema.Union([
	strictStruct({ kind: Schema.Literal("selected"), entityIds: Schema.Array(EntityId) }),
	strictStruct({ kind: Schema.Literal("cancelled") }),
	strictStruct({ kind: Schema.Literal("create-requested") }),
]);

export type PickEntityOutcome = Schema.Schema.Type<typeof PickEntityOutcome>;

export const PluginBridgePickEntityScreenCancel = strictStruct({
	requestId: Schema.String,
	type: Schema.Literal("pick-entity-screen-cancel"),
});

export type PluginBridgePickEntityScreenCancel = Schema.Schema.Type<
	typeof PluginBridgePickEntityScreenCancel
>;

const hostScreenResult = <Type extends string, Outcome extends Schema.Top>(
	type: Type,
	outcome: Outcome,
) => {
	const fields = { requestId: Schema.String, type: Schema.Literal(type) };
	return Schema.Union([
		strictStruct({ ...fields, value: outcome, outcome: Schema.Literal("success") }),
		strictStruct({ ...fields, reason: RyotClientErrorReason, outcome: Schema.Literal("failure") }),
	]);
};

export const PluginBridgePickEntityScreenResult = hostScreenResult(
	"pick-entity-screen-result",
	PickEntityOutcome,
);

export type PluginBridgePickEntityScreenResult = Schema.Schema.Type<
	typeof PluginBridgePickEntityScreenResult
>;

export const EditCollectionRequest = strictStruct({ collectionId: Schema.optional(EntityId) });

export type EditCollectionRequest = Schema.Schema.Type<typeof EditCollectionRequest>;

export const PluginBridgeEditCollectionScreen = strictStruct({
	...EditCollectionRequest.fields,
	requestId: Schema.String,
	type: Schema.Literal("edit-collection-screen"),
});

export type PluginBridgeEditCollectionScreen = Schema.Schema.Type<
	typeof PluginBridgeEditCollectionScreen
>;

export const EditCollectionOutcome = Schema.Union([
	strictStruct({ collectionId: EntityId, kind: Schema.Literal("saved") }),
	strictStruct({ kind: Schema.Literal("deleted") }),
	strictStruct({ kind: Schema.Literal("cancelled") }),
]);

export type EditCollectionOutcome = Schema.Schema.Type<typeof EditCollectionOutcome>;

export const PluginBridgeEditCollectionScreenCancel = strictStruct({
	requestId: Schema.String,
	type: Schema.Literal("edit-collection-screen-cancel"),
});

export type PluginBridgeEditCollectionScreenCancel = Schema.Schema.Type<
	typeof PluginBridgeEditCollectionScreenCancel
>;

export const PluginBridgeEditCollectionScreenResult = hostScreenResult(
	"edit-collection-screen-result",
	EditCollectionOutcome,
);

export type PluginBridgeEditCollectionScreenResult = Schema.Schema.Type<
	typeof PluginBridgeEditCollectionScreenResult
>;

export const AddToCollectionRequest = strictStruct({
	entityId: EntityId,
	collectionId: Schema.optional(EntityId),
});

export type AddToCollectionRequest = Schema.Schema.Type<typeof AddToCollectionRequest>;

export const PluginBridgeAddToCollectionScreen = strictStruct({
	...AddToCollectionRequest.fields,
	requestId: Schema.String,
	type: Schema.Literal("add-to-collection-screen"),
});

export type PluginBridgeAddToCollectionScreen = Schema.Schema.Type<
	typeof PluginBridgeAddToCollectionScreen
>;

export const AddToCollectionOutcome = Schema.Union([
	strictStruct({ kind: Schema.Literal("saved") }),
	strictStruct({ kind: Schema.Literal("removed") }),
	strictStruct({ kind: Schema.Literal("cancelled") }),
]);

export type AddToCollectionOutcome = Schema.Schema.Type<typeof AddToCollectionOutcome>;

export const PluginBridgeAddToCollectionScreenCancel = strictStruct({
	requestId: Schema.String,
	type: Schema.Literal("add-to-collection-screen-cancel"),
});

export type PluginBridgeAddToCollectionScreenCancel = Schema.Schema.Type<
	typeof PluginBridgeAddToCollectionScreenCancel
>;

export const PluginBridgeAddToCollectionScreenResult = hostScreenResult(
	"add-to-collection-screen-result",
	AddToCollectionOutcome,
);

export type PluginBridgeAddToCollectionScreenResult = Schema.Schema.Type<
	typeof PluginBridgeAddToCollectionScreenResult
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
