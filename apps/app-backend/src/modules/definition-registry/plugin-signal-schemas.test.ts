import { assert, expect, it } from "@effect/vitest";
import { RelationshipSchemaSlug } from "@ryot/contract/schema/brands";
import fitnessPlugin from "@ryot/fitness-plugin";
import mediaPlugin from "@ryot/media-plugin";
import { Effect, Result } from "effect";

import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { makePluginLoader } from "#modules/plugins/loader";

import { makeDefinitionRegistry } from "./service";

const mediaMonitoringRelationshipSchemaSlug = RelationshipSchemaSlug.make("media-monitoring");

const signalDefinitions = () => {
	const registry = makeDefinitionRegistry();
	const loader = makePluginLoader(registry);
	loader.load({ manifest: mediaPlugin, sourceHash: "media", scripts: [] });
	loader.load({ manifest: fitnessPlugin, sourceHash: "fitness", scripts: [] });
	return Object.values(registry.getSnapshot().signalSchemas);
};

const contracts = {
	"workout.created": { workoutId: "workout-1", workoutName: "Morning Run" },
	"integration.disabled": { integrationId: "integration-1", providerName: "komga" },
	"review.created": {
		entityName: "Dune",
		entityId: "entity-1",
		entitySchemaSlug: "book",
		reviewEventId: "review-1",
	},
} as const;

it.effect("defines strict active actor contracts for the first notification signals", () =>
	Effect.gen(function* () {
		const definitions = signalDefinitions();

		expect(definitions.filter(({ slug }) => slug in contracts).map(({ slug }) => slug)).toEqual([
			"integration.disabled",
			"review.created",
			"workout.created",
		]);
		for (const [slug, properties] of Object.entries(contracts)) {
			const definition = definitions.find((candidate) => candidate.slug === slug);
			assert(definition);
			expect(definition.catalogState).toBe("active");
			expect(definition.audiencePolicy).toEqual({ kind: "actor" });
			expect(definition.propertiesSchema.unknownKeys).toBe("strict");

			const valid = yield* parseAppSchemaProperties({
				kind: "Signal",
				properties,
				propertiesSchema: definition.propertiesSchema,
			});
			expect(valid).toEqual(properties);

			const unknown = yield* Effect.result(
				parseAppSchemaProperties({
					kind: "Signal",
					properties: { ...properties, unexpected: true },
					propertiesSchema: definition.propertiesSchema,
				}),
			);
			expect(Result.isFailure(unknown)).toBe(true);
		}
	}),
);

const mediaContracts = {
	"media.season-count.changed": { oldCount: 1, newCount: 2, entityName: "Severance" },
	"media.status.changed": { newStatus: "Ended", oldStatus: "Airing", entityName: "Severance" },
	"media.episode.images.changed": { seasonNumber: 2, episodeNumber: 1, entityName: "Severance" },
	"person.media.associated": {
		role: "Director",
		associatedName: "Barbie",
		subjectName: "Greta Gerwig",
	},
	"company.media.associated": {
		role: "Studio",
		subjectName: "Studio Ghibli",
		associatedName: "Spirited Away",
	},
	"person.media-group.associated": {
		role: "Artist",
		subjectName: "Beyonce",
		associatedName: "Destiny's Child",
	},
	"company.media-group.associated": {
		role: "Publisher",
		subjectName: "Nintendo",
		associatedName: "The Legend of Zelda",
	},
	"media.content-count.changed": {
		oldCount: 12,
		newCount: 13,
		entityName: "One Piece",
		contentType: "chapters",
	},
	"media.release-date.changed": {
		oldYear: 2025,
		newYear: 2026,
		entityName: "Dune",
		changeKind: "publish_year",
	},
	"media.episode.name.changed": {
		oldName: null,
		seasonNumber: 2,
		episodeNumber: 1,
		newName: "Premiere",
		entityName: "Severance",
	},
	"media.episode.discovered": {
		oldCount: 7,
		newCount: 10,
		seasonNumber: 2,
		discoveredCount: 3,
		entityName: "Severance",
	},
} as const;

it.effect("defines strict related-user contracts for media update signals", () =>
	Effect.gen(function* () {
		const definitions = signalDefinitions();

		expect(
			new Set(definitions.filter(({ slug }) => slug in mediaContracts).map(({ slug }) => slug)),
		).toEqual(new Set(Object.keys(mediaContracts)));
		for (const [slug, properties] of Object.entries(mediaContracts)) {
			const definition = definitions.find((candidate) => candidate.slug === slug);
			assert(definition);
			expect(definition.catalogState).toBe("active");
			expect(definition.audiencePolicy).toEqual({
				kind: "related_users",
				subjectSide: "source",
				relationshipSchemaSlug: mediaMonitoringRelationshipSchemaSlug,
			});
			const valid = yield* parseAppSchemaProperties({
				properties,
				kind: "Signal",
				propertiesSchema: definition.propertiesSchema,
			});
			expect(valid).toEqual(properties);

			const unknown = yield* Effect.result(
				parseAppSchemaProperties({
					kind: "Signal",
					propertiesSchema: definition.propertiesSchema,
					properties: { ...properties, unexpected: true },
				}),
			);
			expect(Result.isFailure(unknown)).toBe(true);
		}
	}),
);

it.effect("validates both release-date variants and rejects incomplete variants", () =>
	Effect.gen(function* () {
		const definition = signalDefinitions().find(
			({ slug }) => slug === "media.release-date.changed",
		);
		assert(definition);
		const episodeDate = {
			episodeNumber: 3,
			oldDate: "2026-01-01",
			newDate: "2026-02-01",
			entityName: "Podcast",
			changeKind: "episode_date",
		};
		expect(
			yield* parseAppSchemaProperties({
				kind: "Signal",
				properties: episodeDate,
				propertiesSchema: definition.propertiesSchema,
			}),
		).toEqual(episodeDate);

		for (const properties of [
			{ entityName: "Dune", changeKind: "publish_year", oldYear: 2025 },
			{ oldYear: null, newYear: 2026, entityName: "Dune", changeKind: "publish_year" },
			{ entityName: "Podcast", changeKind: "episode_date", oldDate: "2026-01-01" },
		]) {
			const result = yield* Effect.result(
				parseAppSchemaProperties({
					properties,
					kind: "Signal",
					propertiesSchema: definition.propertiesSchema,
				}),
			);
			expect(Result.isFailure(result)).toBe(true);
		}
	}),
);
