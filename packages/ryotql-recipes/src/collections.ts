import {
	appSchemaToCollectionFields,
	collectionFieldsToAppSchema,
	type KeyedCollectionField,
} from "@ryot-app/contract/modules/collections/fields";
import { PopulationStatus, TranslationStatus } from "@ryot-app/contract/modules/entities/schemas";
import type { QueryFilterField } from "@ryot-app/contract/modules/filters/schemas";
import type { Predicate } from "@ryot-app/contract/modules/ryotql/language";
import {
	SavedViewDisplayValue,
	type SavedViewTableColumn,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { EntityId, RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
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
	castNumber,
	castText,
	coalesce,
	column,
	concat,
	contains,
	defineRecipe,
	descending,
	entitySchemaPredicate,
	eq,
	exists,
	groupAscending,
	inArray,
	isNotNull,
	isNull,
	join,
	jsonPath,
	literal,
	relationshipSchemaPredicate,
	rows,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import {
	compileOptionalFilter,
	type FilterInput,
	type QueryRelationshipFilterField,
} from "./filters";
import { propertyFilterFields } from "./property-filter-fields";

const MembershipProperties = Schema.Record(Schema.String, JsonValue);

export const CollectionMemberSort = Schema.Literals([
	"collection-order",
	"name-asc",
	"name-desc",
	"recently-added",
	"oldest-added",
]);
export type CollectionMemberSort = typeof CollectionMemberSort.Type;

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

const collectionMembershipWhere = (
	membership: ReturnType<typeof table>,
	entity: ReturnType<typeof table>,
	collectionId: string,
	searchText?: string,
	filter?: Predicate,
) => {
	const search = searchText?.trim();
	return and(
		eq(column(membership, "targetEntityId"), literal(collectionId)),
		relationshipSchemaPredicate(membership, "member-of", { kind: "kernel" }),
		...(search ? [contains(column(entity, "name"), literal(search))] : []),
		...(filter ? [filter] : []),
	);
};

const memberTypeField = "memberType";
const membershipFieldPrefix = "membership.";

const collectionMemberTypeValue = (group: {
	readonly entitySchemaSlug: string;
	readonly ownerPluginId: string | null;
}) => `${group.ownerPluginId ?? ""}/${group.entitySchemaSlug}`;

const alsoInCollectionField: QueryRelationshipFilterField = {
	key: "collections",
	kind: "relationship",
	direction: "outgoing",
	label: "Also in collection",
	relationship: { owner: { kind: "kernel" }, slug: RelationshipSchemaSlug.make("member-of") },
};

export const collectionMemberFilterFields = (input: {
	readonly groups: CollectionMembersAggregateResult;
	readonly membershipPropertiesSchema: AppSchemaValue | null;
}): readonly QueryFilterField[] => {
	const [firstType, ...otherTypes] = input.groups.items.map((group) => ({
		label: group.typeLabel,
		value: collectionMemberTypeValue(group),
	}));
	const schema = input.membershipPropertiesSchema;
	return [
		...(firstType === undefined
			? []
			: [
					{
						key: "type",
						type: "enum",
						label: "Type",
						kind: "value",
						field: memberTypeField,
						choices: [firstType, ...otherTypes],
					} as const,
				]),
		alsoInCollectionField,
		...(schema === null
			? []
			: getOrderedAppSchemaFieldEntries(schema.fields).flatMap(([property, definition]) => {
					const key = `${membershipFieldPrefix}${property}`;
					const result = propertyFilterFields(schema, [{ property, field: key }]);
					return definition.secret === true || Result.isFailure(result)
						? []
						: result.success.map((valueField) => Object.assign({}, valueField, { key }));
				})),
	];
};

const collectionMemberFilter = (
	tables: ReturnType<typeof collectionMembershipTables>,
	fields: readonly QueryFilterField[],
	input: FilterInput,
) => {
	const { entity, membership, entityJoin, ownerPluginJoin } = tables;
	const projections = fields.flatMap((filterField) =>
		filterField.kind !== "value"
			? []
			: [
					{
						key: filterField.field,
						expr:
							filterField.field === memberTypeField
								? concat(
										coalesce(castText(column(entity, "entitySchemaPluginId")), literal("")),
										literal("/"),
										column(entity, "entitySchemaSlug"),
									)
								: jsonPath(
										column(membership, "properties"),
										filterField.field.slice(membershipFieldPrefix.length),
									),
					},
				],
	);
	const predicate = Result.getOrThrow(
		compileOptionalFilter(input, {
			fields,
			subject: { entityAlias: entity.alias },
			source: rows(membership, { fields: projections, joins: [entityJoin, ownerPluginJoin] }),
		}),
	);
	return { predicate, projections };
};

const collectionTypeLabel = (input: {
	readonly entitySchemaSlug: string;
	readonly ownerPluginId: string | null;
	readonly ownerPluginName: string | null;
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
	membershipPropertiesSchema: AppSchemaValue | null,
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
	membershipPropertiesSchema: AppSchemaValue | null,
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
		readonly ownerPluginId: string | null;
		readonly ownerPluginName: string | null;
		readonly properties: Readonly<Record<string, JsonValue>>;
	},
	membershipPropertiesSchema: AppSchemaValue | null,
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

const collectionMemberOrder = (
	sort: CollectionMemberSort,
	membership: ReturnType<typeof table>,
	entity: ReturnType<typeof table>,
) => {
	const name = column(entity, "name");
	const entityId = column(entity, "id");
	if (sort === "collection-order") {
		return [
			ascending(castNumber(jsonPath(column(membership, "properties"), "rank"))),
			ascending(name),
			ascending(entityId),
		];
	}
	if (sort === "name-desc") {
		return [descending(name), ascending(entityId)];
	}
	if (sort === "recently-added") {
		return [descending(column(membership, "createdAt")), ascending(entityId)];
	}
	if (sort === "oldest-added") {
		return [ascending(column(membership, "createdAt")), ascending(entityId)];
	}
	return [ascending(name), ascending(entityId)];
};

export const allCollectionsRecipe = defineRecipe(
	(input: { readonly after?: string | undefined; readonly limit?: number | undefined } = {}) => {
		const collection = table("entity", "collection");
		return {
			map: ({ collections }) => Result.succeed(collections),
			queries: {
				collections: selectedRows(collection, {
					after: input.after,
					limit: input.limit,
					orderBy: [ascending(column(collection, "name"))],
					where: entitySchemaPredicate(collection, "collection", { kind: "kernel" }),
					selection: {
						id: selectedField(column(collection, "id"), EntityId),
						name: selectedField(column(collection, "name"), Schema.String),
					},
				}),
			},
		};
	},
);

export type AllCollectionsResult = Recipe.Success<typeof allCollectionsRecipe>;

export const collectionMembershipTargetRecipe = defineRecipe(
	(input: { readonly entityId: string }) => {
		const entity = table("entity", "collectionMembershipTarget");
		return {
			map: ({ target }) => Result.succeed(target ?? null),
			queries: {
				target: selectedOptionalRow(entity, {
					orderBy: [ascending(column(entity, "id"))],
					where: eq(column(entity, "id"), literal(input.entityId)),
					selection: { name: selectedField(column(entity, "name"), Schema.String) },
				}),
			},
		};
	},
);

export const collectionPickerRecipe = defineRecipe(
	(input: { readonly entityId: string; readonly search: string; readonly after?: string }) => {
		const collection = table("entity", "collectionOption");
		const membership = table("relationship", "optionMembership");
		return {
			map: ({ collections }) => Result.succeed(collections),
			queries: {
				collections: selectedRows(collection, {
					limit: 30,
					after: input.after,
					orderBy: [ascending(column(collection, "name")), ascending(column(collection, "id"))],
					where: and(
						entitySchemaPredicate(collection, "collection", { kind: "kernel" }),
						isNotNull(column(collection, "userId")),
						...(input.search.trim() === ""
							? []
							: [contains(column(collection, "name"), literal(input.search.trim()))]),
					),
					selection: {
						id: selectedField(column(collection, "id"), EntityId),
						name: selectedField(column(collection, "name"), Schema.String),
						added: selectedField(
							exists(membership, {
								where: and(
									relationshipSchemaPredicate(membership, "member-of", { kind: "kernel" }),
									eq(column(membership, "sourceEntityId"), literal(input.entityId)),
									eq(column(membership, "targetEntityId"), column(collection, "id")),
								),
							}),
							Schema.Boolean,
						),
					},
				}),
			},
		};
	},
);

export type CollectionPickerResult = Recipe.Success<typeof collectionPickerRecipe>;

const collectionHeaderFields = (
	rawSchema: JsonValue | undefined,
): {
	readonly fields: ReadonlyArray<KeyedCollectionField> | null;
	readonly membershipPropertiesSchema: AppSchemaValue | null;
} => {
	if (rawSchema === undefined || rawSchema === null) {
		return { fields: [], membershipPropertiesSchema: null };
	}
	const fields = appSchemaToCollectionFields(rawSchema);
	if (Result.isFailure(fields)) {
		return { fields: null, membershipPropertiesSchema: null };
	}
	return {
		fields: fields.success,
		membershipPropertiesSchema:
			fields.success.length === 0 ? null : collectionFieldsToAppSchema(fields.success),
	};
};

export const collectionHeaderRecipe = defineRecipe((input: { readonly collectionId: string }) => {
	const collection = table("entity", "collectionHeader");
	return {
		map: ({ collection: header }) => {
			if (header === undefined) {
				return Result.succeed(null);
			}
			const description = header.properties["description"];
			return Result.succeed({
				name: header.name,
				entityId: header.entityId,
				...collectionHeaderFields(header.properties["membershipPropertiesSchema"]),
				description: typeof description === "string" && description !== "" ? description : null,
			});
		},
		queries: {
			collection: selectedOptionalRow(collection, {
				orderBy: [ascending(column(collection, "id"))],
				where: and(
					eq(column(collection, "id"), literal(input.collectionId)),
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
	};
});

export type CollectionHeaderResult = Recipe.Success<typeof collectionHeaderRecipe>;

export const collectionMembershipRecipe = defineRecipe(
	(input: { readonly collectionId: string; readonly entityId: string }) => {
		const membership = table("relationship", "collectionMembership");
		return {
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
						eq(column(membership, "sourceEntityId"), literal(input.entityId)),
						eq(column(membership, "targetEntityId"), literal(input.collectionId)),
					),
				}),
			},
		};
	},
);

export type CollectionMembershipResult = Recipe.Success<typeof collectionMembershipRecipe>;

export const collectionMembersRecipe = defineRecipe(
	(
		input: FilterInput & {
			readonly after?: string | undefined;
			readonly limit?: number | undefined;
			readonly collectionId: string;
			readonly searchText?: string | undefined;
			readonly sort?: CollectionMemberSort | undefined;
			readonly filterFields?: readonly QueryFilterField[] | undefined;
			readonly membershipPropertiesSchema: AppSchemaValue | null;
		},
	) => {
		const tables = collectionMembershipTables();
		const { entity, membership, entityJoin, ownerPlugin, ownerPluginJoin } = tables;
		const { predicate, projections } = collectionMemberFilter(
			tables,
			input.filterFields ?? [],
			input,
		);
		const members = selectedRows(membership, {
			after: input.after,
			limit: input.limit,
			joins: [entityJoin, ownerPluginJoin],
			orderBy: collectionMemberOrder(input.sort ?? "collection-order", membership, entity),
			where: collectionMembershipWhere(
				membership,
				entity,
				input.collectionId,
				input.searchText,
				predicate,
			),
			selection: {
				entityId: selectedField(column(entity, "id"), EntityId),
				name: selectedField(column(entity, "name"), Schema.String),
				properties: selectedField(column(membership, "properties"), MembershipProperties),
				entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
				populationStatus: selectedField(column(entity, "populationStatus"), PopulationStatus),
				translationStatus: selectedField(column(entity, "translationStatus"), TranslationStatus),
				ownerPluginName: selectedField(column(ownerPlugin, "name"), Schema.NullOr(Schema.String)),
				ownerPluginId: selectedField(
					column(entity, "entitySchemaPluginId"),
					Schema.NullOr(Schema.String),
				),
			},
		});
		return {
			queries: {
				members: {
					...members,
					document: {
						...members.document,
						output: {
							...members.document.output,
							fields: [...members.document.output.fields, ...projections],
						},
					},
				},
			},
			map: ({ members: page }) =>
				Result.succeed({
					pageInfo: page.pageInfo,
					items: page.items.map((member) => ({
						name: member.name,
						presentation: null,
						entityId: member.entityId,
						ownerPluginId: member.ownerPluginId,
						entitySchemaSlug: member.entitySchemaSlug,
						cells: collectionMemberCells(member, input.membershipPropertiesSchema),
						sync: {
							populationStatus: member.populationStatus,
							translationStatus: member.translationStatus,
						},
					})),
				}),
		};
	},
);

export type CollectionMembersResult = Recipe.Success<typeof collectionMembersRecipe>;

export const collectionMembersCountRecipe = defineRecipe(
	(
		input: FilterInput & {
			readonly collectionId: string;
			readonly searchText?: string | undefined;
			readonly filterFields?: readonly QueryFilterField[] | undefined;
		},
	) => {
		const tables = collectionMembershipTables();
		const { entity, membership, entityJoin } = tables;
		const { predicate } = collectionMemberFilter(tables, input.filterFields ?? [], input);
		return {
			map: ({ count }) => Result.succeed(count.total),
			queries: {
				count: selectedAggregate(membership, {
					joins: [entityJoin],
					where: collectionMembershipWhere(
						membership,
						entity,
						input.collectionId,
						input.searchText,
						predicate,
					),
					measures: {
						total: selectedMeasure(
							{ function: "countDistinct", expr: column(entity, "id") },
							Schema.Finite,
						),
					},
				}),
			},
		};
	},
);

export type CollectionMembersCountResult = Recipe.Success<typeof collectionMembersCountRecipe>;

export const collectionMembersCountsRecipe = defineRecipe(
	(input: { readonly collectionIds: readonly string[] }) => {
		const membership = table("relationship", "collectionMembershipCounts");
		return {
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
						inArray(
							column(membership, "targetEntityId"),
							input.collectionIds.map((collectionId) => literal(collectionId)),
						),
					),
				}),
			},
		};
	},
);

