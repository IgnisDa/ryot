import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { AuthType } from "~/auth";
import { errorResponse, successResponse } from "~/lib/response";
import { listEntitySchemasByUser } from "./repository";
import { schemaImportBody, schemaSearchBody } from "./schemas";
import { runSchemaImport, runSchemaSearch } from "./service";

export const entitySchemasApi = new Hono<{ Variables: AuthType }>()
	.get("/list", async (c) => {
		const user = c.get("user");
		const schemas = await listEntitySchemasByUser(user.id);
		return successResponse(c, { schemas });
	})
	.post("/search", zValidator("json", schemaSearchBody), async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const result = await runSchemaSearch({ userId: user.id, body });

		if (!result.success) return errorResponse(c, result.error, result.status);

		return successResponse(c, result.data);
	})
	.post("/import", zValidator("json", schemaImportBody), async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const result = await runSchemaImport({ userId: user.id, body });

		if (!result.success) return errorResponse(c, result.error, result.status);

		return successResponse(c, result.data);
	});
