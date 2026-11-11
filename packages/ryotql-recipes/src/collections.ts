import {
	collectionFieldsToAppSchema,
	decodeCollectionFields,
	type KeyedCollectionField,
} from "@ryot-app/contract/modules/collections/fields";
import { EnrichmentState } from "@ryot-app/contract/modules/entities/schemas";
import {
	collectionPagePath,
	PluginClientCollectionPages,
} from "@ryot-app/contract/modules/plugins/manifest";
import {
	definitionOwner,
	ownerIdentityReference,
} from "@ryot-app/contract/modules/plugins/references";
import type { Controls } from "@ryot-app/contract/modules/ryotql/authored";
import { encodeEntitySourceReference } from "@ryot-app/contract/modules/ryotql/entity-source";
import {
	SavedViewDisplayValue,
	type SavedViewTableColumn,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { EntityId, PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import {
	type AppPropertyDefinition,
	type AppSchema as AppSchemaValue,
	getOrderedAppSchemaFieldEntries,
} from "@ryot-app/contract/schema/property-schema";
import type { Recipe } from "@ryot-app/ryotql";
import {
	and,
	ascending,
	castText,
	coalesce,
	column,
	concat,
	conditional,
	contains,
	countAll,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	exists,
	first,
	groupAscending,
	inArray,
	isNotNull,
	isNull,
	join,
	jsonPath,
	literal,
	not,
	relationshipSchemaPredicate,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	selectedOptionalRow,
	selectedRows,
	selectRecipe,
	table,
} from "@ryot-app/ryotql";
import { filter, parameters, sort } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

import { type BrowseSchema, ENTITY_IDS_PAGE_SIZE, type EntityIdsResult } from "./browse";
import { propertyFilterFields } from "./property-filter-fields";

const MembershipProperties = Schema.Record(Schema.String, JsonValue);

const collectionMembershipTables = () => {
	const membership = table("relationship", "collectionMembership");
	const entity = table("entity", "collectionMember");
	const ownerPlugin = table("plugin", "collectionMemberOwnerPlugin");
	return {
		entity,
		membership,
		ownerPlugin,
		entityJoin: join(
			"inner",
			entity,
			eq(column(membership, "sourceEntityId"), column(entity, "id")),
		),
		ownerPluginJoin: join(
			"left",
			ownerPlugin,
			eq(column(entity, "entitySchemaPluginId"), column(ownerPlugin, "id")),
		),
	};
};

const membershipFieldPrefix = "membership.";
export type CollectionMemberFields = {
	readonly schemas: readonly BrowseSchema[];
	readonly groups: CollectionMembersAggregateResult;
	readonly membershipPropertiesSchema: null | AppSchemaValue;
};

export const collectionControlFields = (schema: null | AppSchemaValue) =>
	schema === null
		? []
		: getOrderedAppSchemaFieldEntries(schema.fields).flatMap(([property, definition]) => {
				if (definition.secret === true) {
					return [];
				}
				const key = `${membershipFieldPrefix}${property}`;
				const result = propertyFilterFields(schema, [{ property, field: key }]);
				return Result.isFailure(result)
					? []
					: result.success.map((field) => Object.assign({}, field, { key }));
			});

const collectionTypeLabel = (input: {
	readonly entitySchemaSlug: string;
	readonly ownerPluginId: null | string;
	readonly ownerPluginName: null | string;
}) => {
	if (input.ownerPluginId === null && input.entitySchemaSlug === "collection") {
		return "Collections";
	}
	return input.ownerPluginName === null
		? input.entitySchemaSlug
		: `${input.ownerPluginName} / ${input.entitySchemaSlug}`;
};

const displayKindForMembershipField = (
	field: AppPropertyDefinition,
): SavedViewTableColumn["displayKind"] => {
	if (field.type === "string" || field.type === "enum") {
		return "text";
	}
	if (field.type === "number" || field.type === "integer") {
		return "number";
	}
	if (field.type === "boolean") {
		return "boolean";
	}
	if (field.type === "date" || field.type === "datetime") {
		return "date";
	}
	return "json";
};

type CollectionMemberColumnDescriptor = {
	readonly column: SavedViewTableColumn;
	readonly source: "name" | "type" | { readonly property: string };
};

const collectionMemberColumnDescriptors = (
	membershipPropertiesSchema: null | AppSchemaValue,
): readonly CollectionMemberColumnDescriptor[] => {
	const fields = getOrderedAppSchemaFieldEntries(membershipPropertiesSchema?.fields ?? {}).filter(
		([, definition]) => definition.secret !== true,
	);
	const usedKeys = new Set(fields.map(([field]) => field));
	const fixedKey = (base: string) => {
		let key = base;
		while (usedKeys.has(key)) {
			key = `_${key}`;
		}
		usedKeys.add(key);
		return key;
	};
	return [
		{ source: "name", column: { label: "Name", displayKind: "text", field: fixedKey("name") } },
		{ source: "type", column: { label: "Type", displayKind: "text", field: fixedKey("type") } },
		...fields.map(([field, definition]) => ({
			source: { property: field },
			column: {
				field,
				label: definition.label,
				displayKind: displayKindForMembershipField(definition),
			},
		})),
	];
};

export const collectionMemberTableColumns = (
	membershipPropertiesSchema: null | AppSchemaValue,
): readonly SavedViewTableColumn[] =>
	collectionMemberColumnDescriptors(membershipPropertiesSchema).map(
		({ column: tableColumn }) => tableColumn,
	);

const decodeDisplayValue = Schema.decodeUnknownResult(SavedViewDisplayValue);

const displayValue = (
	value: JsonValue | undefined,
	displayKind: SavedViewDisplayValue["displayKind"],
) =>
	Result.getOrElse(decodeDisplayValue({ displayKind, value: value ?? null }), () =>
		Result.getOrThrow(decodeDisplayValue({ displayKind, value: null })),
	);

const collectionMemberCells = (
	member: {
		readonly name: string;
		readonly entitySchemaSlug: string;
		readonly ownerPluginId: null | string;
		readonly ownerPluginName: null | string;
		readonly properties: Readonly<Record<string, JsonValue>>;
	},
	membershipPropertiesSchema: null | AppSchemaValue,
) => {
	const typeLabel = collectionTypeLabel(member);
	return collectionMemberColumnDescriptors(membershipPropertiesSchema).map(
		({ source, column: tableColumn }) => {
			let rawValue: JsonValue | undefined;
			if (source === "name") {
				rawValue = member.name;
			} else if (source === "type") {
				rawValue = typeLabel;
			} else {
				rawValue = member.properties[source.property];
			}
			return {
				key: tableColumn.field,
				label: tableColumn.label,
				value: displayValue(rawValue, tableColumn.displayKind),
			};
		},
	);
};

export const allCollectionsRecipe = (() => {
	const collection = table("entity", "collection");
	return defineRecipe({
		map: ({ collections }) => Result.succeed(collections),
		queries: {
			collections: selectedRows(collection, {
				limit: 20,
				maxLimit: 1000,
				orderBy: [ascending(column(collection, "name"))],
				where: entitySchemaPredicate(collection, "collection", { kind: "kernel" }),
				selection: {
					id: selectedField(column(collection, "id"), EntityId),
					name: selectedField(column(collection, "name"), Schema.String),
				},
			}),
		},
	});
})();

export type AllCollectionsResult = Recipe.Success<typeof allCollectionsRecipe>;

export const collectionMembershipTargetRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			entityId: {
				type: "string",
				label: "entityId",
				description: "Query argument",
				validation: { required: true },
			},
		},
	});

	const entity = table("entity", "collectionMembershipTarget");
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ target }) => Result.succeed(target ?? null),
		queries: {
			target: selectedOptionalRow(entity, {
				orderBy: [ascending(column(entity, "id"))],
				where: eq(column(entity, "id"), recipeParameters.value("entityId")),
				selection: { name: selectedField(column(entity, "name"), Schema.String) },
			}),
		},
	});
})();

