export const mediaGenreProviderSlug = "genre.media-catalog";

const normalizeName = (value: string) =>
	value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();

const names = [
	"Action",
	"Adventure",
	"Animation",
	"Biography",
	"Children",
	"Comedy",
	"Crime",
	"Documentary",
	"Drama",
	"Family",
	"Fantasy",
	"Fiction",
	"History",
	"Horror",
	"Mystery",
	"Nonfiction",
	"Romance",
	"Science Fiction",
	"Thriller",
	"War",
	"Western",
	"Music",
	"Musical",
	"Sport",
	"Technology",
	"News",
	"Education",
	"Business",
	"Health",
	"Religion",
	"Science",
	"Society & Culture",
	"Arts",
	"True Crime",
	"Rock",
	"Pop",
	"Jazz",
	"Classical",
	"Electronic",
	"Hip-Hop",
	"Metal",
	"Folk",
	"Country",
	"Blues",
	"Reggae",
	"RPG",
	"Strategy",
	"Simulation",
	"Puzzle",
	"Platform",
	"Shooter",
	"Racing",
	"Visual Novel",
	"Slice of Life",
	"Supernatural",
	"Psychological",
] as const;

const aliases = new Map([
	["role-playing", "rpg"],
	["sci-fi", "science fiction"],
	["sci fi", "science fiction"],
	["non-fiction", "nonfiction"],
	["non fiction", "nonfiction"],
	["role-playing (rpg)", "rpg"],
	["science-fiction", "science fiction"],
]);

const displayNames = new Map(names.map((name) => [normalizeName(name), name]));

export const mediaGenre = (value: string) => {
	const normalized = normalizeName(value);
	const externalId = aliases.get(normalized) ?? normalized;
	if (externalId.length === 0) {
		return null;
	}
	return {
		externalId,
		name:
			displayNames.get(externalId) ??
			externalId.replace(/(^|\s)(\p{L})/gu, (match) => match.toUpperCase()),
	};
};

export const mediaGenreCatalog = names.map((name) => ({ name, externalId: normalizeName(name) }));

export const recognizedMediaGenres = (values: readonly string[]) =>
	values.flatMap((value) => {
		const genre = mediaGenre(value);
		return genre !== null && displayNames.has(genre.externalId) ? [genre.name] : [];
	});
