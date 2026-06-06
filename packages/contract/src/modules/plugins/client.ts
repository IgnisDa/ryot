import { Schema } from "effect";

import { strictStruct } from "../../schema/utils";

export const CLIENT_API_VERSION = 1 as const;
export const CLIENT_BRIDGE_PROTOCOL_VERSION = 1 as const;
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

export const PluginBridgeReady = strictStruct({
	sessionId: Schema.String,
	artifactHash: Schema.String,
	apiVersion: Schema.Literal(CLIENT_API_VERSION),
	format: Schema.Literal(CLIENT_ARTIFACT_FORMAT),
	compilerVersion: Schema.Literal(CLIENT_COMPILER_VERSION),
	bridgeVersion: Schema.Literal(CLIENT_BRIDGE_PROTOCOL_VERSION),
});

export type PluginBridgeReady = Schema.Schema.Type<typeof PluginBridgeReady>;
