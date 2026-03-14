import { resolveRequiredString } from "@ryot/ts-utils";
import { generateId } from "better-auth";
import { s3, s3BucketName } from "~/lib/s3";
import { type UploadContentType, uploadContentTypeExtensions } from "./shared";

const uploadUrlExpirySeconds = 15 * 60;

type ResolvedPresignedUploadInput = {
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
	contentType: string;
}): ResolvedPresignedUploadInput => {
	return {
		contentType: resolveContentType(input.contentType),
	};
};

const resolveExtension = (contentType: UploadContentType) =>
	uploadContentTypeExtensions[contentType][0];

const signUploadUrl = async (input: SignUploadUrlInput) => {
	if (!s3 || !s3BucketName)
		throw new Error("S3 uploads are not configured for app-backend");

	return s3.file(input.key).presign({
		method: "PUT",
		type: input.contentType,
		expiresIn: uploadUrlExpirySeconds,
	});
};

export const createPresignedUpload = async (
	input: { contentType: string },
	deps: CreatePresignedUploadDeps = {},
) => {
	const resolvedInput = resolvePresignedUploadInput(input);
	const generateObjectId = deps.generateObjectId ?? generateId;
	const signUploadUrlFn = deps.signUploadUrl ?? signUploadUrl;
	const extension = resolveExtension(resolvedInput.contentType);
	const key = `uploads/${generateObjectId()}.${extension}`;
	const uploadUrl = await signUploadUrlFn({
		key,
		contentType: resolvedInput.contentType,
	});

	return { key, uploadUrl };
};
