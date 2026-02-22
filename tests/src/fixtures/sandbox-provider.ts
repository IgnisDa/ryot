import { randomUUID } from "node:crypto";

import { getPgClient } from "../setup";

export type SeededProviderScript = {
	slug: string;
	scriptId: string;
	entitySchemaScriptId: string | null;
};

export async function seedBuiltinProviderScript(input: {
	code: string;
	slug?: string;
	name?: string;
	linkToEntitySchemaId?: string;
	metadata?: Record<string, unknown>;
}): Promise<SeededProviderScript> {
	const pg = getPgClient();
	const scriptId = randomUUID();
	const slug = input.slug ?? `e2e-provider-${scriptId}`;
	const name = input.name ?? "E2E Provider Script";

	await pg.query(
		`insert into sandbox_script (id, slug, name, code, is_builtin, metadata, user_id)
		 values ($1, $2, $3, $4, true, $5::jsonb, null)`,
		[scriptId, slug, name, input.code, JSON.stringify(input.metadata ?? {})],
	);

	let entitySchemaScriptId: string | null = null;
	if (input.linkToEntitySchemaId) {
		entitySchemaScriptId = randomUUID();
		await pg.query(
			`insert into entity_schema_sandbox_script (id, entity_schema_id, sandbox_script_id)
			 values ($1, $2, $3)`,
			[entitySchemaScriptId, input.linkToEntitySchemaId, scriptId],
		);
	}

	return { slug, scriptId, entitySchemaScriptId };
}

export async function cleanupBuiltinProviderScript(seeded: SeededProviderScript): Promise<void> {
	const pg = getPgClient();
	try {
		await pg.query(
			`delete from relationship r
			 using entity e
			 where (r.source_entity_id = e.id or r.target_entity_id = e.id)
			   and e.sandbox_script_id = $1`,
			[seeded.scriptId],
		);
		await pg.query(`delete from entity where sandbox_script_id = $1`, [seeded.scriptId]);
		if (seeded.entitySchemaScriptId) {
			await pg.query(`delete from entity_schema_sandbox_script where id = $1`, [
				seeded.entitySchemaScriptId,
			]);
		}
		await pg.query(`delete from sandbox_script where id = $1`, [seeded.scriptId]);
	} catch (error) {
		console.error("[sandbox-provider] cleanup failed (non-fatal)", error);
	}
}

export type FakeSearchItem = {
	title: string;
	externalId: string;
	subtitle?: number | null;
};

export function searchDriverCode(items: ReadonlyArray<FakeSearchItem>): string {
	const result = {
		items: items.map((item) => ({
			externalId: item.externalId,
			titleProperty: { kind: "text", value: item.title },
			...(item.subtitle === undefined
				? {}
				: {
						primarySubtitleProperty:
							item.subtitle === null
								? { kind: "null", value: null }
								: { kind: "number", value: item.subtitle },
					}),
		})),
	};
	return `driver("search", async function () { return ${JSON.stringify(result)}; });`;
}

export type FakeRelatedEntity = {
	name: string;
	externalId: string;
	scriptSlug: string;
	relationshipProperties?: Record<string, unknown>;
};

export type FakeRelatedEntityGroup = {
	relationshipSchemaSlug: string;
	direction: "incoming" | "outgoing";
	entities: ReadonlyArray<FakeRelatedEntity>;
	synchronization: "authoritative" | "additive";
};

export function detailsDriverCode(result: {
	name: string;
	properties?: Record<string, unknown>;
	relatedEntityGroups?: ReadonlyArray<FakeRelatedEntityGroup>;
}): string {
	const payload = {
		name: result.name,
		properties: result.properties ?? {},
		...(result.relatedEntityGroups ? { relatedEntityGroups: result.relatedEntityGroups } : {}),
	};
	return `driver("details", async function () { return ${JSON.stringify(payload)}; });`;
}

export async function updateProviderScriptCode(scriptId: string, code: string): Promise<void> {
	await getPgClient().query(`update sandbox_script set code = $1 where id = $2`, [code, scriptId]);
}

