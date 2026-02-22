import { z } from "@hono/zod-openapi";

import { dataSchema } from "~/lib/openapi";
import { nonEmptyTrimmedStringSchema } from "~/lib/zod";

export const getPresignedUploadUrlBody = z.object({
	contentType: z.string(),
});

export const getPresignedUploadUrlQuery = z.object({
	key: nonEmptyTrimmedStringSchema,
});

export const getPresignedDownloadUrlBody = z.object({
	keys: z.array(nonEmptyTrimmedStringSchema).min(1),
});

export const presignedDownloadUrlSchema = z.object({
	downloadUrl: z.url(),
	key: nonEmptyTrimmedStringSchema,
});

export const getPresignedDownloadUrlResponseSchema = dataSchema(
	z.array(presignedDownloadUrlSchema),
);

export const presignedUploadUrlSchema = z.object({
	uploadUrl: z.url(),
	key: nonEmptyTrimmedStringSchema,
});

export const getPresignedUploadUrlResponseSchema = dataSchema(presignedUploadUrlSchema);

export type GetPresignedUploadUrlBody = z.infer<typeof getPresignedUploadUrlBody>;
export type GetPresignedDownloadUrlBody = z.infer<typeof getPresignedDownloadUrlBody>;
