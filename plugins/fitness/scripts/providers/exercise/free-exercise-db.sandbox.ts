import { defineManifest, type JsonValue, type SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

export const manifest = defineManifest({
	kind: "provider",
	name: "Free Exercise DB",
	requiredAppConfigKeys: [],
	slug: "exercise.free-exercise-db",
	providerInformation: { source: "free-exercise-db" },
	capabilities: ["httpCall", "getCachedValue", "setCachedValue"],
});

type ExerciseHost = SandboxHost<readonly ["httpCall", "getCachedValue", "setCachedValue"]>;

type ExerciseImage = { type: "remote"; url: string };

type ExerciseProperties = {
	kind: string;
	force: string | null;
	level: string;
	images: ExerciseImage[];
	muscles: string[];
	mechanic: string | null;
	equipment: string | null;
	instructions: string[];
};

type NormalizedExercise = {
	name: string;
	externalId: string;
	searchText: string;
	properties: ExerciseProperties;
};

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

const numberValue = (value: unknown) =>
	typeof value === "number" && Number.isInteger(value) ? value : null;

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

const stringArray = (value: unknown) => {
	if (!Array.isArray(value)) {
		return null;
	}
	const result: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string") {
			return null;
		}
		result.push(entry);
	}
	return result;
};

const imageArray = (value: unknown): ExerciseImage[] | null => {
	if (!Array.isArray(value)) {
		return null;
	}
	const result: ExerciseImage[] = [];
	for (const entry of value) {
		const record = asRecord(entry);
		const url = stringValue(record?.["url"]);
		if (record?.["type"] !== "remote" || url === null) {
			return null;
		}
		result.push({ type: "remote", url });
	}
	return result;
};

const reviveExercise = (value: unknown): NormalizedExercise | null => {
	const record = asRecord(value);
	const name = stringValue(record?.["name"]);
	const externalId = stringValue(record?.["externalId"]);
	const searchText = typeof record?.["searchText"] === "string" ? record["searchText"] : null;
	const properties = asRecord(record?.["properties"]);
	if (name === null || externalId === null || searchText === null || !properties) {
		return null;
	}

	const kind = stringValue(properties["kind"]);
	const level = stringValue(properties["level"]);
	const muscles = stringArray(properties["muscles"]);
	const images = imageArray(properties["images"]);
	const instructions = stringArray(properties["instructions"]);
	if (kind === null || level === null || !muscles || !images || !instructions) {
		return null;
	}

	const force = properties["force"];
	const mechanic = properties["mechanic"];
	const equipment = properties["equipment"];
	return {
		name,
		externalId,
		searchText,
		properties: {
			kind,
			level,
			images,
			muscles,
			instructions,
			force: typeof force === "string" ? force : null,
			mechanic: typeof mechanic === "string" ? mechanic : null,
			equipment: typeof equipment === "string" ? equipment : null,
		},
	};
};

const readCachedValue = (host: ExerciseHost, key: string) =>
	host.getCachedValue(key).then((result) => {
		if (!result.success) {
			throw new Error(result.error || `Failed to read cache key ${key}`);
		}
		return result.data;
	});

const writeCachedValue = (host: ExerciseHost, key: string, value: JsonValue) =>
	host.setCachedValue(key, value, CACHE_TTL_SECONDS).then((result) => {
		if (!result.success) {
			throw new Error(result.error || `Failed to write cache key ${key}`);
		}
		return undefined;
	});

const readCachedExercises = (host: ExerciseHost): Promise<NormalizedExercise[] | null> =>
	readCachedValue(host, CACHE_KEY).then((metadataValue) => {
		const metadata = asRecord(metadataValue);
		const version = typeof metadata?.["version"] === "string" ? metadata["version"] : null;
		const chunkCount = numberValue(metadata?.["chunkCount"]);
		if (version === null || chunkCount === null || chunkCount < 1) {
			return null;
		}

		const readChunk = (
			index: number,
			rows: NormalizedExercise[],
		): Promise<NormalizedExercise[] | null> => {
			if (index >= chunkCount) {
				return Promise.resolve(rows);
			}
			return readCachedValue(host, `${CACHE_KEY}:${version}:chunk:${index}`).then((chunkValue) => {
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
				return readChunk(index + 1, rows);
			});
		};

		return readChunk(0, []);
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

const writeCachedExercises = (host: ExerciseHost, rows: readonly NormalizedExercise[]) => {
	const version = String(Date.now());
	const chunks = chunkExercises(rows);

	return chunks
		.reduce<Promise<unknown>>(
			(chain, chunk, index) =>
				chain.then(() => writeCachedValue(host, `${CACHE_KEY}:${version}:chunk:${index}`, chunk)),
			Promise.resolve(),
		)
		.then(() => writeCachedValue(host, CACHE_KEY, { version, chunkCount: chunks.length }));
};

const loadExercises = (host: ExerciseHost): Promise<NormalizedExercise[]> =>
	readCachedExercises(host).then((cached) => {
		if (cached) {
			return cached;
		}

		return host.httpCall("GET", EXERCISES_URL).then((response) => {
			if (!response.success) {
				throw new Error(response.error || "Exercise database request failed");
			}

			let payload: unknown;
			try {
				payload = JSON.parse(response.data.body);
			} catch {
				throw new Error("Exercise database returned invalid JSON");
			}

			if (!Array.isArray(payload)) {
				throw new Error("Exercise database returned an unexpected payload");
			}

			const rows = payload
				.map(normalizeExercise)
				.filter((exercise): exercise is NormalizedExercise => exercise !== null)
				.sort((left, right) => left.name.localeCompare(right.name));
			return writeCachedExercises(host, rows).then(() => rows);
		});
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

export const search = defineProviderDriver(manifest, "search", (input, host) => {
	const normalizedQuery = normalizeSearchText([input.query]);
	const tokens = normalizedQuery ? normalizedQuery.split(" ") : [];
	return loadExercises(host).then((rows) => {
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
});

export const details = defineProviderDriver(manifest, "details", (input, host) =>
	loadExercises(host).then((rows) => {
		const row = rows.find((exercise) => exercise.externalId === input.externalId);
		if (!row) {
			throw new Error(`Exercise not found: ${input.externalId}`);
		}
		return { name: row.name, properties: row.properties };
	}),
);

export default defineProvider({ manifest, drivers: { search, details } });
