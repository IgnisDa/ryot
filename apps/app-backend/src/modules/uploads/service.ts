import type { Multipart } from "@effect/platform";
import { FileSystem } from "@effect/platform";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { type BadRequest, badRequest } from "@ryot/contract/errors";
import {
	type UploadContentType,
	uploadContentTypeExtensions,
	uploadContentTypes,
} from "@ryot/contract/modules/uploads/upload-policy";
import { UserId } from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import { Effect, Schema } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { RedisService, redisKeys } from "#lib/infrastructure/redis";
import { S3Service } from "#lib/infrastructure/s3";

const UPLOAD_TOKEN_TTL_SECONDS = 15 * 60;
const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60;
const TEMPORARY_UPLOAD_MAX_FILE_BYTES = 50 * 1024 * 1024;

const UploadTokenValue = Schema.Struct({
	userId: UserId,
	resolvedPath: Schema.String,
});

const resolveExtension = (contentType: UploadContentType) =>
	uploadContentTypeExtensions[contentType][0];

const isUploadContentType = (value: string): value is UploadContentType =>
	(uploadContentTypes as readonly string[]).includes(value);

const resolveContentType = (contentType: string): Effect.Effect<UploadContentType, BadRequest> => {
	const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	if (!normalized || !isUploadContentType(normalized)) {
		return Effect.fail(badRequest("Upload content type must be a supported MIME type"));
	}
	return Effect.succeed(normalized);
};

const resolveContentTypeFromFileName = (
	fileName: string,
): Effect.Effect<UploadContentType, BadRequest> => {
	const extension = fileName.split(".").pop()?.trim().toLowerCase() ?? "";
	const entry = Object.entries(uploadContentTypeExtensions).find(([, exts]) =>
		exts.includes(extension),
	);
	if (!entry || !isUploadContentType(entry[0])) {
		return Effect.fail(badRequest(`Unsupported file extension: .${extension}`));
	}
	return Effect.succeed(entry[0]);
};

const resolveTemporaryUploadContentType = (
	contentType: string,
	fileName: string,
): Effect.Effect<UploadContentType, BadRequest> => {
	const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	if (!normalized || normalized === "application/octet-stream") {
		return resolveContentTypeFromFileName(fileName);
	}
	return resolveContentType(normalized);
};

const resolveFileName = (name: string): Effect.Effect<string, BadRequest> => {
	const segments = name
		.replace(/[\\/]+$/, "")
		.split(/[\\/]/)
		.filter(Boolean);
	const fileName = segments[segments.length - 1];
	if (!fileName) {
		return Effect.fail(badRequest("Upload file name must not be empty"));
	}
	return Effect.succeed(fileName);
};

export class UploadsService extends Effect.Service<UploadsService>()("UploadsService", {
	effect: Effect.gen(function* () {
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const s3Service = yield* S3Service;
		const fs = yield* FileSystem.FileSystem;

		const createPresignedUpload = Effect.fn("UploadsService.createPresignedUpload")(function* (
			_user: CurrentUserValue,
			contentType: string,
		) {
			const resolvedType = yield* resolveContentType(contentType);
			const extension = resolveExtension(resolvedType);
			const key = `uploads/${generateId()}.${extension}`;

			if (!s3Service.isConfigured) {
				return yield* Effect.die("S3 uploads are not configured for app-backend");
			}

			const uploadUrl = yield* s3Service.presignUpload(
				key,
				resolvedType,
				UPLOAD_URL_EXPIRY_SECONDS,
			);
			return { key, uploadUrl };
		});

		const createPresignedDownload = Effect.fn("UploadsService.createPresignedDownload")(function* (
			user: CurrentUserValue,
			keys: readonly string[],
		) {
			if (!s3Service.isConfigured) {
				return yield* Effect.die("S3 uploads are not configured for app-backend");
			}

			const results = yield* Effect.forEach(keys, (key) =>
				Effect.gen(function* () {
					const downloadUrl = yield* s3Service.presignDownload(key, UPLOAD_URL_EXPIRY_SECONDS);
					return { key, downloadUrl };
				}),
			);
			return results;
		});

		const uploadTemporary = Effect.fn("UploadsService.uploadTemporary")(function* (
			user: CurrentUserValue,
			files: ReadonlyArray<Multipart.PersistedFile>,
		) {
			if (files.length === 0) {
				return yield* badRequest("At least one upload file is required");
			}

			const tempDir = config.tmpDir;
			const resolvedFiles = yield* Effect.forEach(files, (file) =>
				Effect.gen(function* () {
					const fileName = yield* resolveFileName(file.name);
					yield* resolveTemporaryUploadContentType(file.contentType, fileName);

					const info = yield* fs.stat(file.path).pipe(Effect.orDie);
					if (Number(info.size) > TEMPORARY_UPLOAD_MAX_FILE_BYTES) {
						return yield* badRequest(
							`Upload file exceeds maximum allowed size of ${TEMPORARY_UPLOAD_MAX_FILE_BYTES} bytes (file is ${info.size} bytes)`,
						);
					}

					const id = generateId();
					const destPath = `${tempDir.replace(/[\\/]+$/, "")}/${id}-${fileName}`;

					const bytes = yield* fs.readFile(file.path).pipe(Effect.orDie);
					yield* fs.writeFile(destPath, bytes).pipe(Effect.orDie);

					return { id, destPath };
				}),
			);

			const tokens = yield* Effect.forEach(resolvedFiles, ({ id, destPath }) =>
				Effect.gen(function* () {
					const encoded = yield* Schema.encode(Schema.parseJson(UploadTokenValue))({
						userId: user.id,
						resolvedPath: destPath,
					}).pipe(Effect.orDie);
					const key = redisKeys.uploadToken(id);
					yield* redis.set(key, encoded, UPLOAD_TOKEN_TTL_SECONDS);
					return id;
				}),
			);

			return tokens;
		});

		const claimUploadToken = Effect.fn("UploadsService.claimUploadToken")(function* (
			token: string,
			userId: UserId,
		) {
			const raw = yield* redis.getdel(redisKeys.uploadToken(token));
			if (!raw) {
				return yield* badRequest("Upload token is invalid or has expired");
			}
			const value = yield* Schema.decode(Schema.parseJson(UploadTokenValue))(raw).pipe(
				Effect.mapError(() => badRequest("Upload token is invalid or has expired")),
			);
			if (value.userId !== userId) {
				return yield* badRequest("Upload token does not belong to this user");
			}
			return { resolvedPath: value.resolvedPath };
		});

		return { uploadTemporary, claimUploadToken, createPresignedUpload, createPresignedDownload };
	}),
}) {}
