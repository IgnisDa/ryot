import {
	CLIENT_API_VERSION,
	PluginClientArtifact,
	PluginClientArtifactMetadata,
} from "@ryot-app/contract/modules/plugins/client";
import { CanonicalBase64 } from "@ryot-app/contract/schema/base64";
import { Effect, Encoding, Schema } from "effect";

import type { ClientPluginCompilerInput } from "./compile";
import { ClientPluginCompilerFailure } from "./diagnostics";

export const ClientCompilerWorkerRequestBase64 = Schema.Struct({
	entry: Schema.String,
	apiVersion: Schema.Literal(CLIENT_API_VERSION),
	files: Schema.Record(Schema.String, CanonicalBase64),
});

export type ClientCompilerWorkerRequestBase64 = Schema.Schema.Type<
	typeof ClientCompilerWorkerRequestBase64
>;

const ClientCompilerWorkerArtifactBase64 = Schema.Struct({
	...PluginClientArtifactMetadata.fields,
	files: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			contents: CanonicalBase64,
			contentType: Schema.String,
		}),
	),
});

const ClientCompilerWorkerSuccess = Schema.Struct({
	success: Schema.Literal(true),
	value: Schema.Struct({ artifact: ClientCompilerWorkerArtifactBase64 }),
});

const ClientCompilerWorkerFailure = Schema.Struct({
	error: ClientPluginCompilerFailure,
	success: Schema.Literal(false),
});

export const ClientCompilerWorkerResponseBase64 = Schema.Union([
	ClientCompilerWorkerSuccess,
	ClientCompilerWorkerFailure,
]);

export type ClientCompilerWorkerResponseBase64 = Schema.Schema.Type<
	typeof ClientCompilerWorkerResponseBase64
>;

export type ClientCompilerResponse =
	| { readonly error: ClientPluginCompilerFailure; readonly success: false }
	| {
			readonly success: true;
			readonly value: { readonly artifact: PluginClientArtifact };
	  };

const decodeBase64 = Schema.decodeUnknownSync(Schema.Uint8ArrayFromBase64);

export const encodeClientCompilerWorkerRequest = (request: ClientPluginCompilerInput) =>
	JSON.stringify({
		...request,
		files: Object.fromEntries(
			Object.entries(request.files).map(([path, contents]) => [
				path,
				Encoding.encodeBase64(contents),
			]),
		),
	} satisfies ClientCompilerWorkerRequestBase64);

export const decodeClientCompilerWorkerRequest = (input: string) =>
	Schema.decodeUnknownEffect(Schema.fromJsonString(ClientCompilerWorkerRequestBase64))(input).pipe(
		Effect.map(
			(request): ClientPluginCompilerInput => ({
				...request,
				files: Object.fromEntries(
					Object.entries(request.files).map(([path, contents]) => [path, decodeBase64(contents)]),
				),
			}),
		),
	);

export const encodeClientCompilerWorkerResponse = (response: ClientCompilerResponse) =>
	JSON.stringify(
		response.success
			? {
					success: true,
					value: {
						artifact: {
							...response.value.artifact,
							files: response.value.artifact.files.map((file) => ({
								...file,
								contents: Encoding.encodeBase64(file.contents),
							})),
						},
					},
				}
			: response,
	);

export const decodeClientCompilerWorkerResponse = (input: string) =>
	Schema.decodeUnknownEffect(Schema.fromJsonString(ClientCompilerWorkerResponseBase64))(input).pipe(
		Effect.flatMap((response): Effect.Effect<ClientCompilerResponse, unknown> => {
			if (!response.success) {
				return Effect.succeed(response);
			}
			const artifact = {
				...response.value.artifact,
				files: response.value.artifact.files.map((file) => ({
					...file,
					contents: decodeBase64(file.contents),
				})),
			};
			return Schema.decodeUnknownEffect(PluginClientArtifact)(artifact).pipe(
				Effect.map(
					(decodedArtifact) => ({ success: true, value: { artifact: decodedArtifact } }) as const,
				),
			);
		}),
	);

export const clientCompilerWorkerFailure = (
	error: ClientPluginCompilerFailure,
): ClientCompilerResponse => ({ error, success: false });

export const clientCompilerWorkerSuccess = (value: {
	readonly artifact: PluginClientArtifact;
}): ClientCompilerResponse => ({ value, success: true });