export const collectionPickerRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			entityId: { type: "string", label: "entityId", description: "Query entityId" },
			search: { type: "string", label: "search", defaultValue: "", description: "Query search" },
		},
	});

	const collection = table("entity", "collectionOption");
	const membership = table("relationship", "optionMembership");
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ collections }) => Result.succeed(collections),
		queries: {
			collections: selectedRows(collection, {
				limit: 30,

				orderBy: [ascending(column(collection, "name")), ascending(column(collection, "id"))],
				where: and(
					entitySchemaPredicate(collection, "collection", { kind: "kernel" }),
					isNotNull(column(collection, "userId")),
					contains(column(collection, "name"), recipeParameters.value("search")),
				),
				selection: {
					id: selectedField(column(collection, "id"), EntityId),
					name: selectedField(column(collection, "name"), Schema.String),
					added: selectedField(
						conditional(
							not(
								recipeParameters.whenSet(
									"entityId",
									not(
										exists(membership, {
											where: and(
												relationshipSchemaPredicate(membership, "member-of", { kind: "kernel" }),
												eq(
													column(membership, "sourceEntityId"),
													recipeParameters.value("entityId"),
												),
												eq(column(membership, "targetEntityId"), column(collection, "id")),
											),
										}),
									),
								),
							),
							literal(true),
							literal(false),
						),
						Schema.Boolean,
					),
				},
			}),
		},
	});
})();

