import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";

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
import { temporaryUploadMaxRequestBytes } from "~/lib/upload";

import {
	getPresignedDownloadUrlBody,
	getPresignedDownloadUrlResponseSchema,
	getPresignedUploadUrlBody,
	getPresignedUploadUrlResponseSchema,
	temporaryUploadBodySchema,
	temporaryUploadResponseSchema,
} from "./schemas";
import { createPresignedDownloads, createPresignedUpload, createTemporaryUploads } from "./service";

const temporaryUploadTooLargeErrorMessage =
	"Temporary upload request exceeds the maximum allowed size";

const createTemporaryUploadTooLargeResponse = (c: Parameters<ReturnType<typeof bodyLimit>>[0]) => {
	const response = createValidationErrorResult(temporaryUploadTooLargeErrorMessage);
	return c.json(response.body, 413, { Connection: "close" });
};

const drainRequestBody = async (request: Request) => {
	const reader = request.body?.getReader();
	if (!reader) {
		return;
	}

	try {
		for (;;) {
			// oxlint-disable-next-line no-await-in-loop
			const { done } = await reader.read();
			if (done) {
				break;
			}
		}
	} catch {
		return;
	} finally {
		reader.releaseLock();
	}
};

const temporaryUploadBodyLimitFallback = bodyLimit({
	maxSize: temporaryUploadMaxRequestBytes,
	onError: async (c) => {
		await c.req.raw.body?.cancel().catch(() => undefined);
		return createTemporaryUploadTooLargeResponse(c);
	},
});

const temporaryUploadBodyLimit = createMiddleware(async (c, next) => {
	const hasTransferEncoding = c.req.raw.headers.has("transfer-encoding");
	const contentLengthHeader = c.req.raw.headers.get("content-length");
	const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : Number.NaN;

	if (
		!hasTransferEncoding &&
		Number.isFinite(contentLength) &&
		contentLength > temporaryUploadMaxRequestBytes
	) {
		await drainRequestBody(c.req.raw);
		return createTemporaryUploadTooLargeResponse(c);
	}

	return temporaryUploadBodyLimitFallback(c, next);
});

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
		// c.req.formData() buffers multipart bodies, so larger multi-file imports should upload
		// each file separately instead of sending one oversized request here.
		middleware: [temporaryUploadBodyLimit],
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
			413: createErrorResponse(
				"Temporary upload exceeds the maximum allowed size",
				commonErrors.validationFailed,
			),
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
		const user = c.get("user");
		const result = await createTemporaryUploads({
			userId: user.id,
			files: formData.getAll("files[]"),
		});
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
