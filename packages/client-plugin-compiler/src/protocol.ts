import {
	PluginClientArtifactFromBase64,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
import { CanonicalBase64 } from "@ryot-app/contract/schema/base64";
import { Schema } from "effect";

import { ClientPluginCompilerFailure } from "./diagnostics";
import { clientPluginCompilerInputSchemas, type ClientPluginCompilerInput } from "./input";

const CanonicalUint8ArrayFromBase64 = CanonicalBase64.pipe(
	Schema.decodeTo(Schema.Uint8ArrayFromBase64),
);

export const ClientCompilerWorkerRequestBase64 = clientPluginCompilerInputSchemas(
	CanonicalUint8ArrayFromBase64,
).input;
export type ClientCompilerWorkerRequestBase64 = Schema.Codec.Encoded<
	typeof ClientCompilerWorkerRequestBase64
>;

export const ClientCompilerWorkerResponseBase64 = Schema.Union([
	Schema.Struct({
		success: Schema.Literal(true),
		value: Schema.Struct({ artifact: PluginClientArtifactFromBase64 }),
	}),
	Schema.Struct({ success: Schema.Literal(false), error: ClientPluginCompilerFailure }),
]);
export type ClientCompilerWorkerResponseBase64 = Schema.Codec.Encoded<
	typeof ClientCompilerWorkerResponseBase64
>;
export type ClientCompilerResponse = Schema.Schema.Type<typeof ClientCompilerWorkerResponseBase64>;

const requestJson = Schema.fromJsonString(ClientCompilerWorkerRequestBase64);
const responseJson = Schema.fromJsonString(ClientCompilerWorkerResponseBase64);

export const encodeClientCompilerWorkerRequest = (request: ClientPluginCompilerInput) =>
	Schema.encodeSync(requestJson)(request);
export const decodeClientCompilerWorkerRequest = (input: string) =>
	Schema.decodeUnknownEffect(requestJson)(input);

export const encodeClientCompilerWorkerResponse = (response: ClientCompilerResponse) =>
	Schema.encodeSync(responseJson)(response);
export const decodeClientCompilerWorkerResponse = (input: string) =>
	Schema.decodeUnknownEffect(responseJson)(input);

export const clientCompilerWorkerFailure = (
	error: ClientPluginCompilerFailure,
): ClientCompilerResponse => ({ error, success: false });
export const clientCompilerWorkerSuccess = (value: {
	readonly artifact: PluginClientArtifact;
}): ClientCompilerResponse => ({ value, success: true });
