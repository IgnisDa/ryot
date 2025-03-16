import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { isAPIError } from "better-auth/api";
import { auth, type MaybeAuthType } from "~/lib/auth";
import { db } from "~/lib/db";
import {
	builtinEntitySchemas,
	builtinFacets,
	builtinSavedViews,
} from "~/lib/db/seed/manifests";
import {
	createAuthRoute,
	createValidationErrorResult,
	jsonResponse,
	payloadErrorResponse,
	resolveValidationResult,
	successResponse,
} from "~/lib/openapi";
import {
	createFacetEntitySchemas,
	listBuiltinEntitySchemas,
} from "../entity-schemas/repository";
import { createBuiltinFacetsForUser } from "../facets/repository";
import { createSavedViewsForUser } from "../saved-views/repository";
import { meResponseSchema, signUpBody, signUpResponseSchema } from "./schemas";
import {
	buildAuthenticationFacetEntitySchemaLinks,
	buildAuthenticationFacetInputs,
	buildAuthenticationSavedViewInputs,
	resolveAuthenticationName,
} from "./service";

const meRoute = createAuthRoute(
	createRoute({
		path: "/me",
		method: "get",
		tags: ["authentication"],
		summary: "Get the current user session",
		responses: {
			200: jsonResponse("Authenticated session details", meResponseSchema),
		},
	}),
);

const signUpRoute = createRoute({
	path: "/email",
	method: "post",
	tags: ["authentication"],
	summary: "Create a user account",
	request: {
		body: { content: { "application/json": { schema: signUpBody } } },
	},
	responses: {
		400: payloadErrorResponse(),
		200: jsonResponse("User account was created", signUpResponseSchema),
	},
});

export const authenticationApi = new OpenAPIHono<{ Variables: MaybeAuthType }>()
	.openapi(meRoute, async (c) => {
		const user = c.get("user");
		const session = c.get("session");
		return c.json(successResponse({ user, session }), 200);
	})
	.openapi(signUpRoute, async (c) => {
		const body = c.req.valid("json");

		const nameResult = resolveValidationResult(
			() => resolveAuthenticationName(body.name),
			"Signup name is invalid",
		);
		if ("error" in nameResult)
			return c.json(createValidationErrorResult(nameResult.error).body, 400);

		try {
			const signUpResult = await auth.api.signUpEmail({
				body: {
					email: body.email,
					name: nameResult.data,
					password: body.password,
				},
			});

			await db.transaction(async (tx) => {
				const createdFacets = await createBuiltinFacetsForUser({
					database: tx,
					userId: signUpResult.user.id,
					facets: buildAuthenticationFacetInputs({ facets: builtinFacets() }),
				});

				const builtinEntitySchemaRows = await listBuiltinEntitySchemas({
					database: tx,
				});

				await createFacetEntitySchemas({
					database: tx,
					links: buildAuthenticationFacetEntitySchemaLinks({
						facets: createdFacets,
						entitySchemas: builtinEntitySchemaRows,
						schemaLinks: builtinEntitySchemas().map((schema) => ({
							slug: schema.slug,
							facetSlug: schema.facetSlug,
						})),
					}),
				});

				await createSavedViewsForUser({
					database: tx,
					userId: signUpResult.user.id,
					views: buildAuthenticationSavedViewInputs({
						entitySchemas: builtinEntitySchemaRows,
						savedViews: builtinSavedViews(),
					}),
				});
			});
		} catch (error) {
			if (isAPIError(error)) {
				const message = error.message || "Could not create account";
				return c.json(createValidationErrorResult(message).body, 400);
			}

			throw error;
		}

		return c.json(successResponse({ created: true as const }), 200);
	});
