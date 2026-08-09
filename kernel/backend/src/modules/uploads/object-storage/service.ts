import {
	type ManagedAssetLocator,
	UploadBadRequest,
} from "@ryot-app/contract/modules/uploads/schemas";
import { Clock, Context, Effect, Layer, Stream } from "effect";

import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { S3Service } from "#lib/infrastructure/s3";

const limitStreamBytes = (stream: Stream.Stream<Uint8Array, unknown>, maxBytes: number) => {
	let size = 0;
	return stream.pipe(
		Stream.mapEffect((chunk) => {
			size += chunk.byteLength;
			return size > maxBytes
				? Effect.fail(
						new UploadBadRequest({
							reason: { code: "upload-too-large", actualBytes: size, maxBytes },
						}),
					)
				: Effect.succeed(chunk);
		}),
	);
};

export class ObjectStorageService extends Context.Service<ObjectStorageService>()(
	"ObjectStorageService",
	{
		make: Effect.gen(function* () {
			const s3Service = yield* S3Service;
			const localStorage = yield* LocalStorageService;

			const openObject = Effect.fn("ObjectStorageService.openObject")(function* (
				locator: ManagedAssetLocator,
			) {
				return yield* locator.type === "local"
					? localStorage.openObject(locator.key)
					: s3Service.openObject(locator.key);
			});

			const writeObject = Effect.fn("ObjectStorageService.writeObject")(function* (
				locator: ManagedAssetLocator,
				stream: Stream.Stream<Uint8Array, unknown>,
				contentType: string,
				contentLength: number | undefined,
				maxBytes: number,
			) {
				if (contentLength !== undefined && contentLength > maxBytes) {
					return yield* new UploadBadRequest({
						reason: { code: "upload-too-large", actualBytes: contentLength, maxBytes },
					});
				}
				if (locator.type === "local") {
					return yield* localStorage
						.writeObject(
							locator.key,
							stream,
							contentLength === undefined ? undefined : String(contentLength),
							maxBytes,
						)
						.pipe(
							Effect.tapError((error) => Effect.logError("local object write failed", error)),
							Effect.mapError(() => new UploadBadRequest({ reason: { code: "upload-failed" } })),
						);
				}
				const bounded = limitStreamBytes(stream, maxBytes);
				return yield* s3Service.writeObject(locator.key, bounded, contentType).pipe(
					Effect.catchCause((cause) =>
						s3Service
							.deleteObject(locator.key)
							.pipe(Effect.ignore, Effect.andThen(Effect.failCause(cause))),
					),
					Effect.tapError((error) => Effect.logError("S3 object write failed", error)),
					Effect.mapError(() => new UploadBadRequest({ reason: { code: "upload-failed" } })),
				);
			});

			const writeObjectIfAbsent = Effect.fn("ObjectStorageService.writeObjectIfAbsent")(function* (
				locator: ManagedAssetLocator,
				stream: Stream.Stream<Uint8Array, unknown>,
				contentType: string,
				contentLength: number,
				maxBytes: number,
			) {
				if (contentLength > maxBytes) {
					return yield* new UploadBadRequest({
						reason: { code: "upload-too-large", actualBytes: contentLength, maxBytes },
					});
				}
				if (locator.type === "local") {
					return yield* localStorage
						.writeObjectIfAbsent(locator.key, stream, String(contentLength), maxBytes)
						.pipe(
							Effect.tapError((error) => Effect.logError("local object write failed", error)),
							Effect.mapError(() => new UploadBadRequest({ reason: { code: "upload-failed" } })),
						);
				}
				return yield* s3Service.writeObjectIfAbsent(
					locator.key,
					limitStreamBytes(stream, maxBytes),
					contentType,
					contentLength,
				);
			});

			const selectStorageProvider = (kind: "permanent" | "temporary") =>
				Effect.succeed(
					kind === "permanent" && s3Service.isConfigured ? ("s3" as const) : ("local" as const),
				);

			const statObject = Effect.fn("ObjectStorageService.statObject")(function* (
				locator: ManagedAssetLocator,
			) {
				const info = yield* locator.type === "local"
					? localStorage.statObject(locator.key)
					: s3Service.statObject(locator.key);
				return {
					size: Number(info.size),
					contentType: locator.type === "s3" ? info.type : null,
				};
			});

			const deleteObject = Effect.fn("ObjectStorageService.deleteObject")(function* (
				locator: ManagedAssetLocator,
			) {
				yield* locator.type === "local"
					? localStorage.deleteObject(locator.key)
					: s3Service.deleteObject(locator.key);
			});

			const resolveLocalDownload = Effect.fn("ObjectStorageService.resolveLocalDownload")(
				function* (method: string, url: string) {
					const target = yield* localStorage.verifyDownloadTarget(
						method,
						url,
						Math.floor((yield* Clock.currentTimeMillis) / 1000),
					);
					const path = yield* localStorage
						.resolveObjectPath(target.key)
						.pipe(
							Effect.mapError(
								() => new UploadBadRequest({ reason: { code: "invalid-download-target" } }),
							),
						);
					const info = yield* localStorage
						.statObject(target.key)
						.pipe(
							Effect.mapError(
								() => new UploadBadRequest({ reason: { code: "invalid-download-target" } }),
							),
						);
					return { contentType: target.contentType, path, size: Number(info.size) };
				},
			);

			return {
				openObject,
				statObject,
				writeObject,
				deleteObject,
				writeObjectIfAbsent,
				resolveLocalDownload,
				selectStorageProvider,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
