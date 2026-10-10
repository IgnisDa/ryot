const numberedPage = (name: string, stem: string) => {
	if (!name.startsWith(stem) || !name.endsWith(".json")) {
		return undefined;
	}
	const suffix = name.slice(stem.length, -".json".length);
	if (!suffix) {
		return 0;
	}
	if (!suffix.startsWith("-")) {
		return undefined;
	}
	const page = Number.parseInt(suffix.slice(1), 10);
	return Number.isSafeInteger(page) && page >= 0 && String(page) === suffix.slice(1)
		? page
		: undefined;
};
export const classifyTraktExportName = (path: string) => {
	const name = path.split(/[\\/]/).pop() ?? "";
	const metadata = numberedPage(name, "lists-lists");
	if (metadata !== undefined) {
		return { name, page: metadata, kind: { order: 0, type: "list-metadata" } } as const;
	}
	for (const mediaType of ["movies", "shows", "seasons", "episodes"] as const) {
		for (const [prefix, kind] of [
			["ratings", { order: 2, type: "rating" }],
			["comments", { order: 3, type: "comment" }],
		] as const) {
			const page = numberedPage(name, `${prefix}-${mediaType}`);
			if (page !== undefined) {
				return { name, page, kind };
			}
		}
	}
	for (const mediaType of ["movies", "shows"] as const) {
		const page = numberedPage(name, `collection-${mediaType}`);
		if (page !== undefined) {
			return { name, page, kind: { order: 4, type: "collection" } } as const;
		}
	}
	const history = numberedPage(name, "watched-history");
	if (history !== undefined) {
		return { name, page: history, kind: { order: 1, type: "history" } } as const;
	}
	for (const list of ["watchlist", "favorites"] as const) {
		const page = numberedPage(name, `lists-${list}`);
		if (page !== undefined) {
			return { name, page, kind: { order: 5, type: "system-list" } } as const;
		}
	}
	const match = name.match(/^lists-list-(\d+)-.+\.json$/);
	const id = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
	return Number.isSafeInteger(id)
		? ({ name, page: 0, kind: { id, order: 6, type: "custom-list" } } as const)
		: undefined;
};
