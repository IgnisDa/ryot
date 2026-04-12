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
	getPresignedDownloadUrlBody,
	getPresignedDownloadUrlResponseSchema,
	getPresignedUploadUrlBody,
	getPresignedUploadUrlResponseSchema,
} from "./schemas";
import {
	createPresignedDownloads,
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
		const body = c.req.valid("json");
		return c.json(successResponse(await createPresignedDownloads(body)), 200);
	});
