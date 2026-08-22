import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { entityReadRecipe, executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";

import { builtinMediaEntitySchemaSlugs } from "../../shared/media-schema-slugs";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Media Association Detector",
	slug: "automation.media-association",
	capabilities: ["executeRyotql", "emitSignal"],
	inputProjection: {
		relationship: { properties: ["roles"], compareProperties: [], parentEntityProperties: [] },
	},
});

const roles = (properties: Readonly<Record<string, JsonValue>> | undefined) => {
	const value = properties?.["roles"];
	return Array.isArray(value)
		? value.filter((role): role is string => typeof role === "string")
		: [];
};

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		const source = automation.payload;
		if (source.resource !== "relationship" || source.operation !== "batch") {
			return Effect.succeed(null);
		}
		const changes = source.items.flatMap((item) => (item.operation === "delete" ? [] : [item]));
		const [head, ...rest] = [
			...new Set(changes.flatMap(({ after }) => [after.sourceEntityId, after.targetEntityId])),
		];
		if (head === undefined) {
			return Effect.succeed(null);
		}
		return executeRyotqlRecipe(
			host.executeRyotql,
			entityReadRecipe({ entityIds: [head, ...rest] }),
		).pipe(
			Effect.flatMap(({ items }) =>
				Effect.all(
					changes.flatMap((change) => {
						const subject = items.find(({ id }) => id === change.after.sourceEntityId);
						const associated = items.find(({ id }) => id === change.after.targetEntityId);
						if (!subject || !associated) {
							return [];
						}
						if (
							(subject.entitySchemaSlug !== "person" && subject.entitySchemaSlug !== "company") ||
							!(
								associated.entitySchemaSlug.endsWith("-group") ||
								builtinMediaEntitySchemaSlugs.some((slug) => slug === associated.entitySchemaSlug)
							)
						) {
							return [];
						}
						const population = change.population;
						if (
							population?.rootPreviouslyPopulated === false &&
							population.scopeEntity.id === subject.id
						) {
							return [];
						}
						const previousRoles = new Set(
							roles(change.operation === "update" ? change.before.properties : undefined),
						);
						const addedRoles = [...new Set(roles(change.after.properties))].filter(
							(role) => change.operation === "create" || !previousRoles.has(role),
						);
						const associationKind = associated.entitySchemaSlug.endsWith("-group")
							? "media-group"
							: "media";
						return addedRoles.map((role) =>
							host.emitSignal({
								subjectEntityId: subject.id,
								discriminator: `${subject.id}:${role}`,
								schemaSlug: `${subject.entitySchemaSlug}.${associationKind}.associated`,
								properties: { role, subjectName: subject.name, associatedName: associated.name },
							}),
						);
					}),
					{ concurrency: "unbounded" },
				),
			),
		);
	},
});
