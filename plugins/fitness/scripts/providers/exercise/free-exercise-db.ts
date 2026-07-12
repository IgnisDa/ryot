import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { DateTime, Effect, Schema } from "@ryot/sandbox-sdk/effect";
import type { ProviderDetailsInput, ProviderSearchInput } from "@ryot/sandbox-sdk/provider";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";

type ExerciseSourceHost = SandboxHost<readonly ["httpCall", "getCachedValue", "setCachedValue"]>;
type ExercisePreloadHost = SandboxHost<
	readonly [
		"httpCall",
		"getCachedValue",
		"setCachedValue",
		"getPluginConfigValue",
		"upsertGlobalEntities",
	]
>;

const exerciseImageSchema = Schema.Struct({ type: Schema.Literal("remote"), url: Schema.String });
type ExerciseImage = Schema.Schema.Type<typeof exerciseImageSchema>;

const exercisePropertiesSchema = Schema.Struct({
	kind: Schema.String,
	level: Schema.String,
	force: Schema.NullOr(Schema.String),
	muscles: Schema.Array(Schema.String),
	mechanic: Schema.NullOr(Schema.String),
	equipment: Schema.NullOr(Schema.String),
	images: Schema.Array(exerciseImageSchema),
	instructions: Schema.Array(Schema.String),
});

const normalizedExerciseSchema = Schema.Struct({
	name: Schema.String,
	externalId: Schema.String,
	searchText: Schema.String,
	properties: exercisePropertiesSchema,
});
type ExerciseProperties = Schema.Schema.Type<typeof exercisePropertiesSchema>;
type NormalizedExercise = Schema.Schema.Type<typeof normalizedExerciseSchema>;

const cachedExerciseSchema = Schema.Struct({
	name: Schema.String,
	externalId: Schema.String,
	searchText: Schema.String,
	properties: Schema.Struct({
		kind: Schema.String,
		level: Schema.String,
		muscles: Schema.Array(Schema.String),
		force: Schema.optional(Schema.Unknown),
		mechanic: Schema.optional(Schema.Unknown),
		images: Schema.Array(exerciseImageSchema),
		equipment: Schema.optional(Schema.Unknown),
		instructions: Schema.Array(Schema.String),
	}),
});
const cachedExercisesMetadataSchema = Schema.Struct({
	version: Schema.String,
	chunkCount: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThan(0)),
	),
});
const exercisePayloadSchema = Schema.Array(Schema.Unknown);

type EnumResult = { ok: boolean; value: string | null };

const EXERCISES_URL =
	"https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json";
const IMAGES_PREFIX_URL =
	"https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises";

const CACHE_KEY = "free-exercise-db:normalized:v1";
const CACHE_TTL_SECONDS = 86400;
const CACHE_CHUNK_BYTE_LIMIT = 80000;

const equipmentAliases: Record<string, string> = {
	"e-z curl bar": "ez_curl_bar",
};

const validForce = new Set(["pull", "push", "static"]);
const validLevel = new Set(["beginner", "intermediate", "expert"]);
const validMechanic = new Set(["compound", "isolation"]);
const validMuscles = new Set([
	"lats",
	"neck",
	"traps",
	"chest",
	"biceps",
	"calves",
	"glutes",
	"triceps",
	"forearms",
	"abductors",
	"adductors",
	"shoulders",
	"lower_back",
	"abdominals",
	"hamstrings",
	"quadriceps",
	"middle_back",
]);
const validEquipment = new Set([
	"bands",
	"cable",
	"other",
	"barbell",
	"machine",
	"body_only",
	"dumbbell",
	"foam_roll",
	"ez_curl_bar",
	"kettlebells",
	"exercise_ball",
	"medicine_ball",
]);

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const asRecord = (value: unknown): UnknownRecord | null => (isRecord(value) ? value : null);

const stringValue = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim() : null;

