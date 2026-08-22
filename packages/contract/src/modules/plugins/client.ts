import { canonicalRelativePosixPathIssue } from "@ryot/ts-utils/path";
import { Schema } from "effect";

import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";
import { RyotQLDocument, RyotQLResponse } from "../ryotql/language";

export const CLIENT_API_VERSION = 1 as const;
export const CLIENT_BRIDGE_PROTOCOL_VERSION = 1 as const;
export const CLIENT_ARTIFACT_FORMAT = 1 as const;
export const CLIENT_COMPILER_VERSION = 1 as const;
export const CLIENT_BRIDGE_MAX_PENDING_REQUESTS = 64;

export const CLIENT_ARTIFACT_ROOT_ELEMENT_ID = "app";
export const CLIENT_ARTIFACT_METADATA_ELEMENT_ID = "ryot-client-artifact";

export const REQUIRED_THEME_TOKEN_NAMES = [
	"bg",
	"info",
	"text",
	"accent",
	"border",
	"danger",
	"raised",
	"success",
	"surface",
	"info-soft",
	"surface-2",
	"text-muted",
	"accent-ink",
	"accent-soft",
	"accent-text",
	"text-subtle",
	"success-soft",
	"accent-border",
	"border-strong",
	"font-family-ui",
	"font-family-display",
	"r-sm",
	"r-md",
	"r-lg",
	"r-xl",
	"r-pill",
	"shadow-small",
	"shadow-raised",
] as const;

const PluginThemeTokens = JsonValue.pipe(
	Schema.decodeTo(
		Schema.StructWithRest(
			Schema.Record(Schema.Literals(REQUIRED_THEME_TOKEN_NAMES), Schema.NonEmptyString),
			[Schema.Record(Schema.String, Schema.NonEmptyString)],
		),
	),
);

export const PluginThemeSnapshot = strictStruct({
	tokens: PluginThemeTokens,
	resolvedMode: Schema.Literals(["light", "dark"]),
});

export type PluginThemeSnapshot = Schema.Schema.Type<typeof PluginThemeSnapshot>;

const PluginClientSourceEntry = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((entry) =>
			canonicalRelativePosixPathIssue(entry) === null &&
			entry.startsWith("client/") &&
			(entry.endsWith(".ts") || entry.endsWith(".tsx"))
				? true
				: "Expected a canonical client/**/*.ts or client/**/*.tsx entry",
		),
	),
);

export const PluginClientEntry = strictStruct({
	entry: PluginClientSourceEntry,
	apiVersion: Schema.Literal(CLIENT_API_VERSION),
});

export type PluginClientEntry = Schema.Schema.Type<typeof PluginClientEntry>;

export const PluginClientArtifactFile = strictStruct({
	name: Schema.String,
	contents: Schema.String,
	contentType: Schema.String,
});

export type PluginClientArtifactFile = Schema.Schema.Type<typeof PluginClientArtifactFile>;

export const PluginClientArtifactMetadata = strictStruct({
	hash: Schema.String,
	format: Schema.Literal(CLIENT_ARTIFACT_FORMAT),
	apiVersion: Schema.Literal(CLIENT_API_VERSION),
	compilerVersion: Schema.Literal(CLIENT_COMPILER_VERSION),
	bridgeVersion: Schema.Literal(CLIENT_BRIDGE_PROTOCOL_VERSION),
});

export type PluginClientArtifactMetadata = Schema.Schema.Type<typeof PluginClientArtifactMetadata>;

const PluginClientArtifactFiles = Schema.Array(PluginClientArtifactFile).pipe(
	Schema.check(
		Schema.makeFilter((files) =>
			new Set(files.map(({ name }) => name)).size === files.length
				? true
				: "Expected unique client artifact file names",
		),
	),
);

export const PluginClientArtifact = strictStruct({
	...PluginClientArtifactMetadata.fields,
	files: PluginClientArtifactFiles,
});

export type PluginClientArtifact = Schema.Schema.Type<typeof PluginClientArtifact>;

export const PluginBridgeInit = strictStruct({
	sessionId: Schema.String,
	artifactHash: Schema.String,
	apiVersion: Schema.Literal(CLIENT_API_VERSION),
	format: Schema.Literal(CLIENT_ARTIFACT_FORMAT),
	compilerVersion: Schema.Literal(CLIENT_COMPILER_VERSION),
	bridgeVersion: Schema.Literal(CLIENT_BRIDGE_PROTOCOL_VERSION),
});

export type PluginBridgeInit = Schema.Schema.Type<typeof PluginBridgeInit>;

export const PluginBridgeReady = strictStruct(PluginBridgeInit.fields);

export type PluginBridgeReady = Schema.Schema.Type<typeof PluginBridgeReady>;

export const PluginLogicalLocation = strictStruct({
	path: Schema.String,
	search: Schema.String,
});

export type PluginLogicalLocation = Schema.Schema.Type<typeof PluginLogicalLocation>;

export const PluginBridgeLocation = strictStruct({
	location: PluginLogicalLocation,
	type: Schema.Literal("location"),
});

export type PluginBridgeLocation = Schema.Schema.Type<typeof PluginBridgeLocation>;

export const PluginBridgeNavigate = strictStruct({
	location: PluginLogicalLocation,
	type: Schema.Literal("navigate"),
	mode: Schema.Literals(["push", "replace"]),
});

export type PluginBridgeNavigate = Schema.Schema.Type<typeof PluginBridgeNavigate>;

