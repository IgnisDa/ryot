import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { isAPIError } from "better-auth/api";
import { auth, type MaybeAuthType } from "~/lib/auth";
import { db } from "~/lib/db";
import {
	createAuthRoute,
	createValidationErrorResult,
	jsonResponse,
	payloadErrorResponse,
	resolveValidationData,
	successResponse,
} from "~/lib/openapi";
import { createLibraryEntityForUser } from "~/modules/collections";
import {
	createTrackerEntitySchemas,
	listBuiltinEntitySchemas,
} from "../entity-schemas/repository";
import { createSavedViewsForUser } from "../saved-views/repository";
import { createBuiltinTrackersForUser } from "../trackers/repository";
import {
	authenticationBuiltinEntitySchemas,
	authenticationBuiltinSavedViews,
	authenticationBuiltinTrackers,
} from "./bootstrap/manifests";
import { meResponseSchema, signUpBody, signUpResponseSchema } from "./schemas";
import {
	buildAuthenticationSavedViewInputs,
	buildAuthenticationTrackerEntitySchemaLinks,
	buildAuthenticationTrackerInputs,
	buildLibraryEntityInput,
	resolveAuthenticationName,
} from "./service";

const meRoute = createAuthRoute(
	createRoute({
		path: "/me",
		method: "get",
		tags: ["authentication"],
		summary: "Get the current authenticated user and session",
		responses: {
			200: jsonResponse("Authenticated session details", meResponseSchema),
		},
	}),
);

const signUpRoute = createRoute({
	path: "/email",
	method: "post",
	tags: ["authentication"],
	summary: "Create a user account and initialize default data",
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

		const nameResult = resolveValidationData(
			() => resolveAuthenticationName(body.name),
			"Signup name is invalid",
		);
		if ("status" in nameResult) {
			return c.json(nameResult.body, nameResult.status);
		}

		try {
			const signUpResult = await auth.api.signUpEmail({
				body: {
					email: body.email,
					name: nameResult.data,
					password: body.password,
				},
			});

			await db.transaction(async (tx) => {
				const createdTrackers = await createBuiltinTrackersForUser({
					database: tx,
					userId: signUpResult.user.id,
					trackers: buildAuthenticationTrackerInputs({
						trackers: authenticationBuiltinTrackers(),
					}),
				});

				const builtinEntitySchemaRows = await listBuiltinEntitySchemas({
					database: tx,
				});

				await createTrackerEntitySchemas({
					database: tx,
					links: buildAuthenticationTrackerEntitySchemaLinks({
						trackers: createdTrackers,
						entitySchemas: builtinEntitySchemaRows,
						schemaLinks: authenticationBuiltinEntitySchemas()
							.filter(
								(schema): schema is typeof schema & { trackerSlug: string } =>
									typeof (schema as { trackerSlug?: string }).trackerSlug ===
									"string",
							)
							.map((schema) => ({
								slug: schema.slug,
								trackerSlug: schema.trackerSlug,
							})),
					}),
				});

				await createSavedViewsForUser({
					database: tx,
					userId: signUpResult.user.id,
					views: buildAuthenticationSavedViewInputs({
						trackers: createdTrackers,
						entitySchemas: builtinEntitySchemaRows,
						savedViews: authenticationBuiltinSavedViews(),
					}),
				});

				const libraryEntityInput = buildLibraryEntityInput({
					entitySchemas: builtinEntitySchemaRows,
				});
				await createLibraryEntityForUser(
					{ userId: signUpResult.user.id, ...libraryEntityInput },
					tx,
				);
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
