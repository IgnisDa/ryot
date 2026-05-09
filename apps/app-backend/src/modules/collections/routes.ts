import { createRoute, OpenAPIHono } from "@hono/zod-openapi";

import type { AuthType } from "~/lib/auth";
import {
	createAuthRoute,
	createServiceErrorResult,
	createStandardResponses,
	createSuccessResult,
	jsonBody,
} from "~/lib/openapi";

import {
	addToCollectionBody,
	addToCollectionResponseSchema,
	createCollectionBody,
	createCollectionResponseSchema,
	removeFromCollectionBody,
	removeFromCollectionResponseSchema,
} from "./schemas";
import { addToCollection, createCollection, removeFromCollection } from "./service";

const createCollectionRoute = createAuthRoute(
	createRoute({
		path: "",
		method: "post",
		tags: ["collections"],
		summary: "Create a new collection",
		request: { body: jsonBody(createCollectionBody) },
		description:
			"Create a user-owned collection entity under the built-in collection schema. The membershipPropertiesSchema is validated against the AppSchema format before persistence.",
		responses: createStandardResponses({
			successDescription: "Collection was created",
			successSchema: createCollectionResponseSchema,
		}),
	}),
);

const addToCollectionRoute = createAuthRoute(
	createRoute({
		path: "/memberships",
		method: "post",
		tags: ["collections"],
		summary: "Add an entity to a collection",
		request: { body: jsonBody(addToCollectionBody) },
		description:
			"Add an entity to a collection by creating a member-of relationship from the entity to the collection.",
		responses: createStandardResponses({
			successDescription: "Entity was added to collection",
			successSchema: addToCollectionResponseSchema,
			notFoundDescription: "Collection or entity not found",
		}),
	}),
);

const removeFromCollectionRoute = createAuthRoute(
	createRoute({
		path: "/memberships",
		method: "delete",
		tags: ["collections"],
		summary: "Remove an entity from a collection",
		request: { body: jsonBody(removeFromCollectionBody) },
		description:
			"Remove an entity from a collection by deleting the member-of relationship from the entity to the collection.",
		responses: createStandardResponses({
			successDescription: "Entity was removed from collection",
			successSchema: removeFromCollectionResponseSchema,
			notFoundDescription: "Collection, entity, or membership not found",
		}),
	}),
);

export const collectionsApi = new OpenAPIHono<{
	Variables: AuthType;
}>()
	.openapi(createCollectionRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const result = await createCollection({ body, userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(addToCollectionRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const result = await addToCollection({ body, userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	})
	.openapi(removeFromCollectionRoute, async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");

		const result = await removeFromCollection({ body, userId: user.id });
		if ("error" in result) {
			const response = createServiceErrorResult(result);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult(result.data);
		return c.json(response.body, response.status);
	});
