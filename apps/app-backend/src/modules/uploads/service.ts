import { resolveRequiredString } from "@ryot/ts-utils/slug";
import { generateId } from "better-auth";

import { getTemporaryDirectory, joinTemporaryDirectoryPath } from "~/lib/bun";
import { type ServiceResult, serviceData, serviceError, wrapServiceValidator } from "~/lib/result";
import { s3, s3BucketName } from "~/lib/s3";

import type { GetPresignedDownloadUrlBody, GetPresignedUploadUrlBody } from "./schemas";
import { type UploadContentType, uploadContentTypeExtensions } from "./shared";

const uploadUrlExpirySeconds = 15 * 60;
const temporaryUploadDirectory = getTemporaryDirectory();

type ResolvedPresignedUploadInput = {
	contentType: UploadContentType;
};

type ResolvedTemporaryUploadFile = {
	file: File;
	fileName: string;
};

type SignUploadUrlInput = {
	key: string;
	contentType: UploadContentType;
};

type UploadServiceError = "validation" | "internal";

export type UploadServiceResult<T> = ServiceResult<T, UploadServiceError>;

type CreatePresignedDownloadDeps = {
	signDownloadUrl?: (key: string) => Promise<UploadServiceResult<string>>;
};

type CreatePresignedUploadDeps = {
	generateObjectId?: () => string;
	signUploadUrl?: (input: SignUploadUrlInput) => Promise<UploadServiceResult<string>>;
};

type CreateTemporaryUploadDeps = {
	temporaryDirectory?: string;
	generateObjectId?: () => string;
	writeFile?: (path: string, file: File) => Promise<unknown>;
};

const resolveContentType = (contentType: string) => {
	const normalizedContentType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";

	if (!normalizedContentType || !(normalizedContentType in uploadContentTypeExtensions)) {
		throw new Error("Upload content type must be a supported MIME type");
	}

	// oxlint-disable-next-line no-unsafe-type-assertion
	return normalizedContentType as UploadContentType;
};

export const resolvePresignedUploadInput = (
	input: GetPresignedUploadUrlBody,
): ResolvedPresignedUploadInput => {
	return { contentType: resolveContentType(input.contentType) };
};

const resolveExtension = (contentType: UploadContentType) =>
	uploadContentTypeExtensions[contentType][0];

const resolveTemporaryUploadFile = (file: File): ResolvedTemporaryUploadFile => {
	const name = resolveRequiredString(file.name, "Upload file name");
	const fileNameSegments = name
		.replace(/[\\/]+$/, "")
		.split(/[\\/]/)
		.filter(Boolean);
	const fileName = fileNameSegments[fileNameSegments.length - 1];
	if (!fileName) {
		throw new Error("Upload file name must not be empty");
	}
	return { file, fileName };
};

const resolveTemporaryUploadPath = (
	fileName: string,
	generateObjectId: () => string,
	temporaryDirectory: string,
) => joinTemporaryDirectoryPath(temporaryDirectory, `${generateObjectId()}-${fileName}`);

const removeTemporaryUploads = async (paths: readonly string[]) => {
	await Promise.allSettled(paths.map((path) => Bun.file(path).delete()));
};

const signUploadUrl = (input: SignUploadUrlInput): Promise<UploadServiceResult<string>> => {
	if (!s3 || !s3BucketName) {
		return Promise.resolve(
			serviceError("internal", "S3 uploads are not configured for app-backend"),
		);
	}

	return Promise.resolve(
		serviceData(
			s3.file(input.key).presign({
				method: "PUT",
				type: input.contentType,
				expiresIn: uploadUrlExpirySeconds,
			}),
		),
	);
};

const signDownloadUrl = (key: string): Promise<UploadServiceResult<string>> => {
	if (!s3 || !s3BucketName) {
		return Promise.resolve(
			serviceError("internal", "S3 uploads are not configured for app-backend"),
		);
	}

	return Promise.resolve(serviceData(s3.file(key).presign({ expiresIn: uploadUrlExpirySeconds })));
};

