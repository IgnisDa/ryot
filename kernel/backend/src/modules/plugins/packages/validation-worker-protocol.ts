import {
	DefinitionSetValidationRequest,
	DefinitionSetValidationResponse,
	validateDefinitionSetRequest,
} from "@ryot-app/definitions/definition-set-protocol";
import { PluginClientArtifactFromBase64 } from "@ryot-app/plugin-client-contract";
import { Effect, Schema } from "effect";

import { checkPluginSource } from "./pipeline";
import { decodePluginManifest } from "./validation";

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
export const encodeValidateDefinitionSetRequest = (request: DefinitionSetValidationRequest) =>
	Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
		request,
		_tag: "ValidateDefinitionSet",
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
