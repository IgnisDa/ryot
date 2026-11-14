import type { PluginHook } from "@ryot-app/contract/modules/plugins/manifest";
import type { PluginId, UserId } from "@ryot-app/contract/schema/brands";

export type BatchHookPin = {
	readonly payload: {
		readonly hook: PluginHook;
		readonly scriptSlug: string;
		readonly scriptContentHash: string;
	};
	readonly references: {
		readonly pluginId: PluginId;
		readonly sandboxScriptId: string;
		readonly pluginRevisionId: string;
		readonly scopeUserId: null | UserId;
		readonly pluginConfigRevisionId: null | string;
	};
};
