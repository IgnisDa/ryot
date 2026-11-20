import { Schema } from "@ryot-app/plugin-backend-sdk/workflow";

export const inventoryReconcileInput = Schema.Struct({ runId: Schema.NonEmptyString });
export const inventoryReconcileOutput = Schema.Struct({ done: Schema.Boolean });

export const authoritativeMediaInventoryAdapters = new Set(["integration.plex-yank"]);
