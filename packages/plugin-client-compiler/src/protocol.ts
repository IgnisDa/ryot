import { CanonicalBase64 } from "@ryot-app/contract/schema/base64";
import {
	ClientRuntimeArtifactFromBase64,
	PageClientArtifactFromBase64,
	PluginClientArtifactFromBase64,
} from "@ryot-app/plugin-client-contract";
import { Schema } from "effect";

import { PluginClientCompilerFailure } from "./diagnostics";
import { clientPluginCompilerInputSchema } from "./input";

const CanonicalUint8ArrayFromBase64 = CanonicalBase64.pipe(
	Schema.decodeTo(Schema.Uint8ArrayFromBase64),
);
const ClientCompilerWorkerRequestBase64 = Schema.Struct({
	workspaceJobId: Schema.String,
	workspaceParentPath: Schema.String,
	input: clientPluginCompilerInputSchema(CanonicalUint8ArrayFromBase64),
});
export type ClientCompilerWorkerRequest = typeof ClientCompilerWorkerRequestBase64.Type;
const ClientCompilerWorkerResponseBase64 = Schema.Union([
	Schema.Struct({
		success: Schema.Literal(true),
		value: Schema.Struct({
			artifact: Schema.Union([
				PluginClientArtifactFromBase64,
				ClientRuntimeArtifactFromBase64,
				PageClientArtifactFromBase64,
			]),
		}),
	}),
	Schema.Struct({ success: Schema.Literal(false), error: PluginClientCompilerFailure }),
]);
export type ClientCompilerResponse = typeof ClientCompilerWorkerResponseBase64.Type;
const requestJson = Schema.fromJsonString(ClientCompilerWorkerRequestBase64);
const responseJson = Schema.fromJsonString(ClientCompilerWorkerResponseBase64);
export const encodeClientCompilerWorkerRequest = (request: ClientCompilerWorkerRequest) =>
	Schema.encodeEffect(requestJson)(request);
export const decodeClientCompilerWorkerRequest = Schema.decodeUnknownEffect(requestJson);
export const encodeClientCompilerWorkerResponse = Schema.encodeEffect(responseJson);
export const decodeClientCompilerWorkerResponse = Schema.decodeUnknownEffect(responseJson);