export type CollectionPickerResult = Recipe.Success<typeof collectionPickerRecipe>;

const collectionHeaderFields = (
	rawFields: JsonValue | undefined,
): {
	readonly membershipPropertiesSchema: null | AppSchemaValue;
	readonly fields: null | ReadonlyArray<KeyedCollectionField>;
} => {
	const fields = decodeCollectionFields(rawFields);
	if (Result.isFailure(fields)) {
		return { fields: null, membershipPropertiesSchema: null };
	}
	return {
		fields: fields.success,
		membershipPropertiesSchema:
			fields.success.length === 0 ? null : collectionFieldsToAppSchema(fields.success),
	};
};

export const collectionHeaderRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			collectionId: {
				type: "string",
				label: "collectionId",
				description: "Query argument",
				validation: { required: true },
			},
		},
	});

	const collection = table("entity", "collectionHeader");
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ collection: header }) => {
			if (header === undefined) {
				return Result.succeed(null);
			}
			const description = header.properties["description"];
			return Result.succeed({
				name: header.name,
				entityId: header.entityId,
				...collectionHeaderFields(header.properties["membershipFields"]),
				description: typeof description === "string" && description !== "" ? description : null,
			});
		},
		queries: {
			collection: selectedOptionalRow(collection, {
				orderBy: [ascending(column(collection, "id"))],
				where: and(
					eq(column(collection, "id"), recipeParameters.value("collectionId")),
					eq(column(collection, "entitySchemaSlug"), literal("collection")),
					isNull(column(collection, "entitySchemaPluginId")),
				),
				selection: {
					entityId: selectedField(column(collection, "id"), EntityId),
					name: selectedField(column(collection, "name"), Schema.String),
					properties: selectedField(column(collection, "properties"), MembershipProperties),
				},
			}),
		},
	});
})();

export type CollectionHeaderResult = Recipe.Success<typeof collectionHeaderRecipe>;

export const collectionMembershipRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			entityId: {
				type: "string",
				label: "entityId",
				description: "Query argument",
				validation: { required: true },
			},
			collectionId: {
				type: "string",
				label: "collectionId",
				description: "Query argument",
				validation: { required: true },
			},
		},
	});

	const membership = table("relationship", "collectionMembership");
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ membership: row }) => {
			if (row === undefined) {
				return Result.succeed(null);
			}
			const { rank: _rank, ...properties } = row.properties;
			return Result.succeed({ properties });
		},
		queries: {
			membership: selectedOptionalRow(membership, {
				orderBy: [ascending(column(membership, "id"))],
				selection: {
					properties: selectedField(column(membership, "properties"), MembershipProperties),
				},
				where: and(
					relationshipSchemaPredicate(membership, "member-of", { kind: "kernel" }),
					eq(column(membership, "sourceEntityId"), recipeParameters.value("entityId")),
					eq(column(membership, "targetEntityId"), recipeParameters.value("collectionId")),
				),
			}),
		},
	});
})();

export type CollectionMembershipResult = Recipe.Success<typeof collectionMembershipRecipe>;

