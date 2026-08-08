export type SavedViewSessionEntry = {
	readonly query: string;
	readonly scrollOffset: number;
};

export type SavedViewSession = {
	readonly workspace: string;
	readonly views: Readonly<Record<string, SavedViewSessionEntry>>;
};

const emptyEntry: SavedViewSessionEntry = { query: "", scrollOffset: 0 };

export const emptySavedViewSession: SavedViewSession = { views: {}, workspace: "" };

export function savedViewSessionEntry(
	session: SavedViewSession,
	workspace: string,
	slug: string,
): SavedViewSessionEntry {
	if (session.workspace !== workspace) {
		return emptyEntry;
	}
	return session.views[slug] ?? emptyEntry;
}

function withSavedViewEntry(
	session: SavedViewSession,
	workspace: string,
	slug: string,
	entry: SavedViewSessionEntry,
): SavedViewSession {
	const views = session.workspace === workspace ? session.views : {};
	return { workspace, views: { ...views, [slug]: entry } };
}

export function withSavedViewQuery(
	session: SavedViewSession,
	workspace: string,
	slug: string,
	query: string,
) {
	return withSavedViewEntry(session, workspace, slug, { query, scrollOffset: 0 });
}

export function withSavedViewScrollOffset(
	session: SavedViewSession,
	workspace: string,
	slug: string,
	scrollOffset: number,
) {
	const current = savedViewSessionEntry(session, workspace, slug);
	return withSavedViewEntry(session, workspace, slug, { ...current, scrollOffset });
}
