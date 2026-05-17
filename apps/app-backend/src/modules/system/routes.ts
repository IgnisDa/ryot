import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { extractErrorMessage } from "@ryot/ts-utils/error";
import { sql } from "drizzle-orm";

import { appConfigEnvIndex, config, getMaskedConfig, systemConfigEnvIndex } from "~/lib/config";
import { db } from "~/lib/db";
import {
	commonErrors,
	createErrorResponse,
	createHealthCheckFailedErrorResult,
	createSuccessResult,
	dataSchema,
	jsonResponse,
} from "~/lib/openapi";
import { redis } from "~/lib/redis";

import { getMetricsAsText } from "./service";

const healthResponseSchema = dataSchema(
	z.object({
		status: z.literal("healthy"),
	}),
);

const healthRoute = createRoute({
	method: "get",
	path: "/health",
	tags: ["system"],
	summary: "Check database and Redis health",
	responses: {
		503: createErrorResponse("Database or Redis checks failed", commonErrors.healthCheckFailed),
		200: jsonResponse("Database and Redis checks passed", healthResponseSchema),
	},
});

const metricsRoute = createRoute({
	method: "get",
	path: "/metrics",
	tags: ["system"],
	summary: "Export application metrics in Prometheus format",
	responses: {
		200: {
			description: "Prometheus metrics in text format",
			content: { "text/plain": { schema: z.string() } },
		},
	},
});

const configResponseSchema = dataSchema(
	z.object({
		system: z.record(z.string(), z.unknown()),
		providers: z.record(z.string(), z.unknown()),
		auth: z.object({
			oidcEnabled: z.boolean(),
			signupAllowed: z.boolean(),
			localAuthDisabled: z.boolean(),
			oidcButtonLabel: z.string().optional(),
		}),
	}),
);

const configRoute = createRoute({
	method: "get",
	path: "/config",
	tags: ["system"],
	summary: "Get application configuration with sensitive values masked",
	responses: {
		200: jsonResponse("Masked application configuration", configResponseSchema),
	},
});

export const systemApi = new OpenAPIHono()
	.openapi(healthRoute, async (c) => {
		try {
			await db.execute(sql`SELECT 1`);
		} catch (error) {
			const response = createHealthCheckFailedErrorResult(
				`Database check failed: ${extractErrorMessage(error, "Unknown error")}`,
			);
			return c.json(response.body, response.status);
		}

		try {
			await redis.ping();
		} catch (error) {
			const response = createHealthCheckFailedErrorResult(
				`Redis check failed: ${extractErrorMessage(error, "Unknown error")}`,
			);
			return c.json(response.body, response.status);
		}

		const response = createSuccessResult({ status: "healthy" as const });
		return c.json(response.body, response.status);
	})
	.openapi(metricsRoute, async (c) => {
		const metricsText = await getMetricsAsText();
		return c.text(metricsText, 200, {
			"Content-Type": "text/plain; charset=utf-8",
		});
	})
	.openapi(configRoute, (c) => {
		const masked = getMaskedConfig({
			system: systemConfigEnvIndex,
			providers: appConfigEnvIndex,
		});
		const { oidc } = config.server;
		const response = createSuccessResult({
			// oxlint-disable-next-line no-unsafe-type-assertion
			system: masked.system as Record<string, unknown>,
			// oxlint-disable-next-line no-unsafe-type-assertion
			providers: masked.providers as Record<string, unknown>,
			auth: {
				oidcEnabled: oidc.enabled,
				signupAllowed: config.users.allowRegistration,
				localAuthDisabled: config.users.disableLocalAuth,
				oidcButtonLabel: config.frontend.oidcButtonLabel,
			},
		});
		return c.json(response.body, response.status);
	});
