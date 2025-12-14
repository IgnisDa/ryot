import type { Multipart } from "@effect/platform";
import { FileSystem } from "@effect/platform";
import { generateId } from "better-auth";
import { Effect, Schema } from "effect";

import type { CurrentUserValue } from "../../lib/auth";
import { type BadRequest, badRequest } from "../../lib/errors";
import { RedisService, redisKeys } from "../../lib/redis";
import { S3Service } from "../../lib/s3";
import { type UploadContentType, uploadContentTypeExtensions, uploadContentTypes } from "./shared";

const UPLOAD_TOKEN_TTL_SECONDS = 15 * 60;
const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60;
const TEMPORARY_UPLOAD_MAX_FILE_BYTES = 50 * 1024 * 1024;

const UploadTokenValue = Schema.Struct({
	userId: Schema.String,
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

const getTemporaryDirectory = () => {
	const candidates = [Bun.env.TMPDIR, Bun.env.TMP, Bun.env.TEMP];
	const dir = candidates.find((v) => v && v.length > 0);
	return dir ?? "/tmp";
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

type UploadsServiceShape = {
	readonly createPresignedUpload: (
		user: CurrentUserValue,
		contentType: string,
	) => Effect.Effect<{ key: string; uploadUrl: string }, BadRequest>;
	readonly createPresignedDownload: (
		user: CurrentUserValue,
		keys: readonly string[],
	) => Effect.Effect<Array<{ key: string; downloadUrl: string }>, BadRequest>;
	readonly uploadTemporary: (
		user: CurrentUserValue,
		files: ReadonlyArray<Multipart.PersistedFile>,
	) => Effect.Effect<readonly string[], BadRequest>;
};

export class UploadsService extends Effect.Service<UploadsService>()("UploadsService", {
	effect: Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const redis = yield* RedisService;
		const s3Service = yield* S3Service;

		const createPresignedUpload = (
			_user: CurrentUserValue,
			contentType: string,
		): Effect.Effect<{ key: string; uploadUrl: string }, BadRequest> =>
			Effect.gen(function* () {
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

		const createPresignedDownload = (
			user: CurrentUserValue,
			keys: readonly string[],
		): Effect.Effect<Array<{ key: string; downloadUrl: string }>, BadRequest> =>
			Effect.gen(function* () {
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

		const uploadTemporary = (
			user: CurrentUserValue,
			files: ReadonlyArray<Multipart.PersistedFile>,
		): Effect.Effect<readonly string[], BadRequest> =>
			Effect.gen(function* () {
				if (files.length === 0) {
					return yield* badRequest("At least one upload file is required");
				}

				const tempDir = getTemporaryDirectory();
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

		return {
			uploadTemporary,
			createPresignedUpload,
			createPresignedDownload,
		} satisfies UploadsServiceShape;
	}),
}) {}
