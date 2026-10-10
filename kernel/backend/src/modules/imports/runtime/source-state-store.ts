import {
	IngestionPayload,
	type IngestionScope,
} from "@ryot-app/contract/modules/imports/ingestion";
import { UPLOAD_MAX_FILE_BYTES } from "@ryot-app/contract/modules/uploads/upload-policy";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, FileSystem, Layer, Schema } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { PluginConfigEncryptionKey } from "#modules/plugins/config-encryption-key";
import { IngestionPayloads } from "#modules/uploads/object-storage/ingestion-payloads";

import { IngestionCaptures } from "../capture-service";
import { ImportsRepository } from "../repository";
import { ImportSourceState } from "./source-state";
import { ImportRunError } from "./workflow-errors";

const { namedArtifactPaths: _namedArtifactPaths, ...sourceFields } = ImportSourceState.fields;

const DurableSourceState = Schema.Struct({
	...sourceFields,
	files: Schema.Record(Schema.String, IngestionPayload),
});
const Ciphertext = Schema.Struct({
	keyId: Schema.String,
	nonce: Schema.String,
	ciphertext: Schema.String,
});
const maximumStateBytes = 1024 * 1024;
const maximumEnvelopeBytes = 48 * 1024 * 1024;
const maximumFileBytes = UPLOAD_MAX_FILE_BYTES;
const encryptionPurpose = "ryot/ingestion/admitted-input";
const AdmittedEnvelope = Schema.Struct({ rawBody: Schema.String, contentType: Schema.String });

export class ImportSourceStateStore extends Context.Service<ImportSourceStateStore>()(
	"ImportSourceStateStore",
	{
		make: Effect.gen(function* () {
			const captures = yield* IngestionCaptures;
			const payloads = yield* IngestionPayloads;
			const repository = yield* ImportsRepository;
			const keys = yield* PluginConfigEncryptionKey;
			const fs = yield* FileSystem.FileSystem;
			const config = yield* AppConfig;
			const load = Effect.fn("ImportSourceStateStore.load")(function* (scope: IngestionScope) {
				const bytes = yield* captures.read(scope, "admitted-source", maximumStateBytes);
				const envelope = yield* Schema.decodeEffect(Schema.fromJsonString(Ciphertext))(
					new TextDecoder().decode(bytes),
				);
				const plaintext = yield* (yield* keys.load).decryptWithSubkey(
					encryptionPurpose,
					envelope,
					scope,
				);
				return yield* Schema.decodeEffect(Schema.fromJsonString(DurableSourceState))(plaintext);
			});
			const store = Effect.fn("ImportSourceStateStore.store")(function* (input: {
				scope: IngestionScope;
				state: ImportSourceState;
			}) {
				const { namedArtifactPaths, ...state } = input.state;
				const entries = Object.entries(namedArtifactPaths).sort(([a], [b]) => a.localeCompare(b));
				if (entries.length > 32) {
					return yield* new ImportRunError({ message: "Too many ingestion input files" });
				}
				const files: Record<string, IngestionPayload> = {};
				for (const [index, [key, path]] of entries.entries()) {
					const info = yield* fs.stat(path);
					if (Number(info.size) > maximumFileBytes) {
						return yield* new ImportRunError({
							message: "Ingestion input file exceeds its byte limit",
						});
					}
					const capture = yield* captures.publish({
						state: "sealed",
						checkpoint: null,
						ordinal: index + 1,
						scope: input.scope,
						phase: "collection",
						id: `admitted-file:${key}`,
						maxBytes: maximumFileBytes,
						bytes: yield* fs.readFile(path),
					});
					if (capture.payload) {
						files[key] = capture.payload;
					}
				}
				const durable = { ...state, files };
				const previous = yield* repository.getCapture(input.scope, "admitted-source");
				if (previous) {
					if (stableStringify(yield* load(input.scope)) !== stableStringify(durable)) {
						return yield* new ImportRunError({
							message: "Ingestion admitted input identity changed",
						});
					}
					return yield* Effect.void;
				}
				const plaintext = yield* Schema.encodeEffect(Schema.fromJsonString(DurableSourceState))(
					durable,
				);
				const encrypted = yield* (yield* keys.load).encryptWithSubkey(
					encryptionPurpose,
					plaintext,
					input.scope,
				);
				yield* captures.publish({
					ordinal: 0,
					state: "sealed",
					checkpoint: null,
					scope: input.scope,
					phase: "collection",
					id: "admitted-source",
					maxBytes: maximumStateBytes,
					bytes: new TextEncoder().encode(stableStringify(encrypted)),
					inputFingerprint: yield* (yield* keys.load).fingerprint(durable),
				});
				return yield* Effect.void;
			});
			const materialize = Effect.fn("ImportSourceStateStore.materialize")(function* (
				scope: IngestionScope,
			) {
				const { files, ...state } = yield* load(scope);
				const namedArtifactPaths: Record<string, string> = {};
				for (const [key, payload] of Object.entries(files)) {
					namedArtifactPaths[key] = yield* payloads.materialize(payload, maximumFileBytes);
				}
				return { ...state, namedArtifactPaths };
			});
			const storeEnvelope = Effect.fn("ImportSourceStateStore.storeEnvelope")(function* (
				scope: IngestionScope,
				input: typeof AdmittedEnvelope.Type,
			) {
				const plaintext = yield* Schema.encodeEffect(Schema.fromJsonString(AdmittedEnvelope))(
					input,
				);
				const encrypted = yield* (yield* keys.load).encryptWithSubkey(
					encryptionPurpose,
					plaintext,
					scope,
				);
				return yield* captures.publish({
					scope,
					ordinal: 33,
					state: "sealed",
					checkpoint: null,
					phase: "collection",
					id: "admitted-envelope",
					maxBytes: maximumEnvelopeBytes,
					bytes: new TextEncoder().encode(stableStringify(encrypted)),
					inputFingerprint: yield* (yield* keys.load).fingerprint(input),
				});
			});
			const loadEnvelope = Effect.fn("ImportSourceStateStore.loadEnvelope")(function* (
				scope: IngestionScope,
			) {
				const bytes = yield* captures.read(scope, "admitted-envelope", maximumEnvelopeBytes);
				const envelope = yield* Schema.decodeEffect(Schema.fromJsonString(Ciphertext))(
					new TextDecoder().decode(bytes),
				);
				return yield* Schema.decodeEffect(Schema.fromJsonString(AdmittedEnvelope))(
					yield* (yield* keys.load).decryptWithSubkey(encryptionPurpose, envelope, scope),
				);
			});
			const materializeEnvelope = Effect.fn("ImportSourceStateStore.materializeEnvelope")(
				function* (scope: IngestionScope) {
					const envelope = yield* loadEnvelope(scope);
					const path = yield* fs.makeTempFileScoped({
						directory: yield* fs.realPath(config.fileStorage.localTempDir),
					});
					yield* fs.writeFileString(path, stableStringify(envelope));
					return path;
				},
			);
			return { load, store, materialize, loadEnvelope, storeEnvelope, materializeEnvelope };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(
			Layer.mergeAll(
				IngestionCaptures.layer,
				IngestionPayloads.layer,
				ImportsRepository.layer,
				PluginConfigEncryptionKey.layer,
			),
		),
	);
}