const categoryToKind = (category: string) => {
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

const normalizeSlugValue = (value: unknown) => {
	if (typeof value !== "string" || !value.trim()) {
		return null;
	}
	return value.trim().toLowerCase().replace(/\s+/g, "_");
};

const normalizeEquipmentValue = (value: unknown): EnumResult => {
	if (typeof value !== "string" || !value.trim()) {
		return { ok: true, value: null };
	}

	const lower = value.trim().toLowerCase();
	const normalized = equipmentAliases[lower] ?? normalizeSlugValue(value);
	return normalized !== null && validEquipment.has(normalized)
		? { ok: true, value: normalized }
		: { ok: false, value: null };
};

const normalizeOptionalEnumValue = (value: unknown, validValues: Set<string>): EnumResult => {
	if (typeof value !== "string" || !value.trim()) {
		return { ok: true, value: null };
	}

	const normalized = normalizeSlugValue(value);
	return normalized !== null && validValues.has(normalized)
		? { ok: true, value: normalized }
		: { ok: false, value: null };
};

const normalizeRequiredEnumValue = (value: unknown, validValues: Set<string>) => {
	const normalized = normalizeSlugValue(value);
	return normalized !== null && validValues.has(normalized) ? normalized : null;
};

const normalizeMuscleArray = (value: unknown) => {
	if (!Array.isArray(value)) {
		return [];
	}

	const muscles: string[] = [];
	for (const muscle of value) {
		const normalized = normalizeSlugValue(muscle);
		if (normalized === null || !validMuscles.has(normalized)) {
			return null;
		}
		muscles.push(normalized);
	}
	return muscles;
};

const getInstructions = (value: unknown) => {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.every((instruction) => typeof instruction === "string")
		? value.filter((instruction): instruction is string => typeof instruction === "string")
		: null;
};

const getImages = (value: unknown): ExerciseImage[] => {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((path): path is string => typeof path === "string" && path.trim().length > 0)
		.map((path) => ({ type: "remote" as const, url: `${IMAGES_PREFIX_URL}/${path}` }));
};

const normalizeSearchText = (parts: ReadonlyArray<string | readonly string[] | null>) =>
	parts
		.filter((part): part is string | readonly string[] => part !== null)
		.flatMap((part) => (Array.isArray(part) ? part : [part]))
		.join(" ")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();

const normalizeExercise = (value: unknown): NormalizedExercise | null => {
	const exercise = asRecord(value);
	const category = typeof exercise?.["category"] === "string" ? exercise["category"] : "";
	const kind = categoryToKind(category);
	if (!kind) {
		return null;
	}

	const name = typeof exercise?.["name"] === "string" ? exercise["name"].trim() : "";
	if (!name) {
		return null;
	}

	const force = normalizeOptionalEnumValue(exercise?.["force"], validForce);
	const level = normalizeRequiredEnumValue(exercise?.["level"], validLevel);
	const mechanic = normalizeOptionalEnumValue(exercise?.["mechanic"], validMechanic);
	const equipment = normalizeEquipmentValue(exercise?.["equipment"]);
	if (!force.ok || !level || !mechanic.ok || !equipment.ok) {
		return null;
	}

	const primaryMuscles = normalizeMuscleArray(exercise?.["primaryMuscles"]);
	const secondaryMuscles = normalizeMuscleArray(exercise?.["secondaryMuscles"]);
	const instructions = getInstructions(exercise?.["instructions"]);
	if (!primaryMuscles || !secondaryMuscles || !instructions) {
		return null;
	}

	const images = getImages(exercise?.["images"]);
	const muscles = [...new Set([...primaryMuscles, ...secondaryMuscles])];
	const properties: ExerciseProperties = {
		kind,
		force: force.value,
		level,
		images,
		muscles,
		mechanic: mechanic.value,
		equipment: equipment.value,
		instructions,
	};

	return {
		name,
		properties,
		externalId: name,
		searchText: normalizeSearchText([
			name,
			kind,
			level,
			category,
			force.value,
			mechanic.value,
			equipment.value,
			muscles,
			instructions,
		]),
	};
};

const reviveExercise = (value: unknown): NormalizedExercise | null => {
	const decoded = Schema.decodeUnknownResult(cachedExerciseSchema)(value);
	if (decoded._tag === "Failure") {
		return null;
	}
	const row = decoded.success;
	const name = stringValue(row.name);
	const externalId = stringValue(row.externalId);
	const kind = stringValue(row.properties.kind);
	const level = stringValue(row.properties.level);
	if (name === null || externalId === null || kind === null || level === null) {
		return null;
	}
	const images: ExerciseImage[] = [];
	for (const image of row.properties.images) {
		const url = stringValue(image.url);
		if (url === null) {
			return null;
		}
		images.push({ type: "remote", url });
	}
	return {
		name,
		externalId,
		searchText: row.searchText,
		properties: {
			kind,
			level,
			images,
			muscles: [...row.properties.muscles],
			instructions: [...row.properties.instructions],
			force: typeof row.properties.force === "string" ? row.properties.force : null,
			mechanic: typeof row.properties.mechanic === "string" ? row.properties.mechanic : null,
			equipment: typeof row.properties.equipment === "string" ? row.properties.equipment : null,
		},
	};
};

const writeCachedValue = (host: ExerciseSourceHost, key: string, value: JsonValue) =>
	host.setCachedValue(key, value, CACHE_TTL_SECONDS).pipe(Effect.asVoid);

const readCachedExercises = (host: ExerciseSourceHost) =>
	Effect.gen(function* () {
		const metadataValue = yield* host.getCachedValue(CACHE_KEY);
		const metadata = Schema.decodeUnknownResult(cachedExercisesMetadataSchema)(metadataValue);
		if (metadata._tag === "Failure") {
			return null;
		}

		const rows: NormalizedExercise[] = [];
		for (let index = 0; index < metadata.success.chunkCount; index += 1) {
			const chunkValue = yield* host.getCachedValue(
				`${CACHE_KEY}:${metadata.success.version}:chunk:${index}`,
			);
			if (!Array.isArray(chunkValue)) {
				return null;
			}
			for (const entry of chunkValue) {
				const revived = reviveExercise(entry);
				if (!revived) {
					return null;
				}
				rows.push(revived);
			}
		}
		return rows;
	});

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

const chunkExercises = (rows: readonly NormalizedExercise[]) => {
	const chunks: NormalizedExercise[][] = [];
	let currentChunk: NormalizedExercise[] = [];

	for (const row of rows) {
		const nextChunk = [...currentChunk, row];
		const nextBytes = byteLength(JSON.stringify(nextChunk));
		if (currentChunk.length > 0 && nextBytes > CACHE_CHUNK_BYTE_LIMIT) {
			chunks.push(currentChunk);
			currentChunk = [row];
			continue;
		}
		if (nextBytes > CACHE_CHUNK_BYTE_LIMIT) {
			throw new Error(`Exercise cache row is too large: ${row.name}`);
		}
		currentChunk = nextChunk;
	}

	if (currentChunk.length > 0) {
		chunks.push(currentChunk);
	}
	return chunks;
};

const writeCachedExercises = (host: ExerciseSourceHost, rows: readonly NormalizedExercise[]) => {
	const version = String(Date.now());

	return Effect.gen(function* () {
		const chunks = yield* Effect.try({
			try: () => chunkExercises(rows),
			catch: (error) =>
				error instanceof Error ? error : new Error("Failed to chunk exercise cache"),
		});
		for (const [index, chunk] of chunks.entries()) {
			yield* writeCachedValue(host, `${CACHE_KEY}:${version}:chunk:${index}`, chunk);
		}
		yield* writeCachedValue(host, CACHE_KEY, { version, chunkCount: chunks.length });
	});
};

const loadExercises = (host: ExerciseSourceHost) =>
	Effect.gen(function* () {
		const cached = yield* readCachedExercises(host);
		if (cached) {
			return cached;
		}

		const response = yield* host.httpCall("GET", EXERCISES_URL);
		const payload = yield* Effect.try({
			try: () => JSON.parse(response.body) as unknown,
			catch: () => new Error("Exercise database returned invalid JSON"),
		});
		const exercises = yield* Schema.decodeUnknownEffect(exercisePayloadSchema)(payload).pipe(
			Effect.mapError(() => new Error("Exercise database returned an unexpected payload")),
		);
		const rows = exercises
			.map(normalizeExercise)
			.filter((exercise): exercise is NormalizedExercise => exercise !== null)
			.sort((left, right) => left.name.localeCompare(right.name));
		yield* writeCachedExercises(host, rows);
		return rows;
	});

const scoreExercise = (row: NormalizedExercise, query: string, tokens: readonly string[]) => {
	if (!query) {
		return 0;
	}

	const name = row.name.toLowerCase();
	let score = 0;
	if (name === query) {
		score += 100;
	}
	if (name.startsWith(query)) {
		score += 50;
	}
	if (name.includes(query)) {
		score += 25;
	}
	for (const token of tokens) {
		if (name.includes(token)) {
			score += 5;
		} else if (row.searchText.includes(token)) {
			score += 1;
		}
	}
	return score;
};

const matchesExercise = (row: NormalizedExercise, query: string, tokens: readonly string[]) => {
	if (!query) {
		return true;
	}
	if (row.searchText.includes(query)) {
		return true;
	}
	return tokens.every((token) => row.searchText.includes(token));
};

export const searchExercises = (input: ProviderSearchInput, host: ExerciseSourceHost) => {
	const normalizedQuery = normalizeSearchText([input.query]);
	const tokens = normalizedQuery ? normalizedQuery.split(" ") : [];
	return Effect.gen(function* () {
		const rows = yield* loadExercises(host);
		const matchedRows = rows
			.filter((row) => matchesExercise(row, normalizedQuery, tokens))
			.map((row) => ({ row, score: scoreExercise(row, normalizedQuery, tokens) }))
			.sort((left, right) => {
				if (left.score !== right.score) {
					return right.score - left.score;
				}
				return left.row.name.localeCompare(right.row.name);
			})
			.map((match) => match.row);

		const totalItems = matchedRows.length;
		const pageStart = (input.page - 1) * input.pageSize;
		const pageRows = matchedRows.slice(pageStart, pageStart + input.pageSize);
		const items = pageRows.map((row) => {
			const image = row.properties.images[0] ?? null;
			return {
				externalId: row.externalId,
				calloutProperty: { kind: "null" as const, value: null },
				titleProperty: { kind: "text" as const, value: row.name },
				primarySubtitleProperty: { kind: "null" as const, value: null },
				secondarySubtitleProperty: { kind: "null" as const, value: null },
				imageProperty:
					image === null
						? { kind: "null" as const, value: null }
						: { kind: "image" as const, value: image },
			};
		});

		return {
			items,
			details: {
				totalItems,
				nextPage: pageStart + input.pageSize < totalItems ? input.page + 1 : null,
			},
		};
	});
};

export const getExerciseDetails = (input: ProviderDetailsInput, host: ExerciseSourceHost) =>
	Effect.gen(function* () {
		const rows = yield* loadExercises(host);
		const row = rows.find((exercise) => exercise.externalId === input.externalId);
		if (!row) {
			return yield* Effect.fail(new Error(`Exercise not found: ${input.externalId}`));
		}
		return { name: row.name, properties: row.properties };
	});

const PRELOAD_BATCH_SIZE = 100;
const MAX_PRELOAD_EXERCISE_LIMIT = 873;
export const preloadResultSchema = Schema.Struct({
	processed: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
	inserted: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
});

export const preloadExercises = (host: ExercisePreloadHost) =>
	Effect.gen(function* () {
		const configuredLimit = yield* host.getPluginConfigValue("exercisePreloadLimit");
		if (typeof configuredLimit !== "number") {
			return yield* Effect.fail(new Error("Exercise preload limit must be a number"));
		}
		const preloadLimit = Math.min(MAX_PRELOAD_EXERCISE_LIMIT, Math.max(0, configuredLimit));
		const exercises = (yield* loadExercises(host)).slice(0, preloadLimit);
		const populatedAt = DateTime.formatIso(DateTime.nowUnsafe());
		let inserted = 0;

		for (let offset = 0; offset < exercises.length; offset += PRELOAD_BATCH_SIZE) {
			const batch = exercises.slice(offset, offset + PRELOAD_BATCH_SIZE).map((exercise) => ({
				populatedAt,
				name: exercise.name,
				properties: exercise.properties,
				externalId: exercise.externalId,
				entitySchemaSlug: "exercise",
			}));
			const results = yield* host.upsertGlobalEntities(batch, { maximumTotal: preloadLimit });
			inserted += results.filter(
				(result) => result.status === "upserted" && result.wasInserted,
			).length;
		}

		return { inserted, processed: exercises.length };
	});
