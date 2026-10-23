import { ClientPageCodeContributor } from "@ryot-app/contract/modules/pages/schemas";
import { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import {
	EntityId,
	EntitySchemaSlug,
	PluginId,
	PluginPackageId,
} from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import { Schema } from "effect";

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

export const ClientPageTarget = Schema.Union([
	strictStruct({ reference: SavedViewReference, kind: Schema.Literal("saved-view") }),
	strictStruct({
		path: Schema.String,
		search: Schema.String,
		packageId: PluginPackageId,
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
	pluginId: PluginId,
	contentHash: Schema.String,
	packageId: PluginPackageId,
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
	contributors: Schema.Array(ClientPageCodeContributor),
	route: strictStruct({ params: Schema.Record(Schema.String, Schema.String) }),
});

export type ClientPageContext = Schema.Schema.Type<typeof ClientPageContext>;

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

export const KernelPage = Schema.Literals(["import-data", "plugin-preferences"]);

export type KernelPage = Schema.Schema.Type<typeof KernelPage>;

export const kernelPagePaths = {
	"import-data": "/settings/import-data",
	"plugin-preferences": "/settings/plugin-preferences",
} as const satisfies Record<KernelPage, string>;

export const PluginNavigationTarget = Schema.Union([
	strictStruct({ packageId: PluginPackageId, kind: Schema.Literal("plugin-preferences") }),
	strictStruct({ reference: SavedViewReference, kind: Schema.Literal("saved-view") }),
	strictStruct({ page: KernelPage, kind: Schema.Literal("kernel-page") }),
	strictStruct({ entityId: EntityId, kind: Schema.Literal("entity") }),
	strictStruct({
		path: Schema.String,
		search: Schema.String,
		packageId: PluginPackageId,
		kind: Schema.Literal("plugin-route"),
	}),
]);

export type PluginNavigationTarget = Schema.Schema.Type<typeof PluginNavigationTarget>;

export const PluginLeadingIntent = Schema.Literals(["back", "drawer", "none"]);

export type PluginLeadingIntent = Schema.Schema.Type<typeof PluginLeadingIntent>;

export const KernelShortcut = Schema.Literals(["command-center", "workspace-switcher"]);

export type KernelShortcut = Schema.Schema.Type<typeof KernelShortcut>;
