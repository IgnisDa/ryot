import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import {
	API_BASE_URL,
	INDEX_LIMIT,
	asRecord,
	integerValue,
	intersectEntries,
	loadJson,
	namedValue,
	stringValue,
	titleCase,
	toEntries,
	type PokeApiEntry,
	type PokeApiHost,
} from "./pokeapi-shared";

export const manifest = defineManifest({
	name: "PokeAPI",
	kind: "provider",
	slug: "move.pokeapi",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

const searchOptionsSchema = Schema.Struct({
	generation: Schema.optional(Schema.String),
	damageClass: Schema.optional(Schema.String),
	typeNames: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ parseOptions: { onExcessProperty: "error" as const } });

const loadIndexEntries = (host: PokeApiHost) =>
	loadJson(host, `${API_BASE_URL}/move?limit=${INDEX_LIMIT}&offset=0`).pipe(
		Effect.map((payload) => toEntries(asRecord(payload)?.["results"])),
	);

const loadMovesAt = (host: PokeApiHost, path: string) =>
	loadJson(host, `${API_BASE_URL}/${path}`).pipe(
		Effect.map((payload) => toEntries(asRecord(payload)?.["moves"])),
	);

const unionEntries = (groups: ReadonlyArray<ReadonlyArray<PokeApiEntry>>) => {
	const byId = new Map<number, PokeApiEntry>();
	for (const group of groups) {
		for (const entry of group) {
			byId.set(entry.id, entry);
		}
	}
	return [...byId.values()];
};

const loadMove = (host: PokeApiHost, externalId: string) =>
	loadJson(host, `${API_BASE_URL}/move/${encodeURIComponent(externalId)}`).pipe(
		Effect.flatMap((payload) => {
			const move = asRecord(payload);
			return move
				? Effect.succeed(move)
				: Effect.fail(new Error(`PokeAPI returned no move for '${externalId}'`));
		}),
	);

const englishEffect = (move: Record<string, unknown>) =>
	(Array.isArray(move["effect_entries"]) ? move["effect_entries"] : [])
		.map((item: unknown) => asRecord(item))
		.filter((record) => namedValue(record?.["language"]) === "en")
		.flatMap((record) => {
			const value = stringValue(record?.["short_effect"]);
			return value ? [value] : [];
		})[0] ?? null;

const toSearchItem = (host: PokeApiHost, entry: PokeApiEntry) =>
	loadMove(host, String(entry.id)).pipe(
		Effect.map((move) => {
			const power = integerValue(move["power"]);
			const typeName = namedValue(move["type"]);
			const damageClass = namedValue(move["damage_class"]);
			const facts = [
				typeName === null ? null : titleCase(typeName),
				damageClass === null ? null : titleCase(damageClass),
				power === null ? null : `Power ${power}`,
			].flatMap((value) => (value === null ? [] : [value]));
			return {
				title: titleCase(entry.name),
				externalId: String(entry.id),
				metadata:
					facts.length === 0
						? ([`#${entry.id}`] as const)
						: ([`#${entry.id}`, facts.join(", ")] as const),
			};
		}),
	);

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		Effect.gen(function* () {
			const options = yield* Schema.decodeUnknownEffect(searchOptionsSchema)(input.options ?? {});
			const typeNames = options.typeNames ?? [];
			const paths = [
				options.generation === undefined
					? null
					: `generation/${encodeURIComponent(options.generation)}`,
				options.damageClass === undefined
					? null
					: `move-damage-class/${encodeURIComponent(options.damageClass)}`,
			].flatMap((path) => (path === null ? [] : [path]));
			const typed =
				typeNames.length === 0
					? []
					: [
							unionEntries(
								yield* Effect.all(
									typeNames.map((typeName) =>
										loadMovesAt(host, `type/${encodeURIComponent(typeName)}`),
									),
									{ concurrency: 3 },
								),
							),
						];
			const filtered = [
				...typed,
				...(yield* Effect.all(
					paths.map((path) => loadMovesAt(host, path)),
					{ concurrency: 2 },
				)),
			];
			const candidates =
				filtered.length === 0 ? yield* loadIndexEntries(host) : intersectEntries(filtered);
			const query = input.query.trim().toLowerCase();
			const matches = candidates
				.filter((entry) => query.length === 0 || entry.name.includes(query))
				.sort((left, right) => left.id - right.id);
			const offset = (input.page - 1) * input.pageSize;
			const pageEntries = matches.slice(offset, offset + input.pageSize);
			const items = yield* Effect.all(
				pageEntries.map((entry) => toSearchItem(host, entry)),
				{ concurrency: 5 },
			);
			return {
				items,
				details: {
					totalItems: matches.length,
					nextPage: offset + pageEntries.length < matches.length ? input.page + 1 : null,
				},
			};
		}),
});

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => {
		if (!/^\d+$/.test(input.externalId)) {
			return Effect.fail(new Error("externalId must be a numeric PokeAPI move ID (e.g. '85')"));
		}
		return loadMove(host, input.externalId).pipe(
			Effect.flatMap((move) => {
				const name = stringValue(move["name"]);
				if (!name) {
					return Effect.fail(new Error("PokeAPI move payload is missing name"));
				}
				const target = namedValue(move["target"]);
				const typeName = namedValue(move["type"]);
				const generation = namedValue(move["generation"]);
				const damageClass = namedValue(move["damage_class"]);
				return Effect.succeed({
					name: titleCase(name),
					properties: {
						effect: englishEffect(move),
						pp: integerValue(move["pp"]),
						power: integerValue(move["power"]),
						sourceUrl: `${API_BASE_URL}/move/${name}`,
						accuracy: integerValue(move["accuracy"]),
						priority: integerValue(move["priority"]),
						target: target === null ? null : titleCase(target),
						type: typeName === null ? null : titleCase(typeName),
						generation: generation === null ? null : titleCase(generation),
						damageClass: damageClass === null ? null : titleCase(damageClass),
					},
				});
			}),
		);
	},
});
