/* oxlint-disable perfectionist/sort-objects -- Wire evidence fields follow timing chronology. */
import {
	CLIENT_API_VERSION,
	PluginClientArtifact,
	PluginClientArtifactMetadata,
} from "@ryot-app/client-plugin-contract";
import { CanonicalBase64 } from "@ryot-app/contract/schema/base64";
import { Effect, Encoding, Schema } from "effect";

import type { ClientPluginCompilerInput } from "./compile";
import { ClientPluginCompilerFailure } from "./diagnostics";
import type { ClientCompilerBenchmarkEvidence } from "./instrumentation";

const ClientCompilerWorkerRequestFields = {
	name: Schema.String,
	apiVersion: Schema.Literal(CLIENT_API_VERSION),
	stylexTracer: Schema.optional(Schema.Struct({ fingerprint: Schema.String })),
	benchmarkInstrumentation: Schema.optional(Schema.Struct({ traceId: Schema.String })),
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
		contributorOrder: Schema.Array(Schema.String),
		application: Schema.Literals(["page", "plugin-route"]),
		publicExports: Schema.Record(Schema.String, ClientCompilerPublicExport),
		entry: Schema.Struct({ path: Schema.String, contributor: Schema.String }),
		contributors: Schema.Record(
			Schema.String,
			Schema.Struct({ files: Schema.Record(Schema.String, CanonicalBase64) }),
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

const ClientCompilerBenchmarkSpan = Schema.Struct({
	name: Schema.Literals([
		"assets",
		"bundle",
		"cleanup",
		"compilation-total",
		"css-emission",
		"dependency-reads",
		"hashing-artifact",
		"input-validation",
		"original-source-preflight",
		"stylex-transform",
		"trusted-reads-materialization",
		"typescript-check",
	]),
	startedNs: Schema.Number,
	endedNs: Schema.Number,
	durationMs: Schema.Number,
	inclusive: Schema.Boolean,
});

const ClientCompilerBenchmarkEvidenceSchema = Schema.Struct({
	traceId: Schema.String,
	pid: Schema.Number,
	spans: Schema.Array(ClientCompilerBenchmarkSpan),
	counters: Schema.Record(Schema.String, Schema.Number),
	worker: Schema.optional(
		Schema.Struct({
			processStartedNs: Schema.Number,
			importsReadyNs: Schema.Number,
			requestReadStartedNs: Schema.Number,
			artifactReadyNs: Schema.Number,
		}),
	),
});

const ClientCompilerWorkerSuccess = Schema.Struct({
	success: Schema.Literal(true),
	value: Schema.Struct({
		artifact: ClientCompilerWorkerArtifactBase64,
		benchmarkInstrumentation: Schema.optional(ClientCompilerBenchmarkEvidenceSchema),
	}),
});

const ClientCompilerWorkerFailure = Schema.Struct({
	success: Schema.Literal(false),
	error: ClientPluginCompilerFailure,
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
			readonly value: {
				readonly artifact: PluginClientArtifact;
				readonly benchmarkInstrumentation?: ClientCompilerBenchmarkEvidence;
			};
	  };

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
			const stylexTracer =
				request.stylexTracer === undefined ? {} : { stylexTracer: request.stylexTracer };
			const benchmarkInstrumentation =
				request.benchmarkInstrumentation === undefined
					? {}
					: { benchmarkInstrumentation: request.benchmarkInstrumentation };
			if ("contributors" in request) {
				return {
					...stylexTracer,
					...benchmarkInstrumentation,
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
				...stylexTracer,
				...benchmarkInstrumentation,
				name: request.name,
				apiVersion: request.apiVersion,
				publicExports: request.publicExports,
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
						...(response.value.benchmarkInstrumentation === undefined
							? {}
							: { benchmarkInstrumentation: response.value.benchmarkInstrumentation }),
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
			const benchmarkInstrumentation = response.value.benchmarkInstrumentation;
			return Schema.decodeUnknownEffect(PluginClientArtifact)(artifact).pipe(
				Effect.map(
					(decodedArtifact) =>
						({
							success: true,
							value: {
								artifact: decodedArtifact,
								...(benchmarkInstrumentation === undefined
									? {}
									: {
											benchmarkInstrumentation: {
												traceId: benchmarkInstrumentation.traceId,
												pid: benchmarkInstrumentation.pid,
												spans: benchmarkInstrumentation.spans,
												counters: benchmarkInstrumentation.counters,
												...(benchmarkInstrumentation.worker === undefined
													? {}
													: { worker: benchmarkInstrumentation.worker }),
											},
										}),
							},
						}) as const,
				),
			);
		}),
	);

export const clientCompilerWorkerFailure = (
	error: ClientPluginCompilerFailure,
): ClientCompilerResponse => ({ error, success: false });

export const clientCompilerWorkerSuccess = (value: {
	readonly artifact: PluginClientArtifact;
	readonly benchmarkInstrumentation?: ClientCompilerBenchmarkEvidence;
}): ClientCompilerResponse => ({ value, success: true });
