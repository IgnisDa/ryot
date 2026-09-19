import type {
	IngestionPayload,
	IngestionScope,
} from "@ryot-app/contract/modules/imports/ingestion";
import { ManagedAssetLocator } from "@ryot-app/contract/modules/uploads/schemas";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, FileSystem, Layer, Path, Schema, Stream } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";

import { ObjectStorageService } from "./service";

export class IngestionPayloadError extends Schema.TaggedError<IngestionPayloadError>()(
	"IngestionPayloadError",
	{ message: Schema.String, kind: Schema.Literals(["unavailable", "corrupt"]) },
) {}

export const ingestionPayloadDigest = (bytes: Uint8Array | string) =>
	new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

export class IngestionPayloads extends Context.Service<IngestionPayloads>()("IngestionPayloads", {
	make: Effect.gen(function* () {
		const storage = yield* ObjectStorageService;
		const fs = yield* FileSystem.FileSystem;
		const paths = yield* Path.Path;
		const config = yield* AppConfig;
		const decodeLocator = Schema.decodeEffect(Schema.fromJsonString(ManagedAssetLocator));
		const encodeLocator = Schema.encodeEffect(Schema.fromJsonString(ManagedAssetLocator));
		const read = Effect.fn("IngestionPayloads.read")(
			function* (payload: IngestionPayload, maxBytes: number) {
				if (payload.byteSize > maxBytes) {
					return yield* new IngestionPayloadError({
						kind: "corrupt",
						message: "Ingestion payload exceeds its byte limit",
					});
				}
				const locator = yield* decodeLocator(payload.locator);
				const chunks: Uint8Array[] = [];
				let size = 0;
				const hash = new Bun.CryptoHasher("sha256");
				yield* (yield* storage.openObject(locator)).pipe(
					Stream.runForEach((chunk) => {
						size += chunk.byteLength;
						if (size > maxBytes || size > payload.byteSize) {
							return Effect.fail(
								new IngestionPayloadError({
									kind: "corrupt",
									message: "Ingestion payload size mismatch",
								}),
							);
						}
						hash.update(chunk);
						chunks.push(chunk);
						return Effect.void;
					}),
				);
				if (size !== payload.byteSize || hash.digest("hex") !== payload.checksum) {
					return yield* new IngestionPayloadError({
						kind: "corrupt",
						message: "Ingestion payload checksum mismatch",
					});
				}
				return Buffer.concat(chunks);
			},
			(effect) =>
				effect.pipe(
					Effect.mapError((error) =>
						error instanceof IngestionPayloadError
							? error
							: new IngestionPayloadError({
									kind: "unavailable",
									message: "Ingestion payload bytes are unavailable",
								}),
					),
				),
		);
		const describe = Effect.fn("IngestionPayloads.describe")(function* (input: {
			scope: IngestionScope;
			id: string;
			bytes: Uint8Array;
		}) {
			const checksum = ingestionPayloadDigest(input.bytes);
			const key = `permanent/ingestion-${ingestionPayloadDigest(stableStringify([input.scope, input.id]))}.bin`;
			const locator = { key, type: yield* storage.selectStorageProvider("permanent") };
			const payload = {
				checksum,
				byteSize: input.bytes.byteLength,
				locator: yield* encodeLocator(locator),
			};
			return payload;
		});
		const write = Effect.fn("IngestionPayloads.write")(function* (input: {
			payload: IngestionPayload;
			bytes: Uint8Array;
			maxBytes: number;
		}) {
			const payload = input.payload;
			const locator = yield* decodeLocator(payload.locator);
			if (
				ingestionPayloadDigest(input.bytes) !== payload.checksum ||
				input.bytes.byteLength !== payload.byteSize
			) {
				return yield* new IngestionPayloadError({
					kind: "corrupt",
					message: "Ingestion payload identity changed",
				});
			}
			yield* storage.writeObjectIfAbsent(
				locator,
				Stream.make(input.bytes),
				"application/octet-stream",
				input.bytes.byteLength,
				input.maxBytes,
			);
			yield* read(payload, input.maxBytes);
			return payload;
		});
		const remove = Effect.fn("IngestionPayloads.remove")(function* (payload: IngestionPayload) {
			yield* storage.deleteObject(yield* decodeLocator(payload.locator));
		});
		const materialize = Effect.fn("IngestionPayloads.materialize")(
			function* (payload: IngestionPayload, maxBytes: number) {
				const bytes = yield* read(payload, maxBytes);
				const path = yield* fs.makeTempFileScoped({
					directory: yield* fs.realPath(config.fileStorage.localTempDir),
				});
				yield* fs.writeFile(path, bytes);
				return path;
			},
			(effect) =>
				effect.pipe(
					Effect.provideService(FileSystem.FileSystem, fs),
					Effect.provideService(Path.Path, paths),
				),
		);
		return { read, write, remove, describe, materialize };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(ObjectStorageService.layer),
	);
}
