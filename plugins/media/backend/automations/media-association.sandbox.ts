import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { entityReadRecipe, executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Media Association Detector",
	slug: "automation.media-association",
	capabilities: ["executeRyotql", "emitSignal"],
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
		if (source.resource !== "relationship" || source.operation === "delete") {
			return Effect.succeed(null);
		}
		return executeRyotqlRecipe(
			host.executeRyotql,
			entityReadRecipe({ entityIds: [source.after.sourceEntityId, source.after.targetEntityId] }),
		).pipe(
			Effect.flatMap(({ items }) => {
				const subject = items.find(({ id }) => id === source.after.sourceEntityId);
				const associated = items.find(({ id }) => id === source.after.targetEntityId);
				if (!subject || !associated) {
					return Effect.succeed(null);
				}
				const population = source.population;
				if (subject.entitySchemaSlug !== "person" && subject.entitySchemaSlug !== "company") {
					return Effect.succeed(null);
				}
				if (
					population?.rootPreviouslyPopulated === false &&
					population.scopeEntity.id === subject.id
				) {
					return Effect.succeed(null);
				}

				const previousRoles = new Set(
					roles(source.operation === "update" ? source.before.properties : undefined),
				);
				const addedRoles = [...new Set(roles(source.after.properties))].filter(
					(role) => source.operation === "create" || !previousRoles.has(role),
				);
				const associationKind = associated.entitySchemaSlug.endsWith("-group")
					? "media-group"
					: "media";

				return Effect.all(
					addedRoles.map((role) =>
						host.emitSignal({
							subjectEntityId: subject.id,
							discriminator: `${subject.id}:${role}`,
							schemaSlug: `${subject.entitySchemaSlug}.${associationKind}.associated`,
							properties: { role, subjectName: subject.name, associatedName: associated.name },
						}),
					),
					{ concurrency: "unbounded" },
				);
			}),
		);
	},
});
