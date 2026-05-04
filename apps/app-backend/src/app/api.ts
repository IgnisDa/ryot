import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { HTTPException } from "hono/http-exception";

import { auth, type MaybeAuthType } from "~/lib/auth";
import { ERROR_CODES, errorResponse } from "~/lib/openapi";
import { authenticationApi } from "~/modules/authentication/routes";
import { collectionsApi } from "~/modules/collections/routes";
import { entitiesApi } from "~/modules/entities/routes";
import { entitySchemasApi } from "~/modules/entity-schemas/routes";
import { eventSchemasApi } from "~/modules/event-schemas/routes";
import { eventsApi } from "~/modules/events/routes";
import { mediaApi } from "~/modules/media/routes";
import { queryEngineApi } from "~/modules/query-engine/routes";
import { sandboxApi } from "~/modules/sandbox/routes";
import { savedViewsApi } from "~/modules/saved-views/routes";
import { systemApi } from "~/modules/system/routes";
import { trackersApi } from "~/modules/trackers/routes";
import { uploadsApi } from "~/modules/uploads/routes";

import { registerInternalAppRequestHandler } from "./internal-request";

const openApiTags = [
	{
		name: "system",
		description: "Health checks, system monitoring, and application configuration",
	},
	{
		name: "authentication",
		description: "User registration and authentication",
	},
	{
		name: "sandbox",
		description: "Execute sandboxed JavaScript code for custom computations",
	},
	{
		name: "media",
		description: "Convenience endpoints for the built-in media tracker",
	},
	{
		name: "trackers",
		description:
			"Custom tracking categories for organizing entities (e.g., Books, Games, Workouts)",
	},
	{
		name: "entity-schemas",
		description: "Define the structure and properties of entities within a tracker",
	},
	{
		name: "entities",
		description: "Items being tracked within a tracker (e.g., specific books, games, workouts)",
	},
	{
		name: "event-schemas",
		description: "Define the structure of events that can occur for an entity",
	},
	{
		name: "events",
		description:
			"Occurrences or activities logged for an entity (e.g., read a chapter, completed a workout)",
	},
	{
		name: "uploads",
		description: "Presigned URLs for file uploads and downloads",
	},
	{
		name: "saved-views",
		description: "Saved query configurations for quick access to entity views",
	},
	{
		name: "collections",
		description: "User-defined collections of entities with custom membership metadata",
	},
	{
		name: "query-engine",
		description: "Execute dynamic queries",
	},
];

const createOpenApiDocumentConfig = (origin: string) => ({
	openapi: "3.0.0",
	tags: openApiTags,
	servers: [{ url: `${origin}/api` }],
	externalDocs: { url: "https://ryot.io", description: "Main Website" },
	info: {
		version: "1.0.0",
		title: "Ryot App Backend API",
		license: { name: "Terms", url: "https://ryot.io/terms" },
		description:
			"OpenAPI specification for app-owned backend routes. Requests are limited to 60 per minute.",
	},
});

const baseApp = new OpenAPIHono<{ Variables: MaybeAuthType }>()
	.onError((error, c) => {
		if (error instanceof HTTPException) {
			return c.json(errorResponse(ERROR_CODES.INTERNAL_ERROR, error.message), error.status);
		}

		if (error instanceof Error) {
			return c.json(errorResponse(ERROR_CODES.INTERNAL_ERROR, error.message), 500);
		}

		return c.json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "An unexpected error occurred"), 500);
	})
	.route("/system", systemApi)
	.route("/authentication", authenticationApi)
	.route("/sandbox", sandboxApi)
	.route("/media", mediaApi)
	.route("/trackers", trackersApi)
	.route("/entity-schemas", entitySchemasApi)
	.route("/entities", entitiesApi)
	.route("/event-schemas", eventSchemasApi)
	.route("/events", eventsApi)
	.route("/uploads", uploadsApi)
	.route("/saved-views", savedViewsApi)
	.route("/collections", collectionsApi)
	.route("/query-engine", queryEngineApi);

registerInternalAppRequestHandler((request) => baseApp.fetch(request));

export const getAppBackendOpenApiDocument = (origin: string) =>
	baseApp.getOpenAPIDocument(createOpenApiDocumentConfig(origin));

export const apiApp = baseApp
	.doc("/openapi.json", (c) => createOpenApiDocumentConfig(new URL(c.req.url).origin))
	.get("/docs", Scalar({ url: "/api/openapi.json" }))
	.on(["POST", "GET"], "/auth/*", (c) => auth.handler(c.req.raw));

baseApp.openAPIRegistry.registerComponent("securitySchemes", "X-Api-Key", {
	in: "header",
	type: "apiKey",
	name: "X-Api-Key",
});

export type AppType = typeof baseApp;
