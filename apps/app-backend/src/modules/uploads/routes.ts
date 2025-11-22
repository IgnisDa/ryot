import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
import {
	commonErrors,
	createAuthRoute,
	createErrorResponse,
	createValidationErrorResult,
	jsonResponse,
	payloadErrorResponse,
	resolveValidationResult,
	successResponse,
} from "~/lib/openapi";
import {
	getPresignedUploadUrlBody,
	getPresignedUploadUrlQuery,
	getPresignedUploadUrlResponseSchema,
} from "./schemas";
import {
	createPresignedDownload,
	createPresignedUpload,
	resolvePresignedUploadInput,
} from "./service";

const getPresignedUploadUrlRoute = createAuthRoute(
	createRoute({
		method: "post",
		tags: ["uploads"],
		path: "/presigned",
		summary: "Get a presigned upload URL for a file",
		request: {
			body: {
				content: { "application/json": { schema: getPresignedUploadUrlBody } },
			},
		},
		responses: {
			400: payloadErrorResponse(),
			200: jsonResponse(
				"Presigned upload URL for a file",
				getPresignedUploadUrlResponseSchema,
			),
			500: createErrorResponse(
				"Presigned upload URL generation failed",
				commonErrors.internalError,
			),
		},
	}),
);

const getPresignedDownloadUrlRoute = createAuthRoute(
	createRoute({
		method: "get",
		tags: ["uploads"],
		path: "/presigned",
		summary: "Get a presigned URL for an uploaded file",
		request: { query: getPresignedUploadUrlQuery },
		responses: {
			400: payloadErrorResponse(),
			200: jsonResponse(
				"Presigned URL for an uploaded file",
				getPresignedUploadUrlResponseSchema,
			),
			500: createErrorResponse(
				"Presigned URL generation failed",
				commonErrors.internalError,
			),
		},
	}),
);

export const uploadsApi = new OpenAPIHono<{ Variables: AuthType }>()
	.openapi(getPresignedUploadUrlRoute, async (c) => {
		const body = c.req.valid("json");
		const uploadInput = resolveValidationResult(
			() => resolvePresignedUploadInput(body),
			"Could not create presigned upload URL",
		);

		if ("error" in uploadInput)
			return c.json(createValidationErrorResult(uploadInput.error).body, 400);

		return c.json(
			successResponse(await createPresignedUpload(uploadInput.data)),
			200,
		);
	})
	.openapi(getPresignedDownloadUrlRoute, async (c) => {
		const query = c.req.valid("query");
		return c.json(successResponse(await createPresignedDownload(query)), 200);
	});
