import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "~/lib/db";
import { entity } from "~/lib/db/schema";
import { getQueues } from "~/lib/queue";
import { getBuiltinEntitySchemaBySlug } from "~/modules/entity-schemas/repository";
import { exerciseSeedJobName } from "./jobs";

const expectedBuiltinExerciseSeedCount = 873;

export const shouldDispatchExerciseSeedJob = async () => {
	const exerciseSchema = await getBuiltinEntitySchemaBySlug("exercise");
	if (!exerciseSchema) {
		return false;
	}

	const [result] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(entity)
		.where(
			and(
				eq(entity.entitySchemaId, exerciseSchema.id),
				isNull(entity.userId),
				isNull(entity.sandboxScriptId),
			),
		);

	return (result?.count ?? 0) < expectedBuiltinExerciseSeedCount;
};

export const dispatchExerciseSeedJob = async () => {
	if (!(await shouldDispatchExerciseSeedJob())) {
		return;
	}

	await getQueues().fitnessQueue.add(
		exerciseSeedJobName,
		{},
		{ jobId: "exercise-seed-initial" },
	);
	console.info("Exercise seed job dispatched");
};
