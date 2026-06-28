import {
	CLIENT_API_VERSION,
	PluginClientArtifact,
	PluginClientArtifactMetadata,
} from "@ryot-app/client-plugin-contract";
import { CanonicalBase64 } from "@ryot-app/contract/schema/base64";
import { Effect, Encoding, Schema } from "effect";

import type { ClientPluginCompilerInput } from "./compile";
import { ClientPluginCompilerFailure } from "./diagnostics";

const ClientCompilerWorkerRequestFields = {
	name: Schema.String,
	apiVersion: Schema.Literal(CLIENT_API_VERSION),
};

const ClientCompilerPublicExport = Schema.Struct({
	entry: Schema.String,
	contributor: Schema.String,
	kind: Schema.Literals(["component", "page", "presentation"]),
});

const ClientCompilerPackageExport = Schema.Struct({
	entry: Schema.String,
	kind: Schema.Literals(["component", "page", "presentation"]),
});

export const ClientCompilerWorkerRequestBase64 = Schema.Union([
	Schema.Struct({
		...ClientCompilerWorkerRequestFields,
		files: Schema.Record(Schema.String, CanonicalBase64),
		pluginDependencies: Schema.optional(Schema.Array(Schema.String)),
		publicExports: Schema.Record(Schema.String, ClientCompilerPackageExport),
	}),
	Schema.Struct({
		...ClientCompilerWorkerRequestFields,
		entry: Schema.String,
		application: Schema.Literal("page"),
		files: Schema.Record(Schema.String, CanonicalBase64),
	}),
	Schema.Struct({
		...ClientCompilerWorkerRequestFields,
		contributorOrder: Schema.Array(Schema.String),
		application: Schema.Literals(["page", "plugin-route"]),
		entry: Schema.Struct({ contributor: Schema.String, path: Schema.String }),
		publicExports: Schema.Record(Schema.String, ClientCompilerPublicExport),
		contributors: Schema.Record(
			Schema.String,
			Schema.Struct({ files: Schema.Record(Schema.String, CanonicalBase64) }),
		),
		automaticRegistry: Schema.optional(
			Schema.Array(
				Schema.Struct({
					ownerPluginId: Schema.String,
					exportSpecifier: Schema.String,
					entitySchemaSlug: Schema.String,
					layout: Schema.Literals(["grid", "list"]),
				}),
			),
		),
		routeRegistry: Schema.optional(
			Schema.Struct({
				home: Schema.String,
				notFound: Schema.optional(Schema.String),
				routes: Schema.Array(
					Schema.Struct({ path: Schema.String, exportSpecifier: Schema.String }),
				),
			}),
		),
	}),
]);

export type ClientCompilerWorkerRequestBase64 = Schema.Schema.Type<
	typeof ClientCompilerWorkerRequestBase64
>;

const ClientCompilerWorkerArtifactBase64 = Schema.Struct({
	...PluginClientArtifactMetadata.fields,
	files: Schema.Array(
		Schema.Struct({ name: Schema.String, contents: CanonicalBase64, contentType: Schema.String }),
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
	| { readonly success: true; readonly value: { readonly artifact: PluginClientArtifact } };

const decodeBase64 = Schema.decodeUnknownSync(Schema.Uint8ArrayFromBase64);

export const encodeClientCompilerWorkerRequest = (request: ClientPluginCompilerInput) => {
	if ("contributors" in request) {
		return JSON.stringify({
			...request,
			contributors: Object.fromEntries(
				Object.entries(request.contributors).map(([namespace, contributor]) => [
					namespace,
					{
						files: Object.fromEntries(
							Object.entries(contributor.files).map(([path, contents]) => [
								path,
								Encoding.encodeBase64(contents),
							]),
						),
					},
				]),
			),
		});
	}
	return JSON.stringify({
		...request,
		files: Object.fromEntries(
			Object.entries(request.files).map(([path, contents]) => [
				path,
				Encoding.encodeBase64(contents),
			]),
		),
	});
};

export const decodeClientCompilerWorkerRequest = (input: string) =>
	Schema.decodeUnknownEffect(Schema.fromJsonString(ClientCompilerWorkerRequestBase64))(input).pipe(
		Effect.map((request): ClientPluginCompilerInput => {
			if ("contributors" in request) {
				return {
					name: request.name,
					entry: request.entry,
					apiVersion: request.apiVersion,
					application: request.application,
					publicExports: request.publicExports,
					contributorOrder: request.contributorOrder,
					...(request.automaticRegistry === undefined
						? {}
						: { automaticRegistry: request.automaticRegistry }),
					...(request.routeRegistry === undefined
						? {}
						: {
								routeRegistry: {
									home: request.routeRegistry.home,
									routes: request.routeRegistry.routes,
									...(request.routeRegistry.notFound === undefined
										? {}
										: { notFound: request.routeRegistry.notFound }),
								},
							}),
					contributors: Object.fromEntries(
						Object.entries(request.contributors).map(([namespace, contributor]) => [
							namespace,
							{
								files: Object.fromEntries(
									Object.entries(contributor.files).map(([path, contents]) => [
										path,
										decodeBase64(contents),
									]),
								),
							},
						]),
					),
				};
			}
			return {
				name: request.name,
				apiVersion: request.apiVersion,
				...("entry" in request
					? { entry: request.entry, application: request.application }
					: { publicExports: request.publicExports }),
				...(!("pluginDependencies" in request) || request.pluginDependencies === undefined
					? {}
					: { pluginDependencies: request.pluginDependencies }),
				files: Object.fromEntries(
					Object.entries(request.files).map(([path, contents]) => [path, decodeBase64(contents)]),
				),
			};
		}),
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
