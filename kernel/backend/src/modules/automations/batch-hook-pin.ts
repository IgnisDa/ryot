import { PluginHook } from "@ryot-app/contract/modules/plugins/manifest";
import { Schema } from "effect";

import type { MutationBatchPin } from "#modules/mutations/receipts";

export const BatchHookSnapshot = Schema.Struct({
	hook: PluginHook,
	scriptSlug: Schema.String,
	scriptContentHash: Schema.String,
});
export type BatchHookPin = MutationBatchPin<typeof BatchHookSnapshot.Type>;
