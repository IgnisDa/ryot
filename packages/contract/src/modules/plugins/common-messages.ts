import type { CompiledCatalog } from "@ryot-app/i18n/catalog";
import type { KernelCatalog } from "@ryot-app/kernel-messages/catalog";

/** Kernel `common.*` messages the plugin client SDK renders for plugins, so plugin catalogs omit them. */
export const PLUGIN_COMMON_MESSAGE_KEYS = [
	"common.action.back",
	"common.action.cancel",
	"common.action.close",
	"common.action.delete",
	"common.action.done",
	"common.action.refresh",
	"common.action.retry",
	"common.action.save",
	"common.action.try-again",
	"common.status.deleting",
	"common.status.loading",
	"common.status.saving",
	"common.value.no",
	"common.value.yes",
] as const satisfies ReadonlyArray<keyof KernelCatalog>;

export type PluginCommonMessageKey = (typeof PLUGIN_COMMON_MESSAGE_KEYS)[number];

const commonMessageKeys: ReadonlySet<string> = new Set(PLUGIN_COMMON_MESSAGE_KEYS);

export const isPluginCommonMessageKey = (key: string): key is PluginCommonMessageKey =>
	commonMessageKeys.has(key);

/** A plugin catalog must not define a common key, which the kernel message would shadow. */
export const commonMessageKeyIssues = (catalog: CompiledCatalog) =>
	Object.keys(catalog)
		.filter(isPluginCommonMessageKey)
		.map((key) => `Plugin message catalog defines the kernel common message ${key}`);
