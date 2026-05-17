import { resolveRequiredString } from "@ryot/ts-utils/slug";
import { generateId } from "better-auth";

import { type ServiceResult, serviceData, serviceError, wrapServiceValidator } from "~/lib/result";
import { s3, s3BucketName } from "~/lib/s3";

import type { GetPresignedDownloadUrlBody, GetPresignedUploadUrlBody } from "./schemas";
import { type UploadContentType, uploadContentTypeExtensions } from "./shared";

const uploadUrlExpirySeconds = 15 * 60;

type ResolvedPresignedUploadInput = {
	contentType: UploadContentType;
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

const resolveContentType = (contentType: string) => {
	const normalizedContentType = resolveRequiredString(
		contentType,
		"Upload content type",
	).toLowerCase();

	if (!(normalizedContentType in uploadContentTypeExtensions)) {
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
