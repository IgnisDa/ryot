import { quickAddJob } from "graphile-worker";
import { z } from "zod";
import { getWorkerPool } from "./connection";

export const DEMO_JOB = "demoJob";

export const demoJobPayloadSchema = z.object({
	message: z.string(),
});

export type DemoJobPayload = z.infer<typeof demoJobPayloadSchema>;

const getValidatedPayload = (taskIdentifier: string, payload: unknown) => {
	switch (taskIdentifier) {
		case DEMO_JOB: {
			const parsed = demoJobPayloadSchema.safeParse(payload);
			if (!parsed.success) {
				throw new Error(
					`Invalid payload for ${DEMO_JOB}: ${parsed.error.message}`,
				);
			}

			return parsed.data;
		}
		default:
			return payload;
	}
};

export const addJob = async (taskIdentifier: string, payload: unknown) => {
	const pool = getWorkerPool();
	const validatedPayload = getValidatedPayload(taskIdentifier, payload);
	const jobOptions =
		taskIdentifier === DEMO_JOB ? { maxAttempts: 1 } : undefined;
	await quickAddJob(
		{ pgPool: pool },
		taskIdentifier,
		validatedPayload,
		jobOptions,
	);
};
