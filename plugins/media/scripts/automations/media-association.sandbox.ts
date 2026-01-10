import { defineAutomation } from "@ryot/sandbox-sdk/automation";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";

export const manifest = defineManifest({
	kind: "automation",
	requiredAppConfigKeys: [],
	capabilities: ["emitSignal"],
	name: "Media Association Detector",
	slug: "automation.media-association",
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
		const source = automation.source;
		if (source.kind !== "relationship" || automation.operation === "delete" || !source.after) {
			return Effect.succeed(null);
		}

		const subject = source.after.source;
		if (subject.entitySchemaSlug !== "person" && subject.entitySchemaSlug !== "company") {
			return Effect.succeed(null);
		}
		if (
			automation.population?.rootPreviouslyPopulated === false &&
			automation.population.scopeEntity.id === subject.id
		) {
			return Effect.succeed(null);
		}

		const previousRoles = new Set(roles(source.before?.properties));
		const addedRoles = [...new Set(roles(source.after.properties))].filter(
			(role) => automation.operation === "create" || !previousRoles.has(role),
		);
		const associated = source.after.target;
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
	},
});
