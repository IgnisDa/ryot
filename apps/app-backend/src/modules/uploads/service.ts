import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { resolveRequiredString } from "@ryot/ts-utils";
import { generateId } from "better-auth";
import { s3, s3BucketName } from "~/lib/s3";
import { type UploadContentType, uploadContentTypeExtensions } from "./shared";

const uploadUrlExpirySeconds = 15 * 60;

type ResolvedPresignedUploadInput = {
	fileName?: string;
	contentType: UploadContentType;
};

type SignUploadUrlInput = {
	key: string;
	contentType: UploadContentType;
};

type CreatePresignedUploadDeps = {
	generateObjectId?: () => string;
	signUploadUrl?: (input: SignUploadUrlInput) => Promise<string>;
};

const getExtensionFromFileName = (fileName?: string) => {
	if (!fileName) return null;

	const trimmedFileName = fileName.trim();
	if (!trimmedFileName) return null;

	const parts = trimmedFileName.split(".");
	if (parts.length < 2) return null;

	return parts.at(-1)?.toLowerCase() ?? null;
};

const resolveContentType = (contentType: string) => {
	const normalizedContentType = resolveRequiredString(
		contentType,
		"Upload content type",
	).toLowerCase();

	if (!(normalizedContentType in uploadContentTypeExtensions))
		throw new Error("Upload content type must be a supported MIME type");

	return normalizedContentType as UploadContentType;
};

export const resolvePresignedUploadInput = (input: {
	fileName?: string;
	contentType: string;
}): ResolvedPresignedUploadInput => {
	return {
		fileName: input.fileName?.trim() || undefined,
		contentType: resolveContentType(input.contentType),
	};
};

const resolveExtension = (input: {
	fileName?: string;
	contentType: UploadContentType;
}) => {
	const allowedExtensions = uploadContentTypeExtensions[input.contentType];
	const fileNameExtension = getExtensionFromFileName(input.fileName);

	if (
		fileNameExtension &&
		allowedExtensions.includes(fileNameExtension as never)
	)
		return fileNameExtension;

	return allowedExtensions[0];
};

const signUploadUrl = async (input: SignUploadUrlInput) => {
	if (!s3 || !s3BucketName)
		throw new Error("S3 uploads are not configured for app-backend");

	return getSignedUrl(
		s3,
		new PutObjectCommand({
			Key: input.key,
			Bucket: s3BucketName,
			ContentType: input.contentType,
		}),
		{ expiresIn: uploadUrlExpirySeconds },
	);
};

export const createPresignedUpload = async (
	input: { contentType: string; fileName?: string },
	deps: CreatePresignedUploadDeps = {},
) => {
	const resolvedInput = resolvePresignedUploadInput(input);
	const generateObjectId = deps.generateObjectId ?? generateId;
	const signUploadUrlFn = deps.signUploadUrl ?? signUploadUrl;
	const extension = resolveExtension({
		contentType: resolvedInput.contentType,
		fileName: resolvedInput.fileName,
	});
	const key = `uploads/${generateObjectId()}.${extension}`;
	const uploadUrl = await signUploadUrlFn({
		key,
		contentType: resolvedInput.contentType,
	});

	return { key, uploadUrl };
};
