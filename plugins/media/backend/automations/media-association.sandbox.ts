import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { entityReadRecipe, executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";
import type { JsonValue } from "@ryot-app/plugin-backend-sdk/wire";

import { type CreditRoleCode, isCreditRoleCode } from "../../shared/credit-roles";
import { builtinMediaEntitySchemaSlugs } from "../../shared/media-schema-slugs";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	name: "Media Association Detector",
	slug: "automation.media-association",
	inputProjection: {
		relationship: {
			compareProperties: [],
			parentEntityProperties: [],
			properties: ["roles", "roleCodes"],
		},
	},
});

type AssociatedRole = { readonly role: string } | { readonly roleCode: CreditRoleCode };

const strings = (properties: undefined | Readonly<Record<string, JsonValue>>, key: string) => {
	const value = properties?.[key];
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
};

const roleKey = (role: AssociatedRole) =>
	"role" in role ? `role:${role.role}` : `role-code:${role.roleCode}`;

const associatedRoles = (
	properties: undefined | Readonly<Record<string, JsonValue>>,
): AssociatedRole[] => [
	...[...new Set(strings(properties, "roles"))].map((role) => ({ role })),
	...strings(properties, "roleCodes")
		.filter(isCreditRoleCode)
		.map((roleCode) => ({ roleCode })),
];

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
			entityReadRecipe,
			{ entityIds: [head, ...rest] },
			{ pages: { entities: { after: undefined, limit: undefined } } },
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
							associatedRoles(
								change.operation === "update" ? change.before.properties : undefined,
							).map(roleKey),
						);
						const addedRoles = associatedRoles(change.after.properties).filter(
							(role) => change.operation === "create" || !previousRoles.has(roleKey(role)),
						);
						const associationKind = associated.entitySchemaSlug.endsWith("-group")
							? "media-group"
							: "media";
						return addedRoles.map((role) =>
							host.emitSignal({
								subjectEntityId: subject.id,
								discriminator: `${subject.id}:${roleKey(role)}`,
								schemaSlug: `${subject.entitySchemaSlug}.${associationKind}.associated`,
								properties: { ...role, subjectName: subject.name, associatedName: associated.name },
							}),
						);
					}),
					{ concurrency: "unbounded" },
				),
			),
		);
	},
});
