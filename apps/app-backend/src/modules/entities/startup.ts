import { createHash } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "~/lib/db";
import { entity } from "~/lib/db/schema";
import { getQueues } from "~/lib/queue";
import { getBuiltinEntitySchemaBySlug } from "~/modules/entity-schemas/repository";
import { getBuiltinSandboxScriptBySlug } from "~/modules/sandbox/repository";

import { entityPreloadJobData, entityPreloadJobName } from "./jobs";

const systemEntityImportUserId = "system_entity_import";

const builtinEntityPreloads = [
	{
		pageSize: 100,
		expectedCount: 873,
		entitySchemaSlug: "exercise",
		scriptSlug: "exercise.free-exercise-db",
	},
] as const;

const createPreloadJobId = (input: Record<string, unknown>) => {
	const hash = createHash("sha1").update(JSON.stringify(input)).digest("hex");
	return `entity_preload_${hash}`;
};

const countImportedGlobalEntities = async (input: { scriptId: string; entitySchemaId: string }) => {
	const [result] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(entity)
		.where(
			and(
				isNull(entity.userId),
				eq(entity.sandboxScriptId, input.scriptId),
				eq(entity.entitySchemaId, input.entitySchemaId),
			),
		);

	return result?.count ?? 0;
};

const resolveBuiltinEntityPreload = async (input: {
	scriptSlug: string;
	entitySchemaSlug: string;
}) => {
	const script = await getBuiltinSandboxScriptBySlug(input.scriptSlug);
	const schema = await getBuiltinEntitySchemaBySlug(input.entitySchemaSlug);
	if (!script || !schema) {
		return null;
	}

	return { scriptId: script.id, entitySchemaId: schema.id };
};

export const dispatchBuiltinEntityPreloadJobs = async () => {
	for (const preload of builtinEntityPreloads) {
		// oxlint-disable-next-line no-await-in-loop
		const resolved = await resolveBuiltinEntityPreload(preload);
		if (!resolved) {
			continue;
		}

		// oxlint-disable-next-line no-await-in-loop
		const count = await countImportedGlobalEntities(resolved);
		if (count >= preload.expectedCount) {
			continue;
		}

		const payload = entityPreloadJobData.parse({
			page: 1,
			pageSize: preload.pageSize,
			scriptId: resolved.scriptId,
			userId: systemEntityImportUserId,
			entitySchemaId: resolved.entitySchemaId,
		});

		// oxlint-disable-next-line no-await-in-loop
		await getQueues().entityQueue.add(entityPreloadJobName, payload, {
			jobId: createPreloadJobId({
				page: payload.page,
				pageSize: payload.pageSize,
				scriptId: payload.scriptId,
				entitySchemaId: payload.entitySchemaId,
			}),
		});
		console.info(`Entity preload job dispatched for ${preload.entitySchemaSlug}`);
	}
};