export const createPresignedUpload = async (
	input: GetPresignedUploadUrlBody,
	deps: CreatePresignedUploadDeps = {},
): Promise<UploadServiceResult<{ key: string; uploadUrl: string }>> => {
	const resolvedInputResult = wrapServiceValidator(
		() => resolvePresignedUploadInput(input),
		"Could not create presigned upload URL",
	);
	if ("error" in resolvedInputResult) {
		return resolvedInputResult;
	}

	const resolvedInput = resolvedInputResult.data;
	const generateObjectId = deps.generateObjectId ?? generateId;
	const signUploadUrlFn = deps.signUploadUrl ?? signUploadUrl;
	const extension = resolveExtension(resolvedInput.contentType);
	const key = `uploads/${generateObjectId()}.${extension}`;
	const uploadUrlResult = await signUploadUrlFn({
		key,
		contentType: resolvedInput.contentType,
	});
	if ("error" in uploadUrlResult) {
		return uploadUrlResult;
	}

	return serviceData({ key, uploadUrl: uploadUrlResult.data });
};

export const createTemporaryUploads = async (
	input: { files: readonly (File | string)[] },
	deps: CreateTemporaryUploadDeps = {},
): Promise<UploadServiceResult<string[]>> => {
	const resolvedFilesResult = wrapServiceValidator(() => {
		if (input.files.length === 0) {
			throw new Error("At least one upload file is required");
		}

		return input.files.map((file) => {
			if (!(file instanceof File)) {
				throw new Error("Upload file must be a file");
			}

			resolveContentType(file.type);
			return resolveTemporaryUploadFile(file);
		});
	}, "Could not create temporary uploads");
	if ("error" in resolvedFilesResult) {
		return resolvedFilesResult;
	}

	const resolvedFiles = resolvedFilesResult.data;
	const generateObjectId = deps.generateObjectId ?? generateId;
	const temporaryDirectory = deps.temporaryDirectory ?? temporaryUploadDirectory;
	const writeFile = deps.writeFile ?? ((path: string, file: File) => Bun.write(path, file));

	const writeResults = await Promise.allSettled(
		resolvedFiles.map(async ({ file, fileName }) => {
			const path = resolveTemporaryUploadPath(fileName, generateObjectId, temporaryDirectory);
			await writeFile(path, file);
			return path;
		}),
	);

	const failedResult = writeResults.find(
		(result): result is PromiseRejectedResult => result.status === "rejected",
	);
	if (failedResult) {
		const successfulPaths: string[] = [];
		for (const result of writeResults) {
			if (result.status === "fulfilled") {
				successfulPaths.push(result.value);
			}
		}
		await removeTemporaryUploads(successfulPaths);

		return serviceError(
			"internal",
			failedResult.reason instanceof Error
				? failedResult.reason.message
				: "Could not create temporary uploads",
		);
	}

	const paths = writeResults.map((result) => {
		if (result.status !== "fulfilled") {
			throw new Error("Unexpected rejected temporary upload write result");
		}

		return result.value;
	});

	return serviceData(paths);
};

export const createPresignedDownloads = async (
	input: GetPresignedDownloadUrlBody,
	deps: CreatePresignedDownloadDeps = {},
): Promise<UploadServiceResult<Array<{ key: string; downloadUrl: string }>>> => {
	const resolvedKeysResult = wrapServiceValidator(
		() => input.keys.map((key) => resolveRequiredString(key, "Upload key")),
		"Could not create presigned download URLs",
	);
	if ("error" in resolvedKeysResult) {
		return resolvedKeysResult;
	}

	const resolvedKeys = resolvedKeysResult.data;
	const signDownloadUrlFn = deps.signDownloadUrl ?? signDownloadUrl;
	const results = await Promise.all(
		resolvedKeys.map(async (key) => {
			const downloadUrlResult = await signDownloadUrlFn(key);
			if ("error" in downloadUrlResult) {
				return downloadUrlResult;
			}

			return serviceData({ key, downloadUrl: downloadUrlResult.data });
		}),
	);

	const failedResult = results.find((result) => "error" in result);
	if (failedResult && "error" in failedResult) {
		return failedResult;
	}

	// oxlint-disable-next-line no-unsafe-type-assertion
	const successfulResults = results as Array<{ data: { key: string; downloadUrl: string } }>;
	return serviceData(successfulResults.map((result) => result.data));
};
