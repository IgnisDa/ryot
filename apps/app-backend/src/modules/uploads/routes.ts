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
	temporaryUploadBodySchema,
	temporaryUploadResponseSchema,
} from "./schemas";
import { createPresignedDownloads, createPresignedUpload, createTemporaryUploads } from "./service";

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

const temporaryUploadRoute = createAuthRoute(
	createRoute({
		method: "post",
		tags: ["uploads"],
		path: "/temporary",
		summary: "Upload temporary files to disk",
		request: {
			body: { content: { "multipart/form-data": { schema: temporaryUploadBodySchema } } },
		},
		responses: {
			...createStandardResponses({
				successSchema: temporaryUploadResponseSchema,
				successDescription: "Temporary file paths written to disk",
			}),
			500: createErrorResponse("Temporary upload failed", commonErrors.internalError),
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
	})
	.openapi(temporaryUploadRoute, async (c) => {
		const contentType = c.req.header("content-type") ?? "";
		if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
			await c.req.text().catch(() => undefined);
			const response = createValidationErrorResult("Could not parse temporary upload form data");
			return c.json(response.body, response.status);
		}

		let formData: FormData;
		try {
			formData = await c.req.formData();
		} catch {
			const response = createValidationErrorResult("Could not parse temporary upload form data");
			return c.json(response.body, response.status);
		}
		const result = await createTemporaryUploads({ files: formData.getAll("files[]") });
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