const collectionRecipe = (input?: CollectionMemberFields) => {
	const recipeParameters = parameters({
		fields: {
			searchText: { type: "string", label: "Search", description: "Member name contains" },
			source: {
				type: "string",
				label: "Source",
				validation: { required: true },
				reference: { kind: "entity-source" },
				description: "Encoded collection entity source",
			},
			collectionId: {
				type: "string",
				label: "Collection",
				validation: { required: true },
				reference: { kind: "entity-id" },
				description: "Stored collection selection",
			},
		},
	});
	const source = recipeParameters.sourceEntity("source", "collectionSource");
	const { entity, membership, ownerPlugin, ownerPluginJoin } = collectionMembershipTables();
	const collection = table("entity", "collectionOrder");
	const joins = [
		join("inner", entity, eq(column(source, "entityId"), column(entity, "id"))),
		join(
			"inner",
			membership,
			and(
				eq(column(membership, "sourceEntityId"), column(entity, "id")),
				eq(column(membership, "targetEntityId"), recipeParameters.value("collectionId")),
				relationshipSchemaPredicate(membership, "member-of", { kind: "kernel" }),
			),
		),
		ownerPluginJoin,
	];
	const where = and(
		recipeParameters.whenSet(
			"searchText",
			contains(column(entity, "name"), recipeParameters.value("searchText")),
		),
		filter(),
	);
	const membershipFields = collectionControlFields(input?.membershipPropertiesSchema ?? null);
	const projectedProperties = Object.fromEntries(
		membershipFields.map((field) => [
			field.field,
			selectedField(
				jsonPath(column(membership, "properties"), field.field.slice(membershipFieldPrefix.length)),
				JsonValue,
			),
		]),
	);
	type OutputControlField = Extract<
		NonNullable<Controls["filter"]>,
		{ readonly kind: "outputs" }
	>["fields"][number];
	const addedAtField: OutputControlField = {
		type: "date",
		kind: "value",
		field: "addedAt",
		key: "date-added",
		label: "Date added",
		sort: {
			defaultDirection: "desc",
			ascending: "Oldest first",
			descending: "Newest first",
			label: "Date added to collection",
		},
	};
	const [memberType, ...otherMemberTypes] = (input?.groups.items ?? []).map((group) => ({
		label: group.typeLabel,
		value: `${group.ownerPluginId ?? ""}/${group.entitySchemaSlug}`,
	}));
	const outputFields: readonly OutputControlField[] = [
		...(memberType === undefined
			? []
			: [
					{
						type: "enum",
						kind: "value",
						label: "Type",
						key: "member-type",
						field: "member-type",
						choices: [memberType, ...otherMemberTypes],
					} as const,
				]),
		addedAtField,
		...membershipFields,
	];
	const outputs = { kind: "outputs", query: "members", fields: outputFields } as const;
	const [schema, ...otherSchemas] = (input?.schemas ?? []).map(({ slug, pluginId }) => ({
		slug,
		owner: ownerIdentityReference(definitionOwner(pluginId)),
	}));
	const target: NonNullable<Controls["filter"]> =
		schema === undefined
			? outputs
			: {
					kind: "composite",
					targets: [
						{ kind: "browse", alias: entity.alias, schemas: [schema, ...otherSchemas] },
						outputs,
					],
				};
	const sortOutputs = { kind: "outputs", query: "members", fields: [addedAtField] } as const;
	const sortTarget: NonNullable<Controls["sort"]> =
		schema === undefined
			? {
					...sortOutputs,
					fields: [
						{
							key: "name",
							type: "text",
							kind: "value",
							field: "name",
							label: "Name",
							sort: { label: "Name", ascending: "A–Z", descending: "Z–A", defaultDirection: "asc" },
						},
						addedAtField,
					],
				}
			: {
					kind: "composite",
					targets: [
						{ kind: "browse", alias: entity.alias, schemas: [schema, ...otherSchemas] },
						sortOutputs,
					],
				};

	const members = selectedRows(source, {
		joins,
		where,
		limit: 20,
		maxLimit: 1000,
		orderBy: sort([ascending(column(source, "rank")), ascending(column(entity, "id"))]),
		selection: {
			...projectedProperties,
			entityId: selectedField(column(entity, "id"), EntityId),
			name: selectedField(column(entity, "name"), Schema.String),
			addedAt: selectedField(column(membership, "createdAt"), Schema.String),
			properties: selectedField(column(membership, "properties"), MembershipProperties),
			entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
			populationStatus: selectedField(column(entity, "populationStatus"), EnrichmentState),
			translationStatus: selectedField(column(entity, "translationStatus"), EnrichmentState),
			ownerPluginName: selectedField(column(ownerPlugin, "name"), Schema.NullOr(Schema.String)),
			ownerPluginId: selectedField(
				column(entity, "entitySchemaPluginId"),
				Schema.NullOr(Schema.String),
			),
			"member-type": selectedField(
				concat(
					coalesce(castText(column(entity, "entitySchemaPluginId")), literal("")),
					literal("/"),
					column(entity, "entitySchemaSlug"),
				),
				Schema.String,
			),
			orderRevision: selectedField(
				coalesce(
					first(collection, {
						orderBy: [ascending(column(collection, "id"))],
						select: column(collection, "collectionOrderRevision"),
						where: eq(column(collection, "id"), recipeParameters.value("collectionId")),
					}),
					literal(0),
				),
				Schema.Int,
			),
		},
	});
	return defineRecipe({
		parameters: recipeParameters.schema,
		controls: { filter: target, sort: sortTarget },
		queries: {
			count: selectedAggregate(source, {
				joins,
				where,
				measures: {
					total: selectedMeasure(
						{ function: "countDistinct", expr: column(entity, "id") },
						Schema.Finite,
					),
				},
			}),
			memberIds: selectedRows(source, {
				joins,
				where,
				limit: ENTITY_IDS_PAGE_SIZE,
				maxLimit: ENTITY_IDS_PAGE_SIZE,
				orderBy: [ascending(column(entity, "id"))],
				selection: { entityId: selectedField(column(entity, "id"), EntityId) },
			}),
			members: {
				document: members.document,
				decodeResult: (result: unknown) =>
					Result.map(members.decodeResult(result), (page) => ({
						pageInfo: page.pageInfo,
						stale: page.pageInfo.stale ?? false,
						orderRevision:
							page.items[0]?.orderRevision ??
							Object.values(page.pageInfo.sourceRevisions ?? {})[0] ??
							0,
						items: page.items.map((member) => ({
							name: member.name,
							presentation: null,
							entityId: member.entityId,
							ownerPluginId: member.ownerPluginId,
							entitySchemaSlug: member.entitySchemaSlug,
							cells: collectionMemberCells(member, input?.membershipPropertiesSchema ?? null),
							sync: {
								populationStatus: member.populationStatus,
								translationStatus: member.translationStatus,
							},
						})),
					})),
			},
		},
	});
};
export const collectionMembersRecipe = (input?: { readonly fields?: CollectionMemberFields }) =>
	selectRecipe(collectionRecipe(input?.fields), "members");
