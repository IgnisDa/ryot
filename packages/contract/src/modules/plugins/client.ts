import { Schema } from "effect";

import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";
import { RyotQLDocument, RyotQLResponse } from "../ryotql/language";

export const CLIENT_API_VERSION = 1 as const;
export const CLIENT_BRIDGE_PROTOCOL_VERSION = 3 as const;
export const CLIENT_ARTIFACT_FORMAT = 1 as const;
export const CLIENT_COMPILER_VERSION = 1 as const;

export const CLIENT_ARTIFACT_ROOT_ELEMENT_ID = "app";
export const CLIENT_ARTIFACT_METADATA_ELEMENT_ID = "ryot-client-artifact";

export const PluginClientCapability = Schema.Literals([
	"files",
	"audio",
	"storage",
	"haptics",
	"keep-awake",
	"notifications",
	"live-activities",
]);

export type PluginClientCapability = Schema.Schema.Type<typeof PluginClientCapability>;

export const PluginClientEntry = strictStruct({
	entry: Schema.String,
	apiVersion: Schema.Literal(CLIENT_API_VERSION),
	capabilities: Schema.Array(PluginClientCapability),
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

export const PluginClientArtifact = strictStruct({
	...PluginClientArtifactMetadata.fields,
	files: Schema.Array(PluginClientArtifactFile),
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

export const PluginBridgeLifecycleClose = strictStruct({
	type: Schema.Literal("lifecycle-close"),
	reason: Schema.Literals(["disposed", "failed"]),
});

export type PluginBridgeLifecycleClose = Schema.Schema.Type<typeof PluginBridgeLifecycleClose>;

export const PluginOperationFailureReason = Schema.Literals(["transport", "operation-failed"]);

export type PluginOperationFailureReason = Schema.Schema.Type<typeof PluginOperationFailureReason>;

export const PluginBridgeOperationRequest = strictStruct({
	input: JsonValue,
	requestId: Schema.String,
	operationSlug: Schema.String,
	type: Schema.Literal("operation-request"),
});

export type PluginBridgeOperationRequest = Schema.Schema.Type<typeof PluginBridgeOperationRequest>;

export type PluginOperationRequest = Pick<PluginBridgeOperationRequest, "input" | "operationSlug">;

const pluginOperationSuccessFields = {
	value: JsonValue,
	outcome: Schema.Literal("success"),
};

const pluginOperationFailureFields = {
	reason: PluginOperationFailureReason,
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
	PluginBridgeRyotQLRequest,
	PluginBridgeLifecycleClose,
	PluginBridgeOperationRequest,
]);

export type PluginBridgeClientMessage = Schema.Schema.Type<typeof PluginBridgeClientMessage>;

export const PluginBridgeHostMessage = Schema.Union([
	PluginBridgeLocation,
	PluginBridgeRyotQLResult,
	PluginBridgeLifecycleClose,
	PluginBridgeOperationResult,
]);

export type PluginBridgeHostMessage = Schema.Schema.Type<typeof PluginBridgeHostMessage>;
