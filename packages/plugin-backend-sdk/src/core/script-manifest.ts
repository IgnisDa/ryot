import {
	AutomationAfterInputProjection,
	AutomationPolicyInputProjection,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { ProviderTranslationInputs } from "@ryot-app/contract/modules/plugins/provider-inputs";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { jsonValueSchema, strictStruct } from "../wire";
import { nonEmptyString } from "./primitives";

const appSchema = Schema.declare<AppSchema>((_value): _value is AppSchema => true);
const manifestStringSchema = Schema.String.pipe(
	Schema.check(Schema.makeFilter((value) => value.length > 0 && value === value.trim())),
);
const manifestSlugSchema = Schema.String.pipe(
	Schema.check(Schema.makeFilter((value) => /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value))),
);
const sandboxManifestBaseFields = { slug: manifestSlugSchema, name: manifestStringSchema };
export const sandboxManifestSchema = Schema.Union([
	strictStruct({ ...sandboxManifestBaseFields, kind: Schema.Literal("script") }),
	strictStruct({
		...sandboxManifestBaseFields,
		kind: Schema.Literal("provider"),
		searchOptionsSchema: Schema.optional(appSchema),
		translationInputs: Schema.optional(ProviderTranslationInputs),
	}),
	strictStruct({ ...sandboxManifestBaseFields, kind: Schema.Literal("operation") }),
	strictStruct({
		...sandboxManifestBaseFields,
		kind: Schema.Literal("automation"),
		automationType: Schema.Literal("automation"),
		inputProjection: AutomationAfterInputProjection,
	}),
	strictStruct({
		...sandboxManifestBaseFields,
		kind: Schema.Literal("automation"),
		automationType: Schema.Literal("policy"),
		inputProjection: AutomationPolicyInputProjection,
	}),
	strictStruct({ ...sandboxManifestBaseFields, kind: Schema.Literal("workflow") }),
]);
export type SandboxManifest = Schema.Schema.Type<typeof sandboxManifestSchema>;
export type ScriptManifest = Extract<SandboxManifest, { readonly kind: "script" }>;
export type WorkflowManifest = Extract<SandboxManifest, { readonly kind: "workflow" }>;
export type OperationManifest = Extract<SandboxManifest, { readonly kind: "operation" }>;
export const executionMetadataSchema = strictStruct({
	metadata: jsonValueSchema,
	sandboxScriptId: nonEmptyString,
	startedAt: Schema.optional(nonEmptyString),
});
export type ExecutionMetadata = Schema.Schema.Type<typeof executionMetadataSchema>;
