import { EntityUserDataBadRequest } from "@ryot-app/contract/modules/entity-user-data/schemas";
import type { PluginEntityUserStatePolicy } from "@ryot-app/contract/modules/plugins/manifest";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Effect } from "effect";

import type { DefinitionRepository } from "#modules/definitions/repository";

import type { EntityUserDataGraphRepository } from "./graph-repository";

export const userStateEvidence = Effect.fn("userStateEvidence")(function* (
	repository: EntityUserDataGraphRepository["Service"],
	input: {
		userId: UserId;
		pluginId: null | string;
		entityIds: readonly EntityId[];
		policy: undefined | PluginEntityUserStatePolicy;
	},
) {
	return (yield* Effect.forEach(input.policy?.evidence ?? [], (declaration) =>
		repository
			.listEvidence({ ...input, evidence: declaration })
			.pipe(Effect.map((items) => items.map((item) => ({ ...item, declaration })))),
	)).flat();
});

export const userStateGraph = Effect.fn("userStateGraph")(function* (
	repository: EntityUserDataGraphRepository["Service"],
	input: {
		userId: UserId;
		entityId: EntityId;
		pluginId: null | string;
		policy: undefined | PluginEntityUserStatePolicy;
	},
) {
	const children = yield* Effect.forEach(input.policy?.children ?? [], (child) =>
		repository
			.listChildren({ ...input, child })
			.pipe(Effect.map((items) => ({ items, declaration: child }))),
	);
	const entityIds = [
		...new Set([input.entityId, ...children.flatMap(({ items }) => items.map(({ id }) => id))]),
	];
	const evidence = yield* userStateEvidence(repository, { ...input, entityIds });
	return { children, evidence, entityIds, currentEntityIds: [...entityIds] };
});

export type UserStateGraph = Effect.Success<ReturnType<typeof userStateGraph>>;

export const mergeChildReferences = (
	source: UserStateGraph,
	target: UserStateGraph,
	requiredIds: ReadonlySet<string>,
) => {
	const references: { from: EntityId; into: EntityId }[] = [];
	const conflicts: { id: EntityId; name: string; identity: string }[] = [];
	const currentTargets = new Set(target.currentEntityIds);
	for (const [index, group] of source.children.entries()) {
		const declaration = group.declaration;
		const key = (item: (typeof group.items)[number]) =>
			stableStringify([
				...declaration.identityProperties.map((property) => item.properties[property] ?? null),
				...(declaration.matchName ? [item.name.trim().toLowerCase()] : []),
			]);
		const sourceCounts = new Map<string, number>();
		for (const item of group.items) {
			const identity = key(item);
			sourceCounts.set(identity, (sourceCounts.get(identity) ?? 0) + 1);
		}
		const destinations = new Map<string, typeof group.items>();
		for (const item of target.children[index]?.items ?? []) {
			if (currentTargets.has(item.id)) {
				const identity = key(item);
				const matches = destinations.get(identity) ?? [];
				matches.push(item);
				destinations.set(identity, matches);
			}
		}
		for (const child of group.items) {
			if (!requiredIds.has(child.id)) {
				continue;
			}
			const identity = key(child);
			const candidates = destinations.get(identity) ?? [];
			const [match] = candidates;
			if (
				match === undefined ||
				candidates.length !== 1 ||
				sourceCounts.get(identity) !== 1 ||
				declaration.identityProperties.some(
					(property) =>
						child.properties[property] === undefined || child.properties[property] === null,
				)
			) {
				conflicts.push({
					id: child.id,
					name: child.name,
					identity: declaration.identityProperties
						.map(
							(property) =>
								`${property}=${JSON.stringify(child.properties[property] ?? "missing")}`,
						)
						.join(", ")
						.slice(0, 256),
				});
			} else {
				references.push({ from: child.id, into: match.id });
			}
		}
	}
	return conflicts.length === 0
		? Effect.succeed(references)
		: Effect.fail(
				new EntityUserDataBadRequest({
					reason: {
						code: "child-mapping-conflict",
						entityIds: conflicts.slice(0, 10).map(({ id }) => id),
						message: `Cannot merge ${conflicts.length} child item(s) without a unique matching destination: ${conflicts
							.slice(0, 10)
							.map(({ name, identity }) => `${name.slice(0, 160)} (${identity})`)
							.join(
								"; ",
							)}${conflicts.length > 10 ? "; showing the first 10" : ""}. Refresh source data or correct the custom child names and identity fields, then try again. No data was moved.`,
					},
				}),
			);
};

const rewriteValue = (
	definition: AppPropertyDefinition,
	value: unknown,
	references: ReadonlyMap<string, string>,
): unknown => {
	if (
		definition.type === "string" &&
		definition.reference?.kind === "entity-id" &&
		typeof value === "string"
	) {
		return references.get(value) ?? value;
	}
	if (definition.type === "object" && isObjectRecord(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				definition.properties[key]
					? rewriteValue(definition.properties[key], item, references)
					: item,
			]),
		);
	}
	if (definition.type === "array" && Array.isArray(value)) {
		return value.map((item) => rewriteValue(definition.items, item, references));
	}
	return value;
};

export const embeddedEntityReferences = (
	properties: Readonly<Record<string, unknown>>,
	schema: AppSchema,
) => {
	const ids = new Set<string>();
	const visit = (definition: AppPropertyDefinition, value: unknown): void => {
		if (
			definition.type === "string" &&
			definition.reference?.kind === "entity-id" &&
			typeof value === "string"
		) {
			ids.add(value);
		}
		if (definition.type === "object" && isObjectRecord(value)) {
			for (const [key, child] of Object.entries(definition.properties)) {
				visit(child, value[key]);
			}
		}
		if (definition.type === "array" && Array.isArray(value)) {
			for (const item of value) {
				visit(definition.items, item);
			}
		}
	};
	for (const [key, definition] of Object.entries(schema.fields)) {
		visit(definition, properties[key]);
	}
	return [...ids];
};

export const rewriteEntityProperties = (
	properties: Readonly<Record<string, unknown>>,
	schema: AppSchema,
	references: ReadonlyMap<string, string>,
) =>
	Object.fromEntries(
		Object.entries(properties).map(([key, value]) => [
			key,
			schema.fields[key] ? rewriteValue(schema.fields[key], value, references) : value,
		]),
	);

export const evidenceSchemas = Effect.fn("evidenceSchemas")(function* (
	definitions: DefinitionRepository["Service"],
	userId: UserId,
	pluginId: null | string,
	graph: UserStateGraph,
) {
	const authored = graph.evidence.map(({ declaration }) => ({
		slug: declaration.eventSchema.entitySchemaSlug,
		owner:
			declaration.eventSchema.owner.kind === "kernel"
				? definitionOwner(null)
				: definitionOwner(pluginId),
	}));
	const references = [
		...new Map(
			authored.map((reference) => [
				definitionKey("entity", reference.owner, reference.slug),
				reference,
			]),
		).values(),
	];
	const schemas =
		references.length === 0 ? {} : yield* definitions.findUserEntitySchemas(userId, references);
	return new Map(
		graph.evidence.map((item) => {
			const reference = item.declaration.eventSchema;
			const owner =
				reference.owner.kind === "kernel" ? definitionOwner(null) : definitionOwner(pluginId);
			const schema =
				schemas[definitionKey("entity", owner, reference.entitySchemaSlug)]?.eventSchemas[
					reference.slug
				]?.propertiesSchema;
			return [item.id, schema];
		}),
	);
});
