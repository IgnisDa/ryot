import { dayjs } from "@ryot/ts-utils";
import { type Job, Worker } from "bullmq";
import { sql } from "drizzle-orm";
import { db } from "~/lib/db";
import { entity } from "~/lib/db/schema";
import { getRedisConnection } from "~/lib/queue/connection";
import { onWorkerError } from "~/lib/queue/utils";
import { getBuiltinEntitySchemaBySlug } from "~/modules/entity-schemas/repository";
import { exerciseSeedJobName } from "./jobs";

const IMAGES_PREFIX_URL =
	"https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises";

const GITHUB_EXERCISES_URL =
	"https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json";

const categoryToLot = (category: string): string | null => {
	const lower = category.toLowerCase();
	if (lower === "cardio") {
		return "distance_and_duration";
	}
	if (lower === "stretching" || lower === "plyometrics") {
		return "duration";
	}
	if (
		lower === "strongman" ||
		lower === "olympic weightlifting" ||
		lower === "strength" ||
		lower === "powerlifting"
	) {
		return "reps_and_weight";
	}
	return null;
};

const normalizeSlugValue = (value: string | null | undefined) => {
	if (!value) {
		return null;
	}
	return value.toLowerCase().replace(/\s+/g, "_");
};

const normalizeMuscleArray = (arr: unknown): string[] =>
	Array.isArray(arr)
		? (arr as string[]).flatMap((m) => {
				const n = normalizeSlugValue(m);
				return n ? [n] : [];
			})
		: [];

const processExerciseSeedJob = async () => {
	const exerciseSchema = await getBuiltinEntitySchemaBySlug("exercise");
	if (!exerciseSchema) {
		throw new Error("Exercise entity schema not found");
	}

	const response = await fetch(GITHUB_EXERCISES_URL);
	if (!response.ok) {
		throw new Error(`Failed to fetch exercises: ${response.statusText}`);
	}

	const exercises = (await response.json()) as Array<Record<string, unknown>>;
	const now = dayjs().toDate();
	let seeded = 0;
	let skipped = 0;

	for (const ex of exercises) {
		const category = ex.category as string | undefined;
		const lot = category ? categoryToLot(category) : null;
		if (!lot) {
			console.warn(
				`Skipping exercise with unrecognized category: ${category} (name: ${ex.name})`,
			);
			skipped++;
			continue;
		}

		const rawImages = Array.isArray(ex.images) ? (ex.images as string[]) : [];
		const images = rawImages.map((path) => ({
			kind: "remote" as const,
			url: `${IMAGES_PREFIX_URL}/${path}`,
		}));

		const primaryMuscles = normalizeMuscleArray(ex.primaryMuscles);
		const secondaryMuscles = normalizeMuscleArray(ex.secondaryMuscles);
		const muscles = Array.from(
			new Set([...primaryMuscles, ...secondaryMuscles]),
		);

		const properties = {
			lot,
			images,
			muscles,
			source: "github",
			force: normalizeSlugValue(ex.force as string | null | undefined),
			level: normalizeSlugValue(ex.level as string | null | undefined),
			instructions: Array.isArray(ex.instructions) ? ex.instructions : [],
			mechanic: normalizeSlugValue(ex.mechanic as string | null | undefined),
			equipment: normalizeSlugValue(ex.equipment as string | null | undefined),
		};

		const values = {
			userId: null,
			properties,
			populatedAt: now,
			sandboxScriptId: null,
			name: ex.name as string,
			image: images[0] ?? null,
			externalId: ex.name as string,
			entitySchemaId: exerciseSchema.id,
		};

		await db
			.insert(entity)
			.values(values)
			.onConflictDoUpdate({
				target: [entity.externalId, entity.entitySchemaId],
				targetWhere: sql`${entity.userId} IS NULL AND ${entity.sandboxScriptId} IS NULL`,
				set: {
					name: values.name,
					image: values.image,
					populatedAt: values.populatedAt,
					properties: sql`excluded.properties`,
				},
			});

		seeded++;
	}

	console.info(
		`Exercise seed complete: ${seeded} upserted, ${skipped} skipped`,
	);
};

const processFitnessJob = async (job: Job) => {
	if (job.name === exerciseSeedJobName) {
		return processExerciseSeedJob();
	}
	throw new Error(`Unsupported fitness job: ${job.name}`);
};

export const createFitnessWorker = () => {
	const worker = new Worker("fitness", processFitnessJob, {
		connection: getRedisConnection(),
	});
	worker.on("error", onWorkerError("fitness"));
	return worker;
};
