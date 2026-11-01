import { IngestionPlan } from "@ryot-app/contract/modules/imports/ingestion";
import { Schema } from "effect";

import { ImportSourceState } from "./source-state";

export const PreparedIngestionRelease = Schema.Struct({
	plan: IngestionPlan,
	state: ImportSourceState,
	requiresProKey: Schema.Boolean,
});
export type PreparedIngestionRelease = typeof PreparedIngestionRelease.Type;

export const PreparedIngestionReleaseCiphertext = Schema.Struct({
	...PreparedIngestionRelease.fields,
	state: Schema.Struct({ keyId: Schema.String, nonce: Schema.String, ciphertext: Schema.String }),
});
export type PreparedIngestionReleaseCiphertext = typeof PreparedIngestionReleaseCiphertext.Type;
