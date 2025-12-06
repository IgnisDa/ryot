import { z } from "@hono/zod-openapi";

import { nonEmptyStringSchema } from "~/lib/zod";

export const integrationRunJobName = "integration-run";

export const integrationRunJobData = z.object({
	runId: z.string().optional(),
	userId: nonEmptyStringSchema,
	rawBody: z.string().optional(),
	contentType: z.string().optional(),
	integrationId: nonEmptyStringSchema,
});

export type IntegrationRunJobData = z.infer<typeof integrationRunJobData>;
