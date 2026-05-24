import { CLIENT_API_VERSION, PluginClientArtifact } from "@ryot/contract/modules/plugins/client";
import { Schema } from "effect";

import { ClientPluginCompilerFailure } from "./diagnostics";

export const ClientPluginCompilerRequest = Schema.Struct({
	entry: Schema.String,
	apiVersion: Schema.Literal(CLIENT_API_VERSION),
	files: Schema.Record(Schema.String, Schema.String),
});

export type ClientPluginCompilerRequest = Schema.Schema.Type<typeof ClientPluginCompilerRequest>;

const ClientCompilerWorkerSuccess = Schema.Struct({
	success: Schema.Literal(true),
	value: Schema.Struct({ artifact: PluginClientArtifact }),
});

const ClientCompilerWorkerFailure = Schema.Struct({
	error: ClientPluginCompilerFailure,
	success: Schema.Literal(false),
});

export const ClientCompilerWorkerResponse = Schema.Union([
	ClientCompilerWorkerSuccess,
	ClientCompilerWorkerFailure,
]);

export type ClientCompilerWorkerResponse = Schema.Schema.Type<typeof ClientCompilerWorkerResponse>;

export const clientCompilerWorkerFailure = (
	error: ClientPluginCompilerFailure,
): ClientCompilerWorkerResponse => ({ error, success: false });

export const clientCompilerWorkerSuccess = (value: {
	readonly artifact: PluginClientArtifact;
}): ClientCompilerWorkerResponse => ({ value, success: true });
