import { z } from "@hono/zod-openapi";

import { nonEmptyStringSchema } from "~/lib/zod";

export const importRunJobName = "import-run";

export const importRunJobData = z.object({
	runId: nonEmptyStringSchema,
	userId: nonEmptyStringSchema,
	filePath: nonEmptyStringSchema,
});

export type ImportRunJobData = z.infer<typeof importRunJobData>;
