import type { RouteConfig } from "@hono/zod-openapi";

import { unauthenticatedResponse } from "~/lib/openapi";

import { requireAuth } from "./middleware";

export const createAuthRoute = <TRoute extends RouteConfig>(route: TRoute) => ({
	...route,
	middleware: [requireAuth],
	security: [{ "X-Api-Key": [] }],
	responses: { 401: unauthenticatedResponse(), ...route.responses },
});
