import type { PluginEntityUserStatePolicy } from "@ryot-app/contract/modules/plugins/manifest";
import {
	EntitySchemaSlug,
	EventSchemaSlug,
	RelationshipSchemaSlug,
} from "@ryot-app/contract/schema/brands";

const children: Readonly<Record<string, NonNullable<PluginEntityUserStatePolicy["children"]>>> = {
	"show-season": [
		{
			entitySchemaSlug: "show-episode",
			path: ["show-season-to-show-episode"],
			identityProperties: ["seasonNumber", "episodeNumber"],
		},
	],
	podcast: [
		{
			matchName: true,
			entitySchemaSlug: "podcast-episode",
			path: ["podcast-to-podcast-episode"],
			identityProperties: ["episodeNumber"],
		},
	],
	show: [
		{
			path: ["show-to-show-season"],
			entitySchemaSlug: "show-season",
			identityProperties: ["seasonNumber"],
		},
		{
			entitySchemaSlug: "show-episode",
			identityProperties: ["seasonNumber", "episodeNumber"],
			path: ["show-to-show-season", "show-season-to-show-episode"],
		},
	],
};

export const mediaUserStatePolicy = (slug: string): PluginEntityUserStatePolicy => ({
	deniedOperations: [],
	children: children[slug] ?? [],
	relationships: [
		{ owner: { kind: "self" }, slug: RelationshipSchemaSlug.make("in-media-library") },
		{ owner: { kind: "self" }, slug: RelationshipSchemaSlug.make("media-monitoring") },
		{ owner: { kind: "self" }, slug: RelationshipSchemaSlug.make("media-suggestion") },
		{ owner: { kind: "self" }, slug: RelationshipSchemaSlug.make("media-trending") },
		{ owner: { kind: "kernel" }, slug: RelationshipSchemaSlug.make("member-of") },
	],
	evidence: [
		...[
			"history-correction",
			"completion-occurrence",
			"completion-episode",
			"history-coverage",
		].map((eventSchemaSlug) => ({
			subjectProperty: "subjectEntityId",
			resetOnMerge:
				eventSchemaSlug === "history-correction" || eventSchemaSlug === "history-coverage",
			eventSchema: {
				owner: { kind: "self" as const },
				slug: EventSchemaSlug.make(eventSchemaSlug),
				entitySchemaSlug: EntitySchemaSlug.make("media-library"),
			},
		})),
		...["add-entity-to-collection", "remove-entity-from-collection"].map((eventSlug) => ({
			subjectProperty: "entityId",
			eventSchema: {
				owner: { kind: "kernel" as const },
				slug: EventSchemaSlug.make(eventSlug),
				entitySchemaSlug: EntitySchemaSlug.make("collection"),
			},
		})),
	],
});
