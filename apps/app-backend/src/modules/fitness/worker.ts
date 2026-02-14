import { dayjs } from "@ryot/ts-utils";
import { type Job, Worker } from "bullmq";
import { sql } from "drizzle-orm";
import { parseAppSchemaPropertiesSafe } from "~/lib/app/schema-validation";
import { db } from "~/lib/db";
import { entity } from "~/lib/db/schema";
import { exercisePropertiesJsonSchema } from "~/lib/fitness/exercise";
import { getRedisConnection } from "~/lib/queue/connection";
import { onWorkerError } from "~/lib/queue/utils";
import { getBuiltinEntitySchemaBySlug } from "~/modules/entity-schemas/repository";
import { exerciseSeedJobName } from "./jobs";

const equipmentMap = { "e-z curl bar": "ez_curl_bar" } as const;

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

const normalizeEquipmentValue = (value: string | null | undefined) => {
	if (!value) {
		return null;
	}

	const lower = value.toLowerCase();
	return (
		equipmentMap[lower as keyof typeof equipmentMap] ??
		normalizeSlugValue(value)
	);
};

const normalizeMuscleArray = (arr: unknown): string[] =>
	Array.isArray(arr)
		? (arr as string[]).flatMap((m) => {
				const n = normalizeSlugValue(m);
				return n ? [n] : [];
			})
		: [];

const parseExerciseProperties = (input: Record<string, unknown>) => {
	const result = parseAppSchemaPropertiesSafe({
		properties: input,
		propertiesSchema: exercisePropertiesJsonSchema,
	});
	if (!result.success) {
		return null;
	}

	return result.data;
};

export const buildExerciseSeedEntityValues = (
	exerciseSchemaId: string,
	ex: Record<string, unknown>,
	now: Date,
) => {
	const category = ex.category as string | undefined;
	const lot = category ? categoryToLot(category) : null;
	if (!lot) {
		return {
			status: "skipped" as const,
			reason: `unrecognized category: ${category}`,
		};
	}

	const rawName = ex.name;
	if (typeof rawName !== "string" || rawName.length === 0) {
		return {
			status: "skipped" as const,
			reason: "missing exercise name",
		};
	}

	const rawImages = Array.isArray(ex.images) ? (ex.images as string[]) : [];
	const images = rawImages.map((path) => ({
		kind: "remote" as const,
		url: `${IMAGES_PREFIX_URL}/${path}`,
	}));

	const primaryMuscles = normalizeMuscleArray(ex.primaryMuscles);
	const secondaryMuscles = normalizeMuscleArray(ex.secondaryMuscles);
	const muscles = Array.from(new Set([...primaryMuscles, ...secondaryMuscles]));

	const properties = parseExerciseProperties({
		lot,
		images,
		muscles,
		source: "github",
		force: normalizeSlugValue(ex.force as string | null | undefined),
		level: normalizeSlugValue(ex.level as string | null | undefined),
		instructions: Array.isArray(ex.instructions) ? ex.instructions : [],
		mechanic: normalizeSlugValue(ex.mechanic as string | null | undefined),
		equipment: normalizeEquipmentValue(
			ex.equipment as string | null | undefined,
		),
	});
	if (!properties) {
		return {
			status: "skipped" as const,
			reason: `invalid exercise properties for: ${rawName}`,
		};
	}

	return {
		status: "ready" as const,
		values: {
			properties,
			userId: null,
			name: rawName,
			populatedAt: now,
			externalId: rawName,
			sandboxScriptId: null,
			image: images[0] ?? null,
			entitySchemaId: exerciseSchemaId,
		},
	};
};

export const processExerciseSeedJob = async () => {
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
		const result = buildExerciseSeedEntityValues(exerciseSchema.id, ex, now);
		if (result.status === "skipped") {
			console.warn(
				`Skipping exercise seed row: ${result.reason} (name: ${String(ex.name)})`,
			);
			skipped++;
			continue;
		}

		const { values } = result;

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
