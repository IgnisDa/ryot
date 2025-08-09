import { createRoute, OpenAPIHono } from "@hono/zod-openapi";

import type { AuthType } from "~/lib/auth";
import {
	commonErrors,
	createAuthRoute,
	createInternalErrorResult,
	createValidationErrorResult,
	createErrorResponse,
	createStandardResponses,
	jsonBody,
	successResponse,
} from "~/lib/openapi";

import {
	getPresignedDownloadUrlBody,
	getPresignedDownloadUrlResponseSchema,
	getPresignedUploadUrlBody,
	getPresignedUploadUrlResponseSchema,
} from "./schemas";
import { createPresignedDownloads, createPresignedUpload } from "./service";

const getPresignedUploadUrlRoute = createAuthRoute(
	createRoute({
		method: "post",
		tags: ["uploads"],
		path: "/presigned",
		summary: "Get a presigned upload URL for a file",
		request: { body: jsonBody(getPresignedUploadUrlBody) },
		responses: {
			...createStandardResponses({
				successSchema: getPresignedUploadUrlResponseSchema,
				successDescription: "Presigned upload URL for a file",
			}),
			500: createErrorResponse(
				"Presigned upload URL generation failed",
				commonErrors.internalError,
			),
		},
	}),
);

const getPresignedDownloadUrlRoute = createAuthRoute(
	createRoute({
		method: "post",
		tags: ["uploads"],
		path: "/presigned/download",
		summary: "Get presigned download URLs for uploaded files",
		request: { body: jsonBody(getPresignedDownloadUrlBody) },
		responses: {
			...createStandardResponses({
				successDescription: "Presigned download URLs for uploaded files",
				successSchema: getPresignedDownloadUrlResponseSchema,
			}),
			500: createErrorResponse("Presigned URL generation failed", commonErrors.internalError),
		},
	}),
);

export const uploadsApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(getPresignedUploadUrlRoute, async (c) => {
		const body = c.req.valid("json");
		const result = await createPresignedUpload(body);
		if ("error" in result) {
			if (result.error === "validation") {
				return c.json(createValidationErrorResult(result.message).body, 400);
			}
			return c.json(createInternalErrorResult(result.message).body, 500);
		}

		return c.json(successResponse(result.data), 200);
	})
	.openapi(getPresignedDownloadUrlRoute, async (c) => {
		const body = c.req.valid("json");
		const result = await createPresignedDownloads(body);
		if ("error" in result) {
			if (result.error === "validation") {
				return c.json(createValidationErrorResult(result.message).body, 400);
			}
			return c.json(createInternalErrorResult(result.message).body, 500);
		}

		return c.json(successResponse(result.data), 200);
	});
