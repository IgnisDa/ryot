import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";

type ResolveEpisodesRef =
	| {
			readonly kind: "show";
			readonly showEntityId: string;
			readonly seasonNumber: number;
			readonly episodeNumber: number;
	  }
	| {
			readonly kind: "podcast";
			readonly episodeNumber: number;
			readonly podcastEntityId: string;
	  };

const EPISODE_ALIAS = "episode";

const QueryRowsResponse = Schema.Struct({
	data: Schema.Struct({
		items: Schema.Array(Schema.Struct({ entityId: Schema.Struct({ value: Schema.String }) })),
	}),
});

const entityIdRef = {
	type: "ref",
	sourceAlias: EPISODE_ALIAS,
	field: { type: "system", name: "id" },
} satisfies JsonValue;

const propertyEquals = (alias: string, schema: string, path: string, value: number): JsonValue => ({
	operator: "eq",
	type: "comparison",
	right: { type: "literal", value },
	left: { type: "ref", sourceAlias: alias, field: { type: "property", schema, path: [path] } },
});

const identifiedBy = (alias: string, entityId: string): JsonValue => ({
	operator: "eq",
	type: "comparison",
	right: { type: "literal", value: entityId },
	left: { type: "ref", sourceAlias: alias, field: { type: "system", name: "id" } },
});

const parentExists = (input: {
	alias: string;
	schema: string;
	edgeAlias: string;
	childAlias: string;
	relationshipSchema: string;
	where: JsonValue;
}): JsonValue => ({
	type: "exists",
	source: {
		type: "entities",
		where: input.where,
		alias: input.alias,
		schemas: [input.schema],
		via: {
			alias: input.edgeAlias,
			direction: "incoming",
			entityRef: input.childAlias,
			schema: input.relationshipSchema,
		},
	},
});

const episodeCandidateDocument = (episodeSchema: string, where: JsonValue): JsonValue => ({
	source: { type: "entities", where, alias: EPISODE_ALIAS, schemas: [episodeSchema] },
	output: {
		type: "rows",
		pagination: { page: 1, limit: 2 },
		orderBy: [{ order: "asc", expr: entityIdRef }],
		fields: [{ key: "entityId", expr: entityIdRef }],
	},
});

const refDocument = (ref: ResolveEpisodesRef): JsonValue =>
	ref.kind === "podcast"
		? episodeCandidateDocument("podcast-episode", {
				type: "and",
				values: [
					propertyEquals(EPISODE_ALIAS, "podcast-episode", "episodeNumber", ref.episodeNumber),
					parentExists({
						alias: "podcast",
						schema: "podcast",
						childAlias: EPISODE_ALIAS,
						edgeAlias: "podcastEpisodeEdge",
						relationshipSchema: "podcast-to-podcast-episode",
						where: identifiedBy("podcast", ref.podcastEntityId),
					}),
				],
			})
		: episodeCandidateDocument("show-episode", {
				type: "and",
				values: [
					propertyEquals(EPISODE_ALIAS, "show-episode", "episodeNumber", ref.episodeNumber),
					parentExists({
						alias: "season",
						schema: "show-season",
						childAlias: EPISODE_ALIAS,
						edgeAlias: "seasonEpisodeEdge",
						relationshipSchema: "show-season-to-show-episode",
						where: {
							type: "and",
							values: [
								propertyEquals("season", "show-season", "seasonNumber", ref.seasonNumber),
								parentExists({
									alias: "show",
									schema: "show",
									childAlias: "season",
									edgeAlias: "showSeasonEdge",
									relationshipSchema: "show-to-show-season",
									where: identifiedBy("show", ref.showEntityId),
								}),
							],
						},
					}),
				],
			});

export const resolveEpisodes = (
	refs: ReadonlyArray<ResolveEpisodesRef>,
	executeQueryEngine: (document: JsonValue) => Effect.Effect<unknown, unknown>,
) =>
	Effect.forEach(refs, (ref) =>
		executeQueryEngine(refDocument(ref)).pipe(
			Effect.flatMap(Schema.decodeUnknown(QueryRowsResponse)),
			Effect.map(({ data }) => ({
				entityId: data.items.length === 1 ? (data.items[0]?.entityId.value ?? null) : null,
			})),
		),
	);
