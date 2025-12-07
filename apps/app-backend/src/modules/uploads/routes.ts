import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
import {
	commonErrors,
	createAuthRoute,
	createErrorResponse,
	createStandardResponses,
	jsonBody,
	resolveValidationData,
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
		method: "get",
		tags: ["uploads"],
		path: "/presigned",
		summary: "Get a presigned download URL for an uploaded file",
		request: { query: getPresignedUploadUrlQuery },
		responses: {
			...createStandardResponses({
				successDescription: "Presigned URL for an uploaded file",
				successSchema: getPresignedUploadUrlResponseSchema,
			}),
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
		const uploadInput = resolveValidationData(
			() => resolvePresignedUploadInput(body),
			"Could not create presigned upload URL",
		);

		if ("status" in uploadInput) {
			return c.json(uploadInput.body, uploadInput.status);
		}

		return c.json(
			successResponse(await createPresignedUpload(uploadInput.data)),
			200,
		);
	})
	.openapi(getPresignedDownloadUrlRoute, async (c) => {
		const query = c.req.valid("query");
		return c.json(successResponse(await createPresignedDownload(query)), 200);
	});
