import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

export const manifest = defineManifest({
	name: "PokeAPI",
	kind: "provider",
	slug: "pokemon.pokeapi",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

const INDEX_LIMIT = 10_000;
const ALTERNATE_FORM_ID_START = 10_000;
const API_BASE_URL = "https://pokeapi.co/api/v2";

type PokeApiHost = SandboxHost<readonly ["httpCall"]>;
type PokemonEntry = { readonly id: number; readonly name: string };

const searchOptionsSchema = Schema.Struct({
	includeAlternateForms: Schema.optional(Schema.Boolean),
	typeNames: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ parseOptions: { onExcessProperty: "error" as const } });

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const asRecord = (value: unknown) => (isRecord(value) ? value : null);

const stringValue = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim() : null;

const integerValue = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;

const titleCase = (value: string) =>
	value
		.split("-")
		.map((word) => (word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word))
		.join(" ");

export const loadJson = (host: PokeApiHost, url: string) =>
	host.httpCall("GET", url).pipe(
		Effect.mapError((error) => new Error(error.message || `PokeAPI request failed: ${url}`)),
		Effect.flatMap((response) =>
			Effect.try({
				try: () => JSON.parse(response.body) as unknown,
				catch: () => new Error(`PokeAPI returned invalid JSON: ${url}`),
			}),
		),
	);

const toEntry = (value: unknown): PokemonEntry | null => {
	const record = asRecord(value);
	const url = stringValue(record?.["url"]);
	const name = stringValue(record?.["name"]);
	if (!url || !name) {
		return null;
	}
	const segments = url.split("/").filter(Boolean);
	const id = Number(segments[segments.length - 1]);
	return Number.isInteger(id) ? { id, name } : null;
};

const toEntries = (value: unknown) =>
	(Array.isArray(value) ? value : []).flatMap((item) => {
		const entry = toEntry(item);
		return entry ? [entry] : [];
	});

const loadIndexEntries = (host: PokeApiHost) =>
	loadJson(host, `${API_BASE_URL}/pokemon?limit=${INDEX_LIMIT}&offset=0`).pipe(
		Effect.map((payload) => toEntries(asRecord(payload)?.["results"])),
	);

const loadTypeEntries = (host: PokeApiHost, typeName: string) =>
	loadJson(host, `${API_BASE_URL}/type/${encodeURIComponent(typeName)}`).pipe(
		Effect.map((payload) => {
			const slots = asRecord(payload)?.["pokemon"];
			return toEntries(
				(Array.isArray(slots) ? slots : []).map((slot: unknown) => asRecord(slot)?.["pokemon"]),
			);
		}),
	);

const intersectEntries = (groups: ReadonlyArray<ReadonlyArray<PokemonEntry>>) => {
	const [first, ...rest] = groups;
	if (!first) {
		return [];
	}
	return rest.reduce<ReadonlyArray<PokemonEntry>>((accumulator, group) => {
		const ids = new Set(group.map((entry) => entry.id));
		return accumulator.filter((entry) => ids.has(entry.id));
	}, first);
};

const loadPokemon = (host: PokeApiHost, externalId: string) =>
	loadJson(host, `${API_BASE_URL}/pokemon/${encodeURIComponent(externalId)}`).pipe(
		Effect.flatMap((payload) => {
			const pokemon = asRecord(payload);
			return pokemon
				? Effect.succeed(pokemon)
				: Effect.fail(new Error(`PokeAPI returned no Pokémon for '${externalId}'`));
		}),
	);

const namesFrom = (value: unknown, key: string) =>
	(Array.isArray(value) ? value : []).flatMap((item) => {
		const name = stringValue(asRecord(asRecord(item)?.[key])?.["name"]);
		return name ? [name] : [];
	});

const artworkUrl = (pokemon: Record<string, unknown>) => {
	const sprites = asRecord(pokemon["sprites"]);
	const official = asRecord(asRecord(sprites?.["other"])?.["official-artwork"]);
	return stringValue(official?.["front_default"]) ?? stringValue(sprites?.["front_default"]);
};

const toSearchItem = (host: PokeApiHost, entry: PokemonEntry) =>
	loadPokemon(host, String(entry.id)).pipe(
		Effect.map((pokemon) => {
			const imageUrl = artworkUrl(pokemon);
			const types = namesFrom(pokemon["types"], "type").map(titleCase);
			return {
				title: titleCase(entry.name),
				externalId: String(entry.id),
				...(imageUrl === null ? {} : { imageUrl }),
				metadata:
					types.length === 0
						? ([`#${entry.id}`] as const)
						: ([`#${entry.id}`, types.join(", ")] as const),
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
			const candidates =
				typeNames.length === 0
					? yield* loadIndexEntries(host)
					: intersectEntries(
							yield* Effect.all(
								typeNames.map((typeName) => loadTypeEntries(host, typeName)),
								{ concurrency: 3 },
							),
						);
			const query = input.query.trim().toLowerCase();
			const matches = candidates
				.filter(
					(entry) => options.includeAlternateForms === true || entry.id < ALTERNATE_FORM_ID_START,
				)
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
			return Effect.fail(new Error("externalId must be a numeric PokeAPI Pokémon ID (e.g. '25')"));
		}
		return loadPokemon(host, input.externalId).pipe(
			Effect.flatMap((pokemon) => {
				const name = stringValue(pokemon["name"]);
				if (!name) {
					return Effect.fail(new Error("PokeAPI Pokémon payload is missing name"));
				}
				const imageUrl = artworkUrl(pokemon);
				return Effect.succeed({
					name: titleCase(name),
					properties: {
						sourceUrl: `${API_BASE_URL}/pokemon/${name}`,
						height: integerValue(pokemon["height"]),
						weight: integerValue(pokemon["weight"]),
						pokedexNumber: integerValue(pokemon["id"]),
						baseExperience: integerValue(pokemon["base_experience"]),
						images: imageUrl === null ? [] : [{ type: "remote" as const, url: imageUrl }],
						types: namesFrom(pokemon["types"], "type").map(titleCase),
						abilities: namesFrom(pokemon["abilities"], "ability").map(titleCase),
					},
				});
			}),
		);
	},
});
