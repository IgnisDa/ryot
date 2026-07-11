import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { defineOperation } from "@ryot/sandbox-sdk/operation";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";

import {
	ResolveEpisodesInput,
	ResolveEpisodesOutput,
	type ResolveEpisodesRef,
} from "../../operations/schemas";

export const manifest = defineManifest({
	kind: "operation",
	name: "Resolve Episodes",
	requiredAppConfigKeys: [],
	slug: "operation.resolve-episodes",
	capabilities: ["executeQueryEngine"],
});

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
	type: "comparison",
	operator: "eq",
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

// Episodes resolve through their parent chain rather than a self-anchored root traversal, so one
// entity row is returned per candidate episode regardless of how many relationship rows link it.
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

export default defineOperation({
	manifest,
	input: ResolveEpisodesInput,
	output: ResolveEpisodesOutput,
	run: (input, host) =>
		Effect.forEach(input.refs, (ref) =>
			host.executeQueryEngine(refDocument(ref)).pipe(
				Effect.flatMap(Schema.decodeUnknown(QueryRowsResponse)),
				Effect.map(({ data }) => ({
					entityId: data.items.length === 1 ? (data.items[0]?.entityId.value ?? null) : null,
				})),
			),
		).pipe(Effect.map((results) => ({ results }))),
});
