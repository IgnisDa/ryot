import { PluginHook } from "@ryot-app/contract/modules/plugins/manifest";
import { PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";

export const BatchHookPin = Schema.Struct({
	hook: PluginHook,
	pluginId: PluginId,
	scriptSlug: Schema.String,
	sandboxScriptId: Schema.String,
	pluginRevisionId: Schema.String,
	scriptContentHash: Schema.String,
	executionUserId: Schema.NullOr(UserId),
	pluginConfigRevisionId: Schema.NullOr(Schema.String),
});
export type BatchHookPin = typeof BatchHookPin.Type;