export const PluginBridgeTheme = strictStruct({
	generation: Schema.Int,
	theme: PluginThemeSnapshot,
	type: Schema.Literal("theme"),
});

export type PluginBridgeTheme = Schema.Schema.Type<typeof PluginBridgeTheme>;

export const PluginBridgeThemeApplied = strictStruct({
	generation: Schema.Int,
	type: Schema.Literal("theme-applied"),
});

export type PluginBridgeThemeApplied = Schema.Schema.Type<typeof PluginBridgeThemeApplied>;

export const PluginBridgeLifecycleClose = strictStruct({
	type: Schema.Literal("lifecycle-close"),
	reason: Schema.Literals(["disposed", "failed"]),
});

export type PluginBridgeLifecycleClose = Schema.Schema.Type<typeof PluginBridgeLifecycleClose>;

export const PluginOperationBridgeErrorReason = Schema.Literals([
	"transport",
	"operation-failed",
	"malformed-result",
]);

export type PluginOperationBridgeErrorReason = Schema.Schema.Type<
	typeof PluginOperationBridgeErrorReason
>;

export const RyotClientErrorReason = Schema.Literals([
	"disposed",
	"protocol",
	"transport",
	"query-failed",
	"invalid-input",
	"operation-failed",
	"malformed-result",
	"unsupported-capability",
]);

export type RyotClientErrorReason = Schema.Schema.Type<typeof RyotClientErrorReason>;

export const PluginOperationRequest = strictStruct({
	input: JsonValue,
	operationSlug: Schema.String,
});

export type PluginOperationRequest = Schema.Schema.Type<typeof PluginOperationRequest>;

export const PluginBridgeOperationRequest = strictStruct({
	input: JsonValue,
	requestId: Schema.String,
	operationSlug: Schema.String,
	type: Schema.Literal("operation-request"),
});

export type PluginBridgeOperationRequest = Schema.Schema.Type<typeof PluginBridgeOperationRequest>;

const pluginOperationSuccessFields = {
	value: JsonValue,
	outcome: Schema.Literal("success"),
};

const pluginOperationFailureFields = {
	reason: PluginOperationBridgeErrorReason,
	outcome: Schema.Literal("failure"),
};

const pluginBridgeOperationResultFields = {
	requestId: Schema.String,
	type: Schema.Literal("operation-result"),
};

export const PluginOperationOutcome = Schema.Union([
	strictStruct(pluginOperationSuccessFields),
	strictStruct(pluginOperationFailureFields),
]);

export type PluginOperationOutcome = Schema.Schema.Type<typeof PluginOperationOutcome>;

export const PluginBridgeOperationResult = Schema.Union([
	strictStruct({ ...pluginOperationSuccessFields, ...pluginBridgeOperationResultFields }),
	strictStruct({ ...pluginOperationFailureFields, ...pluginBridgeOperationResultFields }),
]);

export type PluginBridgeOperationResult = Schema.Schema.Type<typeof PluginBridgeOperationResult>;

export const PluginRyotQLFailureReason = Schema.Literals(["query-failed", "transport"]);

export type PluginRyotQLFailureReason = Schema.Schema.Type<typeof PluginRyotQLFailureReason>;

export const PluginBridgeRyotQLRequest = strictStruct({
	document: RyotQLDocument,
	requestId: Schema.String,
	type: Schema.Literal("ryotql-request"),
});

export type PluginBridgeRyotQLRequest = Schema.Schema.Type<typeof PluginBridgeRyotQLRequest>;

export type PluginRyotQLRequest = Pick<PluginBridgeRyotQLRequest, "document">;

const pluginRyotQLSuccessFields = {
	response: RyotQLResponse,
	outcome: Schema.Literal("success"),
};

const pluginRyotQLFailureFields = {
	reason: PluginRyotQLFailureReason,
	outcome: Schema.Literal("failure"),
};

const pluginBridgeRyotQLResultFields = {
	requestId: Schema.String,
	type: Schema.Literal("ryotql-result"),
};

export const PluginRyotQLOutcome = Schema.Union([
	strictStruct(pluginRyotQLSuccessFields),
	strictStruct(pluginRyotQLFailureFields),
]);

export type PluginRyotQLOutcome = Schema.Schema.Type<typeof PluginRyotQLOutcome>;

export const PluginBridgeRyotQLResult = Schema.Union([
	strictStruct({ ...pluginRyotQLSuccessFields, ...pluginBridgeRyotQLResultFields }),
	strictStruct({ ...pluginRyotQLFailureFields, ...pluginBridgeRyotQLResultFields }),
]);

export type PluginBridgeRyotQLResult = Schema.Schema.Type<typeof PluginBridgeRyotQLResult>;

export const PluginBridgeClientMessage = Schema.Union([
	PluginBridgeNavigate,
	PluginBridgeThemeApplied,
	PluginBridgeRyotQLRequest,
	PluginBridgeLifecycleClose,
	PluginBridgeOperationRequest,
]);

export type PluginBridgeClientMessage = Schema.Schema.Type<typeof PluginBridgeClientMessage>;

export const PluginBridgeHostMessage = Schema.Union([
	PluginBridgeTheme,
	PluginBridgeLocation,
	PluginBridgeRyotQLResult,
	PluginBridgeLifecycleClose,
	PluginBridgeOperationResult,
]);

export type PluginBridgeHostMessage = Schema.Schema.Type<typeof PluginBridgeHostMessage>;
