import { z } from "@hono/zod-openapi";

import { nonEmptyStringSchema } from "~/lib/zod";

import { createEventBulkBody } from "./schemas";

export const createEventsJobName = "create-events";

export const createEventsJobData = z.object({
	body: createEventBulkBody,
	userId: nonEmptyStringSchema,
});

export type CreateEventsJobData = z.infer<typeof createEventsJobData>;
