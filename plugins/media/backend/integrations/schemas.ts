import { sandboxScratchManifestSchema } from "@ryot-app/sandbox-sdk/filesystem";
import {
	genericImportApplyResultSchema,
	ingestionArtifactsSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { Schema } from "@ryot-app/sandbox-sdk/workflow";

import { MediaIntegrationAdapterResult } from "../imports/schemas";

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const MediaIntegrationConfirmation = Schema.Struct({
	part: count,
	runId: Schema.String,
	final: Schema.Boolean,
	batchId: Schema.String,
	inputFingerprint: Schema.String,
	confirmed: genericImportApplyResultSchema.fields.confirmed,
});
export const IntegrationConfirmationInput = Schema.Struct({
	ingestionConfirmation: MediaIntegrationConfirmation,
});
export const YankInput = Schema.Struct({
	ingestionArtifacts: Schema.optional(ingestionArtifactsSchema),
	ingestionConfirmation: Schema.optional(MediaIntegrationConfirmation),
});
export const IntegrationArtifactOutput = Schema.Struct({
	...sandboxScratchManifestSchema.fields,
	advancedAt: Schema.optional(Schema.String),
	sourceFailure: MediaIntegrationAdapterResult.fields.sourceFailure,
});
export const IntegrationWindowOutput = Schema.Struct({
	...IntegrationArtifactOutput.fields,
	carryFile: Schema.NullOr(Schema.String),
});
