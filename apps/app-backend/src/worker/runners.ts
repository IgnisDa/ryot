import type { Task } from "graphile-worker";
import { DEMO_JOB, demoJobPayloadSchema } from "./tasks";

const processDemoJob: Task = async (payload, helpers) => {
	const parsed = demoJobPayloadSchema.safeParse(payload);
	if (!parsed.success) {
		helpers.logger.error("Demo job payload is invalid", {
			errors: parsed.error.issues,
		});
		throw new Error("Demo job payload is invalid");
	}

	helpers.logger.info("Demo job started", { payload: parsed.data });
	await new Promise((resolve) => setTimeout(resolve, 2000));
	helpers.logger.info("Demo job completed", { payload: parsed.data });
};

export const taskList = {
	[DEMO_JOB]: processDemoJob,
};
