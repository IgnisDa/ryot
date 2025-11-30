import type { RouteConfig } from "@hono/zod-openapi";

import { unauthenticatedResponse } from "~/lib/openapi";

import { adminAccessTokenSecurityScheme, requireAdminAccessToken, requireAuth } from "./middleware";

const resolveRouteMiddleware = (route: RouteConfig) => {
	if (!route.middleware) {
		return [];
	}

	return Array.isArray(route.middleware) ? route.middleware : [route.middleware];
};

export const createAuthRoute = <TRoute extends RouteConfig>(route: TRoute) => ({
	...route,
	middleware: [requireAuth, ...resolveRouteMiddleware(route)],
	security: [{ "X-Api-Key": [] }],
	responses: { 401: unauthenticatedResponse(), ...route.responses },
});

export const createAdminRoute = <TRoute extends RouteConfig>(route: TRoute) => ({
	...route,
	middleware: [requireAdminAccessToken, ...resolveRouteMiddleware(route)],
	security: [{ [adminAccessTokenSecurityScheme]: [] }],
	responses: { 401: unauthenticatedResponse(), ...route.responses },
});
