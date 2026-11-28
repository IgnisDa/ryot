import {
	type DefinitionSetChange,
	DefinitionSetPlugin,
	DefinitionSetScope,
	validateDefinitionSet,
} from "@ryot-app/definitions/definition-set";
import { DefinitionSource } from "@ryot-app/definitions/snapshot";
import { PluginClientArtifactFromBase64 } from "@ryot-app/plugin-client-contract";
import { Effect, Schema } from "effect";

import { checkPluginSource } from "./pipeline";
import { decodePluginManifest } from "./validation";

const DefinitionSetValidationRequest = Schema.Struct({
	baseline: DefinitionSource,
	plugins: Schema.Array(DefinitionSetPlugin),
	change: Schema.optional(
		Schema.Struct({ scope: DefinitionSetScope, pluginIds: Schema.Array(Schema.String) }),
	),
});

export type DefinitionSetValidationRequest = typeof DefinitionSetValidationRequest.Type;

const DefinitionSetValidationResponse = Schema.Union([
	Schema.Struct({ valid: Schema.Literal(true) }),
	Schema.Struct({ issue: Schema.String, valid: Schema.Literal(false) }),
]);

type DefinitionSetValidationResponse = typeof DefinitionSetValidationResponse.Type;

/** Keeps only the fields validation reads, so callers can pass richer plugin records. */
const definitionSetValidationRequest = (
	baseline: DefinitionSource,
	plugins: ReadonlyArray<DefinitionSetPlugin>,
	change?: DefinitionSetChange,
): DefinitionSetValidationRequest => ({
	baseline,
	plugins: plugins.map(({ id, scope, manifest }) =>
		scope === undefined ? { id, manifest } : { id, scope, manifest },
	),
	...(change === undefined ? {} : { change: { ...change, pluginIds: [...change.pluginIds] } }),
});

/** Answers with the string of the error the in-process validator throws. */
const validateDefinitionSetRequest = ({
	change,
	plugins,
	baseline,
}: DefinitionSetValidationRequest) =>
	Effect.try({
		catch: String,
		try: () =>
			validateDefinitionSet(
				baseline,
				plugins,
				change && { scope: change.scope, pluginIds: new Set(change.pluginIds) },
			),
	}).pipe(
		Effect.match({
			onSuccess: (): DefinitionSetValidationResponse => ({ valid: true }),
			onFailure: (issue): DefinitionSetValidationResponse => ({ issue, valid: false }),
		}),
	);

const CheckPluginSourceRequest = Schema.TaggedStruct("CheckPluginSource", {
	manifest: Schema.Unknown,
	catalogs: Schema.Record(Schema.String, Schema.Unknown),
	compiledClient: Schema.optional(PluginClientArtifactFromBase64),
	compiledScripts: Schema.optional(
		Schema.Array(
			Schema.Struct({ entry: Schema.String, format: Schema.Finite, javascript: Schema.String }),
		),
	),
});

const ValidateDefinitionSetRequest = Schema.TaggedStruct("ValidateDefinitionSet", {
	request: DefinitionSetValidationRequest,
});

const PluginValidationWorkerRequest = Schema.Union([
	CheckPluginSourceRequest,
	ValidateDefinitionSetRequest,
]);

const CheckPluginSourceResponse = Schema.Union([
	Schema.Struct({ contentHash: Schema.String, valid: Schema.Literal(true) }),
	Schema.Struct({ valid: Schema.Literal(false), issues: Schema.Array(Schema.String) }),
]);

export const encodeCheckPluginSourceRequest = Schema.encodeEffect(
	Schema.fromJsonString(CheckPluginSourceRequest),
);

/**
 * The definition set was decoded when it was stored and every field encodes as itself, so it is
 * written as JSON: re-encoding large manifests through the schema would block the event loop.
 */
export const encodeValidateDefinitionSetRequest = (
	baseline: DefinitionSource,
	plugins: ReadonlyArray<DefinitionSetPlugin>,
	change?: DefinitionSetChange,
) =>
	Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
		_tag: "ValidateDefinitionSet",
		request: definitionSetValidationRequest(baseline, plugins, change),
	} satisfies typeof ValidateDefinitionSetRequest.Type);

export const decodeCheckPluginSourceResponse = Schema.decodeUnknownEffect(
	Schema.fromJsonString(CheckPluginSourceResponse),
);

export const decodeValidateDefinitionSetResponse = Schema.decodeUnknownEffect(
	Schema.fromJsonString(DefinitionSetValidationResponse),
);

const decodeRequest = Schema.decodeUnknownEffect(
	Schema.fromJsonString(PluginValidationWorkerRequest),
);
const encodeCheckResponse = Schema.encodeEffect(Schema.fromJsonString(CheckPluginSourceResponse));
const encodeDefinitionSetResponse = Schema.encodeEffect(
	Schema.fromJsonString(DefinitionSetValidationResponse),
);

const checkSource = (request: typeof CheckPluginSourceRequest.Type) =>
	decodePluginManifest(request.manifest).pipe(
		Effect.flatMap((manifest) => checkPluginSource(manifest, request)),
		Effect.match({
			onFailure: ({ issues }): typeof CheckPluginSourceResponse.Type => ({ issues, valid: false }),
			onSuccess: (contentHash): typeof CheckPluginSourceResponse.Type => ({
				contentHash,
				valid: true,
			}),
		}),
		Effect.flatMap(encodeCheckResponse),
	);

/** Serves one request line; a request that does not decode is a protocol defect. */
export const servePluginValidationRequest = (line: string) =>
	decodeRequest(line).pipe(
		Effect.flatMap((request) =>
			request._tag === "CheckPluginSource"
				? checkSource(request)
				: validateDefinitionSetRequest(request.request).pipe(
						Effect.flatMap(encodeDefinitionSetResponse),
					),
		),
		Effect.orDie,
	);