export const collectionMemberIdsRecipe = (input?: { readonly fields?: CollectionMemberFields }) => {
	const recipe = selectRecipe(collectionRecipe(input?.fields), "memberIds");
	return {
		...recipe,
		decode: (response: unknown) =>
			Result.map(recipe.decode(response), (page): EntityIdsResult => ({
				...page,
				items: page.items.map(({ entityId }) => entityId),
			})),
	};
};
export const collectionMembersCountRecipe = (input?: {
	readonly fields?: CollectionMemberFields;
}) => {
	const recipe = selectRecipe(collectionRecipe(input?.fields), "count");
	return {
		...recipe,
		decode: (response: unknown) => Result.map(recipe.decode(response), ({ total }) => total),
	};
};
export type CollectionMembersResult = Recipe.Success<ReturnType<typeof collectionMembersRecipe>>;
export type CollectionMembersCountResult = Recipe.Success<
	ReturnType<typeof collectionMembersCountRecipe>
>;

export const collectionMembersCountsRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			collectionIds: {
				type: "array",
				label: "collectionIds",
				description: "Query argument",
				validation: { required: true },
				items: {
					type: "string",
					label: "Value",
					validation: { required: true },
					description: "Query argument value",
				},
			},
		},
	});

	const membership = table("relationship", "collectionMembershipCounts");
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ collectionMembersCounts }) =>
			Result.succeed(
				Object.fromEntries(
					collectionMembersCounts.items.map(({ total, collectionId }) => [collectionId, total]),
				),
			),
		queries: {
			collectionMembersCounts: selectedAggregate(membership, {
				groupBy: {
					collectionId: selectedField(column(membership, "targetEntityId"), Schema.String),
				},
				measures: {
					total: selectedMeasure(
						{ function: "countDistinct", expr: column(membership, "sourceEntityId") },
						Schema.Finite,
					),
				},
				where: and(
					relationshipSchemaPredicate(membership, "member-of", { kind: "kernel" }),
					inArray(column(membership, "targetEntityId"), recipeParameters.list("collectionIds")),
				),
			}),
		},
	});
})();

