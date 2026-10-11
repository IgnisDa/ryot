import { DbError } from "@ryot-app/contract/errors";
import { PluginHook } from "@ryot-app/contract/modules/plugins/manifest";
import type { PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";

import type { MutationBatchPin } from "#modules/mutations/receipts";

export const BatchHookSnapshot = Schema.Struct({
	hook: PluginHook,
	scriptSlug: Schema.String,
	scriptContentHash: Schema.String,
});
export type BatchHookPin = typeof BatchHookSnapshot.Type & {
	readonly pluginId: PluginId;
	readonly sandboxScriptId: string;
	readonly pluginRevisionId: string;
	readonly executionUserId: UserId | null;
	readonly pluginConfigRevisionId: string | null;
};

export const restoreBatchHookPin = Effect.fnUntraced(function* (
	pin: MutationBatchPin<typeof BatchHookSnapshot.Type>,
): Effect.fn.Return<BatchHookPin, DbError> {
	const { pluginId, scopeUserId, sandboxScriptId, pluginRevisionId, pluginConfigRevisionId } =
		pin.references;
	if (pluginId === null || sandboxScriptId === null || pluginRevisionId === null) {
		return yield* new DbError({ message: "Missing pinned batch hook references" });
	}
	return {
		...pin.payload,
		pluginId,
		sandboxScriptId,
		pluginRevisionId,
		pluginConfigRevisionId,
		executionUserId: scopeUserId,
	};
});
