import { z } from "@hono/zod-openapi";
import { dataSchema } from "~/lib/openapi";
import { nonEmptyTrimmedStringSchema } from "~/lib/zod/base";
import { uploadContentTypes } from "./shared";

export const getPresignedUploadUrlBody = z.object({
	contentType: z.enum(uploadContentTypes),
});

export const presignedUploadUrlSchema = z.object({
	uploadUrl: z.url(),
	key: nonEmptyTrimmedStringSchema,
});

export const getPresignedUploadUrlResponseSchema = dataSchema(
	presignedUploadUrlSchema,
);
