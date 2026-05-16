import { createRoute, OpenAPIHono } from "@hono/zod-openapi";

import { createAuthRoute, type AuthType } from "~/lib/auth";
import {
	commonErrors,
	createSuccessResult,
	createInternalErrorResult,
	createValidationErrorResult,
	createErrorResponse,
	createStandardResponses,
	jsonBody,
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
				const response = createValidationErrorResult(result.message);
				return c.json(response.body, response.status);
			}
			const response = createInternalErrorResult(result.message);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(getPresignedDownloadUrlRoute, async (c) => {
		const body = c.req.valid("json");
		const result = await createPresignedDownloads(body);
		if ("error" in result) {
			if (result.error === "validation") {
				const response = createValidationErrorResult(result.message);
				return c.json(response.body, response.status);
			}
			const response = createInternalErrorResult(result.message);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	});
