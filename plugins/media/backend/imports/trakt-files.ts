const isNumberedPage = (name: string, stem: string) => {
	if (!name.startsWith(stem) || !name.endsWith(".json")) {
		return false;
	}
	const suffix = name.slice(stem.length, -".json".length);
	if (!suffix) {
		return true;
	}
	if (!suffix.startsWith("-")) {
		return false;
	}
	const page = Number.parseInt(suffix.slice(1), 10);
	return Number.isSafeInteger(page) && page >= 0 && String(page) === suffix.slice(1);
};
export const classifyTraktExportName = (path: string) => {
	const name = path.split(/[\\/]/).pop() ?? "";
	if (isNumberedPage(name, "lists-lists")) {
		return { name, kind: { type: "list-metadata" } } as const;
	}
	for (const mediaType of ["movies", "shows", "seasons", "episodes"] as const) {
		for (const [prefix, kind] of [
			["ratings", { type: "rating" }],
			["comments", { type: "comment" }],
		] as const) {
			if (isNumberedPage(name, `${prefix}-${mediaType}`)) {
				return { name, kind };
			}
		}
	}
	for (const mediaType of ["movies", "shows"] as const) {
		if (isNumberedPage(name, `collection-${mediaType}`)) {
			return { name, kind: { type: "collection" } } as const;
		}
	}
	if (isNumberedPage(name, "watched-history")) {
		return { name, kind: { type: "history" } } as const;
	}
	for (const list of ["watchlist", "favorites"] as const) {
		if (isNumberedPage(name, `lists-${list}`)) {
			return { name, kind: { type: "system-list" } } as const;
		}
	}
	const match = name.match(/^lists-list-(\d+)-.+\.json$/);
	const id = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
	return Number.isSafeInteger(id)
		? ({ name, kind: { id, type: "custom-list" } } as const)
		: undefined;
};
