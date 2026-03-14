import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { AuthType } from "~/lib/auth";
import { createAuthRoute, jsonResponse } from "~/lib/openapi";
import { getPresignedUploadUrlResponseSchema } from "./schemas";

const getPresignedUploadUrlRoute = createAuthRoute(
	createRoute({
		method: "post",
		tags: ["uploads"],
		path: "/images/presigned",
		summary: "Get a presigned upload URL for an image",
		responses: {
			200: jsonResponse(
				"Presigned upload URL for an image",
				getPresignedUploadUrlResponseSchema,
			),
		},
	}),
);

export const uploadsApi = new OpenAPIHono<{ Variables: AuthType }>().openapi(
	getPresignedUploadUrlRoute,
	async (c) => {
		throw new Error("Not implemented");
	},
);
