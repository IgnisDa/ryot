import { S3Client } from "bun";
import { Effect, Option, Redacted } from "effect";

import { AppConfig } from "./config";

export class S3Service extends Effect.Service<S3Service>()("S3Service", {
	effect: Effect.gen(function* () {
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

		const presignUpload = Effect.fn("S3Service.presignUpload")(function* (
			key: string,
			contentType: string,
			expiresInSeconds: number,
		) {
			if (!client) {
				return yield* Effect.die("S3 is not configured");
			}
			return yield* Effect.sync(() =>
				client
					.file(key)
					.presign({ type: contentType, method: "PUT" as const, expiresIn: expiresInSeconds }),
			).pipe(Effect.orDie);
		});

		const presignDownload = Effect.fn("S3Service.presignDownload")(function* (
			key: string,
			expiresInSeconds: number,
		) {
			if (!client) {
				return yield* Effect.die("S3 is not configured");
			}
			return yield* Effect.sync(() =>
				client.file(key).presign({ expiresIn: expiresInSeconds }),
			).pipe(Effect.orDie);
		});

		return { isConfigured, presignUpload, presignDownload };
	}),
}) {}
