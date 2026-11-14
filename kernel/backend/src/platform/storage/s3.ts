import { BadRequest, badRequest } from "@ryot-app/contract/errors";
import { S3Client } from "bun";
import { Context, Effect, Layer, Option, Redacted, Schema, Stream } from "effect";
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from "effect/http";

import { AppConfig } from "../config/service";

class S3DeleteFailed extends Schema.TaggedError<
	S3DeleteFailed,
	{ readonly brand: unique symbol }
>()("S3DeleteFailed", { missing: Schema.Boolean }) {}

const isMissingObjectError = (error: unknown) => {
	if (typeof error !== "object" || error === null) {
		return false;
	}
	const details = error as {
		code?: string;
		status?: number;
		message?: string;
		statusCode?: number;
	};
	return (
		details.code === "NoSuchKey" ||
		details.code === "NotFound" ||
		details.status === 404 ||
		details.statusCode === 404 ||
		(typeof details.message === "string" && /\b(?:NoSuchKey|NotFound|404)\b/.test(details.message))
	);
};

export class S3Service extends Context.Service<S3Service>()(
	"@ryot-app/kernel-backend/platform/storage/s3/S3Service",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const httpClient = yield* HttpClient.HttpClient;
			const client = Option.match(config.fileStorage.s3, {
				onNone: () => null,
				onSome: ({ url, region, bucketName, accessKeyId, secretAccessKey }) =>
					new S3Client({
						endpoint: url,
						bucket: bucketName,
						...Option.match(region, { onNone: () => ({}), onSome: (value) => ({ region: value }) }),
						accessKeyId: Redacted.value(accessKeyId),
						secretAccessKey: Redacted.value(secretAccessKey),
					}),
			});

			const isConfigured = client !== null;
			const requireConfigured: Effect.Effect<S3Client, BadRequest> = Effect.suspend(() =>
				client
					? Effect.succeed(client)
					: Effect.fail(
							badRequest("S3 file storage is not configured. Set the FILE_STORAGE_S3_* settings."),
						),
			);

			const presignUpload = Effect.fn("S3Service.presignUpload")(function* (
				key: string,
				contentType: string,
				expiresInSeconds: number,
			) {
				const configuredClient = yield* requireConfigured;
				return yield* Effect.sync(() =>
					configuredClient
						.file(key)
						.presign({ type: contentType, method: "PUT" as const, expiresIn: expiresInSeconds }),
				).pipe(Effect.orDie);
			});

			const presignDownload = Effect.fn("S3Service.presignDownload")(function* (
				key: string,
				expiresInSeconds: number,
				contentDisposition?: string,
			) {
				const configuredClient = yield* requireConfigured;
				return yield* Effect.sync(() =>
					configuredClient
						.file(key)
						.presign({
							expiresIn: expiresInSeconds,
							...(contentDisposition === undefined ? {} : { contentDisposition }),
						}),
				).pipe(Effect.orDie);
			});

			const statObject = Effect.fn("S3Service.statObject")(function* (key: string) {
				const configuredClient = yield* requireConfigured;
				return yield* Effect.tryPromise({
					try: () => configuredClient.file(key).stat(),
					catch: () => badRequest("S3 upload object is missing or invalid"),
				});
			});

			const openObject = Effect.fn("S3Service.openObject")(function* (key: string) {
				const configuredClient = yield* requireConfigured;
				return Stream.fromReadableStream({
					onError: () => badRequest("S3 object read failed"),
					evaluate: () => configuredClient.file(key).stream(),
				});
			});

			const writeObject = Effect.fn("S3Service.writeObject")(function* (
				key: string,
				stream: Stream.Stream<Uint8Array, unknown>,
				contentType: string,
			) {
				const configuredClient = yield* requireConfigured;
				const writer = configuredClient.file(key).writer({ type: contentType });
				const upload = Stream.runForEach(stream, (chunk) =>
					Effect.tryPromise({
						try: () => Promise.resolve(writer.write(chunk)),
						catch: () => badRequest("S3 object write failed"),
					}),
				).pipe(
					Effect.mapError((error) =>
						error instanceof BadRequest ? error : badRequest("S3 object write failed"),
					),
					Effect.andThen(
						Effect.tryPromise({
							try: () => Promise.resolve(writer.end()),
							catch: () => badRequest("S3 object write failed"),
						}),
					),
				);
				yield* upload.pipe(
					Effect.catchCause((cause) =>
						Effect.promise(() =>
							Promise.resolve(writer.end(new Error("S3 object write failed"))),
						).pipe(Effect.ignoreCause, Effect.andThen(Effect.failCause(cause))),
					),
				);
			});

			const writeObjectIfAbsent = Effect.fn("S3Service.writeObjectIfAbsent")(function* (
				key: string,
				stream: Stream.Stream<Uint8Array, unknown>,
				contentType: string,
				contentLength: number,
			) {
				const configuredClient = yield* requireConfigured;
				const body = new Uint8Array(contentLength);
				let offset = 0;
				yield* Stream.runForEach(stream, (chunk) =>
					Effect.suspend(() => {
						if (offset + chunk.byteLength > body.byteLength) {
							return Effect.fail(badRequest("S3 object write failed"));
						}
						body.set(chunk, offset);
						offset += chunk.byteLength;
						return Effect.void;
					}),
				).pipe(Effect.mapError(() => badRequest("S3 object write failed")));
				if (offset !== body.byteLength) {
					return yield* badRequest("S3 object write failed");
				}
				const uploadUrl = configuredClient
					.file(key)
					.presign({ method: "PUT", type: contentType, expiresIn: 15 * 60 });
				const request = HttpClientRequest.make("PUT")(uploadUrl).pipe(
					HttpClientRequest.setHeaders({ "if-none-match": "*" }),
					HttpClientRequest.setBody(HttpBody.uint8Array(body, contentType)),
				);
				const response = yield* httpClient
					.execute(request)
					.pipe(Effect.mapError(() => badRequest("S3 object write failed")));
				if (response.status === 412) {
					return false;
				}
				if (response.status < 200 || response.status >= 300) {
					return yield* badRequest("S3 object write failed");
				}
				return true;
			});

			const deleteObject = Effect.fn("S3Service.deleteObject")(function* (key: string) {
				const configuredClient = yield* requireConfigured;
				yield* Effect.tryPromise({
					try: () => configuredClient.file(key).delete(),
					catch: (cause) => new S3DeleteFailed({ missing: isMissingObjectError(cause) }),
				}).pipe(
					Effect.catch((error) =>
						error.missing ? Effect.void : Effect.fail(badRequest("S3 object deletion failed")),
					),
				);
			});

			return {
				statObject,
				openObject,
				writeObject,
				deleteObject,
				isConfigured,
				presignUpload,
				presignDownload,
				writeObjectIfAbsent,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(FetchHttpClient.layer));
}
