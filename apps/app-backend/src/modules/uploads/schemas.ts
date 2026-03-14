import { z } from "@hono/zod-openapi";
import { dataSchema } from "~/lib/openapi";
import { nonEmptyTrimmedStringSchema } from "~/lib/zod/base";

export const getPresignedUploadUrlBody = z.object({
	contentType: z.string(),
});

export const getPresignedUploadUrlQuery = z.object({
	key: nonEmptyTrimmedStringSchema,
});

export const presignedUploadUrlSchema = z.object({
	uploadUrl: z.url(),
	key: nonEmptyTrimmedStringSchema,
});

export const getPresignedUploadUrlResponseSchema = dataSchema(
	presignedUploadUrlSchema,
);

export type GetPresignedUploadUrlBody = z.infer<
	typeof getPresignedUploadUrlBody
>;
export type GetPresignedUploadUrlQuery = z.infer<
	typeof getPresignedUploadUrlQuery
>;