export type CollectionMembersCountsResult = Recipe.Success<typeof collectionMembersCountsRecipe>;

export const collectionMembersAggregateRecipe = defineRecipe(
	(input: { readonly collectionId: string }) => {
		const { entity, membership, entityJoin, ownerPlugin, ownerPluginJoin } =
			collectionMembershipTables();
		return {
			map: ({ aggregate }) =>
				Result.succeed({
					...aggregate,
					items: aggregate.items.map((group) => ({
						...group,
						typeLabel: collectionTypeLabel(group),
					})),
				}),
			queries: {
				aggregate: selectedAggregate(membership, {
					limit: 100,
					joins: [entityJoin, ownerPluginJoin],
					where: collectionMembershipWhere(membership, entity, input.collectionId),
					measures: { count: selectedMeasure({ function: "count" }, Schema.Finite) },
					orderBy: [groupAscending("ownerPluginId"), groupAscending("entitySchemaSlug")],
					groupBy: {
						entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
						ownerPluginName: selectedField(
							column(ownerPlugin, "name"),
							Schema.NullOr(Schema.String),
						),
						ownerPluginId: selectedField(
							column(entity, "entitySchemaPluginId"),
							Schema.NullOr(Schema.String),
						),
					},
				}),
			},
		};
	},
);

export type CollectionMembersAggregateResult = Recipe.Success<
	typeof collectionMembersAggregateRecipe
>;
