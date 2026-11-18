import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { entityReadRecipe, executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";
import type { JsonValue } from "@ryot-app/plugin-backend-sdk/wire";
import type { EntityId } from "@ryot-app/plugin-kit/schema";

import {
	type CreditRoleCode,
	isCreditRoleCode,
	type MediaAssociation,
} from "../../shared/credit-roles";
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
			return Effect.succeed({});
		}
		const changes = source.items.flatMap((item) => (item.operation === "delete" ? [] : [item]));
		const [head, ...rest] = [
			...new Set(changes.flatMap(({ after }) => [after.sourceEntityId, after.targetEntityId])),
		];
		if (head === undefined) {
			return Effect.succeed({});
		}
		return executeRyotqlRecipe(
			host.executeRyotql,
			entityReadRecipe,
			{ entityIds: [head, ...rest] },
			{ pages: { entities: { after: undefined, limit: undefined } } },
		).pipe(
			Effect.map(({ items }) => {
				const signals = new Map<
					string,
					{
						keys: Set<string>;
						schemaSlug: string;
						subjectName: string;
						subjectEntityId: EntityId;
						associations: MediaAssociation[];
					}
				>();
				for (const change of changes) {
					const subject = items.find(({ id }) => id === change.after.sourceEntityId);
					const associated = items.find(({ id }) => id === change.after.targetEntityId);
					if (
						!subject ||
						!associated ||
						(subject.entitySchemaSlug !== "person" && subject.entitySchemaSlug !== "company") ||
						!(
							associated.entitySchemaSlug.endsWith("-group") ||
							builtinMediaEntitySchemaSlugs.some((slug) => slug === associated.entitySchemaSlug)
						)
					) {
						continue;
					}
					const population = change.population;
					if (
						population?.rootPreviouslyPopulated === false &&
						population.scopeEntity.id === subject.id
					) {
						continue;
					}
					const previousRoles = new Set(
						associatedRoles(
							change.operation === "update" ? change.before.properties : undefined,
						).map(roleKey),
					);
					const addedRoles = associatedRoles(change.after.properties).filter(
						(role) => change.operation === "create" || !previousRoles.has(roleKey(role)),
					);
					if (addedRoles.length === 0) {
						continue;
					}
					const associationKind = associated.entitySchemaSlug.endsWith("-group")
						? "media-group"
						: "media";
					const schemaSlug = `${subject.entitySchemaSlug}.${associationKind}.associated`;
					const signal = signals.get(`${subject.id}:${schemaSlug}`) ?? {
						schemaSlug,
						keys: new Set(),
						associations: [],
						subjectName: subject.name,
						subjectEntityId: subject.id,
					};
					for (const role of addedRoles) {
						const key = `${associated.id}:${roleKey(role)}`;
						if (!signal.keys.has(key)) {
							signal.keys.add(key);
							signal.associations.push({
								...role,
								associatedName: associated.name,
								associatedEntityId: associated.id,
							});
						}
					}
					signals.set(`${subject.id}:${schemaSlug}`, signal);
				}
				return signals.size > 0
					? {
							changes: {
								signals: [...signals.values()].map(
									({ schemaSlug, subjectName, associations, subjectEntityId }) => ({
										schemaSlug,
										subjectEntityId,
										properties: { subjectName, associations },
										discriminator: `${subjectEntityId}:${automation.runId}`,
									}),
								),
							},
						}
					: {};
			}),
		);
	},
});
