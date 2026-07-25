import { type BadRequest, badRequest } from "@ryot/contract/errors";
import { S3Client } from "bun";
import { Context, Effect, Layer, Option, Redacted } from "effect";

import { AppConfig } from "./config/service";

const isMissingObjectError = (error: unknown) => {
	if (typeof error !== "object" || error === null) {
		return false;
	}
	const details = error as {
		code?: string;
		message?: string;
		status?: number;
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

export class S3Service extends Context.Service<S3Service>()("S3Service", {
	make: Effect.gen(function* () {
		const config = yield* AppConfig;
		const { url, region, bucketName, accessKeyId, secretAccessKey } = config.fileStorage;

		const s3Url = Option.isSome(url) ? url.value : null;
		const s3Region = Option.isSome(region) ? region.value : null;
		const s3Bucket = Option.isSome(bucketName) ? bucketName.value : null;
		const s3AccessKey = Option.isSome(accessKeyId) ? Redacted.value(accessKeyId.value) : null;
		const s3Secret = Option.isSome(secretAccessKey) ? Redacted.value(secretAccessKey.value) : null;

		const hasAllConfig =
			s3Url !== null &&
			s3Url.length > 0 &&
			s3Bucket !== null &&
			s3Bucket.length > 0 &&
			s3AccessKey !== null &&
			s3AccessKey.length > 0 &&
			s3Secret !== null &&
			s3Secret.length > 0;

		const client: S3Client | null = hasAllConfig
			? new S3Client({
					endpoint: s3Url,
					bucket: s3Bucket,
					accessKeyId: s3AccessKey,
					secretAccessKey: s3Secret,
					...(s3Region && s3Region.length > 0 ? { region: s3Region } : {}),
				})
			: null;

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
		) {
			const configuredClient = yield* requireConfigured;
			return yield* Effect.sync(() =>
				configuredClient.file(key).presign({ expiresIn: expiresInSeconds }),
			).pipe(Effect.orDie);
		});

		const statObject = Effect.fn("S3Service.statObject")(function* (key: string) {
			const configuredClient = yield* requireConfigured;
			return yield* Effect.tryPromise(() => configuredClient.file(key).stat()).pipe(
				Effect.mapError(() => badRequest("S3 upload object is missing or invalid")),
			);
		});

		const deleteObject = Effect.fn("S3Service.deleteObject")(function* (key: string) {
			const configuredClient = yield* requireConfigured;
			yield* Effect.tryPromise(() => configuredClient.file(key).delete()).pipe(
				Effect.catch((error) =>
					isMissingObjectError(error)
						? Effect.void
						: Effect.fail(badRequest("S3 object deletion failed")),
				),
			);
		});

		return { deleteObject, isConfigured, presignDownload, presignUpload, statObject };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