// A monitored show's provider returns its whole season/episode tree in one
// `details` call via the nested `childEntities` shape (authoritative sync,
// modeled on entity-schemas/search-import.test.ts + the population child-tree),
// so a refresh diff can surface added/renamed/re-dated episodes and new seasons.

export type MonitoredEpisode = {
	name: string;
	externalId: string;
	publishDate?: string;
	episodeNumber: number;
	properties?: Record<string, unknown>;
};

export type MonitoredSeason = {
	name: string;
	externalId: string;
	seasonNumber: number;
	properties?: Record<string, unknown>;
	episodes: ReadonlyArray<MonitoredEpisode>;
};

export type MonitoredShowTree = {
	name: string;
	properties?: Record<string, unknown>;
	seasons: ReadonlyArray<MonitoredSeason>;
};

const monitoredShowChildEntities = (tree: MonitoredShowTree) =>
	tree.seasons.map((season) => ({
		name: season.name,
		externalId: season.externalId,
		entitySchemaSlug: "show-season",
		properties: { seasonNumber: season.seasonNumber, ...season.properties },
		childEntities: season.episodes.map((episode) => ({
			name: episode.name,
			externalId: episode.externalId,
			entitySchemaSlug: "show-episode",
			properties: {
				seasonNumber: season.seasonNumber,
				episodeNumber: episode.episodeNumber,
				...(episode.publishDate === undefined ? {} : { publishDate: episode.publishDate }),
				...episode.properties,
			},
		})),
	}));

export function monitoredShowDetailsCode(tree: MonitoredShowTree): string {
	const payload = {
		name: tree.name,
		properties: tree.properties ?? {},
		childEntities: monitoredShowChildEntities(tree),
	};
	return `driver("details", async function () { return ${JSON.stringify(payload)}; });`;
}

const mapMonitoredEpisode = (
	tree: MonitoredShowTree,
	episodeExternalId: string,
	map: (episode: MonitoredEpisode) => MonitoredEpisode,
): MonitoredShowTree => ({
	...tree,
	seasons: tree.seasons.map((season) => ({
		...season,
		episodes: season.episodes.map((episode) =>
			episode.externalId === episodeExternalId ? map(episode) : episode,
		),
	})),
});

export function withAddedSeason(
	tree: MonitoredShowTree,
	season: MonitoredSeason,
): MonitoredShowTree {
	return { ...tree, seasons: [...tree.seasons, season] };
}

export function withAddedEpisode(
	tree: MonitoredShowTree,
	seasonExternalId: string,
	episode: MonitoredEpisode,
): MonitoredShowTree {
	return {
		...tree,
		seasons: tree.seasons.map((season) =>
			season.externalId === seasonExternalId
				? { ...season, episodes: [...season.episodes, episode] }
				: season,
		),
	};
}

export function withRenamedEpisode(
	tree: MonitoredShowTree,
	episodeExternalId: string,
	name: string,
): MonitoredShowTree {
	return mapMonitoredEpisode(tree, episodeExternalId, (episode) => ({ ...episode, name }));
}

export function withBumpedEpisode(
	tree: MonitoredShowTree,
	episodeExternalId: string,
	patch: { publishDate?: string; properties?: Record<string, unknown> },
): MonitoredShowTree {
	return mapMonitoredEpisode(tree, episodeExternalId, (episode) => ({
		...episode,
		...(patch.publishDate === undefined ? {} : { publishDate: patch.publishDate }),
		properties: { ...episode.properties, ...patch.properties },
	}));
}

export function translateDriverCode(
	translations: Record<
		string,
		{ name?: string | null; properties?: Record<string, unknown> | null }
	>,
): string {
	return `driver("translate", async function (context) {
	var translations = ${JSON.stringify(translations)};
	var language = context && context.language;
	if (language && Object.prototype.hasOwnProperty.call(translations, language)) {
		return translations[language];
	}
	return {};
});`;
}