export type CollectionMembersCountsResult = Recipe.Success<typeof collectionMembersCountsRecipe>;

export const collectionMembersAggregateRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			source: {
				type: "string",
				label: "Source",
				validation: { required: true },
				reference: { kind: "entity-source" },
				description: "Encoded collection entity source",
			},
			collectionId: {
				type: "string",
				label: "Collection",
				validation: { required: true },
				reference: { kind: "entity-id" },
				description: "Stored collection selection",
			},
		},
	});
	const source = recipeParameters.sourceEntity("source", "collectionAggregateSource");
	const { entity, membership, entityJoin, ownerPlugin, ownerPluginJoin } =
		collectionMembershipTables();
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ aggregate }) =>
			Result.succeed({
				...aggregate,
				items: aggregate.items.map((group) => ({
					...group,
					typeLabel: collectionTypeLabel(group),
				})),
			}),
		queries: {
			aggregate: selectedAggregate(source, {
				limit: 100,
				measures: { count: countAll },
				joins: [
					join(
						"inner",
						membership,
						and(
							eq(column(source, "entityId"), column(membership, "sourceEntityId")),
							eq(column(membership, "targetEntityId"), recipeParameters.value("collectionId")),
							relationshipSchemaPredicate(membership, "member-of", { kind: "kernel" }),
						),
					),
					entityJoin,
					ownerPluginJoin,
				],

				orderBy: [groupAscending("ownerPluginId"), groupAscending("entitySchemaSlug")],
				groupBy: {
					entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
					ownerPluginName: selectedField(column(ownerPlugin, "name"), Schema.NullOr(Schema.String)),
					ownerPluginId: selectedField(
						column(entity, "entitySchemaPluginId"),
						Schema.NullOr(Schema.String),
					),
				},
			}),
		},
	});
})();

export type CollectionMembersAggregateResult = Recipe.Success<
	typeof collectionMembersAggregateRecipe
>;

export const collectionPluginPagesRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			pluginIds: {
				type: "array",
				label: "pluginIds",
				description: "Query argument",
				validation: { required: true },
				items: {
					type: "string",
					label: "Value",
					validation: { required: true },
					description: "Query argument value",
				},
			},
		},
	});

	const plugin = table("plugin", "collectionPagesPlugin");
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ plugins }) => Result.succeed(plugins.items),
		queries: {
			plugins: selectedRows(plugin, {
				limit: 100,
				orderBy: [ascending(column(plugin, "packageId")), ascending(column(plugin, "id"))],
				where: and(
					inArray(column(plugin, "id"), recipeParameters.list("pluginIds")),
					eq(column(plugin, "status"), literal("active")),
					isNotNull(column(plugin, "clientCollectionPages")),
				),
				selection: {
					pluginId: selectedField(column(plugin, "id"), PluginId),
					packageId: selectedField(column(plugin, "packageId"), PluginPackageId),
					pages: selectedField(
						column(plugin, "clientCollectionPages"),
						PluginClientCollectionPages,
					),
				},
			}),
		},
	});
})();

export type CollectionPluginPagesResult = Recipe.Success<typeof collectionPluginPagesRecipe>;

export const collectionPageLinks = (
	collectionId: string,
	groups: CollectionMembersAggregateResult,
	plugins: CollectionPluginPagesResult,
) =>
	plugins.flatMap((plugin) =>
		Object.values(plugin.pages).flatMap((page) =>
			groups.items.some(
				(group) =>
					group.ownerPluginId === plugin.pluginId &&
					page.entitySchemaSlugs.includes(group.entitySchemaSlug),
			)
				? [
						{
							icon: page.icon,
							label: page.label,
							packageId: plugin.packageId,
							path: collectionPagePath(page.route, collectionId),
						},
					]
				: [],
		),
	);

export const collectionArguments = (collectionId: string) => ({
	collectionId,
	source: encodeEntitySourceReference({
		kind: "collection",
		collectionId: EntityId.make(collectionId),
	}),
});
