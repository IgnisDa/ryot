import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import type { Recipe } from "@ryot-app/plugin-kit/ryotql";
import {
	and,
	ascending,
	castText,
	column,
	defineRecipe,
	descending,
	eq,
	exists,
	inArray,
	isNotNull,
	isNull,
	join,
	jsonPath,
	literal,
	neq,
	or,
	parameters,
	relationshipSchemaPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import type { Table } from "./entity-selections";
import { sameSchemaOwner } from "./lifecycle-expressions";
import { mediaCopyFields, MediaCopyProperties, mediaCopyRelationship } from "./media-copy";
import { catalogMessage } from "./messages.generated";

export const mediaHasCopies = (entity: Table) => {
	const copy = table("relationship", "ownedCopy");
	return exists(copy, {
		where: and(
			eq(column(copy, "targetEntityId"), column(entity, "id")),
			eq(column(copy, "relationshipSchemaSlug"), literal(mediaCopyRelationship)),
			sameSchemaOwner(copy, "relationshipSchemaPluginId", entity),
		),
	});
};

const mediaCopyEnumFilters = [
	"format",
	"resolution",
	"scanType",
	"hdr",
	"audioCodec",
	"audioSpatialFormat",
] as const;

const copyFilter = <
	const Field extends (typeof mediaCopyFields)[(typeof mediaCopyEnumFilters)[number]],
>(
	field: Field,
) => ({
	...field,
	defaultValue: "all" as const,
	choices: {
		...field.choices,
		values: [
			{ value: "all" as const, label: catalogMessage("ownership.all-values") },
			...field.choices.values,
		],
	},
});

const args = parameters({
	fields: {
		hdr: copyFilter(mediaCopyFields.hdr),
		format: copyFilter(mediaCopyFields.format),
		scanType: copyFilter(mediaCopyFields.scanType),
		resolution: copyFilter(mediaCopyFields.resolution),
		audioCodec: copyFilter(mediaCopyFields.audioCodec),
		audioSpatialFormat: copyFilter(mediaCopyFields.audioSpatialFormat),
		audioChannels: {
			...mediaCopyFields.audioChannels,
			defaultValue: "",
			validation: { maxLength: 64 },
		},
		copyKey: {
			type: "string",
			description: "Stable copy key to look up",
			label: catalogMessage("query-parameter.id"),
		},
		entityId: {
			type: "string",
			label: catalogMessage("query-parameter.title"),
			description: "Media entity whose copies to read",
		},
		notSeenInRun: {
			type: "string",
			label: catalogMessage("property.source"),
			description: "Exclude copies seen during this inventory scan",
		},
		integrationSourceKey: {
			type: "string",
			label: catalogMessage("property.source"),
			description: "Integration connection responsible for copies",
		},
		copyKeys: {
			type: "array",
			description: "Copy keys to look up",
			label: catalogMessage("query-parameter.id"),
			items: {
				type: "string",
				description: "Stable copy key",
				label: catalogMessage("query-parameter.id"),
			},
		},
		is3d: {
			...mediaCopyFields.is3d,
			type: "enum",
			defaultValue: "all",
			choices: {
				kind: "static",
				values: [
					{ value: "all", label: catalogMessage("ownership.all-values") },
					{ value: "true", label: catalogMessage("ownership.yes") },
					{ value: "false", label: catalogMessage("ownership.no") },
				],
			},
		},
	},
});

export const mediaCopyBatchSize = 50;

export const mediaCopiesRecipe = (reference: PluginIdentityReference) => {
	const copy = table("relationship", "copy");
	const title = table("entity", "copyTitle");
	return defineRecipe({
		parameters: args.schema,
		map: ({ copies }) => Result.succeed(copies),
		queries: {
			copies: selectedRows(copy, {
				maxLimit: mediaCopyBatchSize,
				orderBy: [descending(column(copy, "createdAt")), ascending(column(copy, "id"))],
				joins: [join("inner", title, eq(column(copy, "targetEntityId"), column(title, "id")))],
				selection: {
					id: selectedField(column(copy, "key"), Schema.String),
					name: selectedField(column(title, "name"), Schema.String),
					entityId: selectedField(column(title, "id"), Schema.String),
					properties: selectedField(column(copy, "properties"), MediaCopyProperties),
					entitySchemaSlug: selectedField(column(title, "entitySchemaSlug"), Schema.String),
				},
				where: and(
					relationshipSchemaPredicate(copy, mediaCopyRelationship, reference),
					isNotNull(column(copy, "key")),
					args.whenSet("entityId", eq(column(copy, "targetEntityId"), args.value("entityId"))),
					args.whenSet("copyKeys", inArray(column(copy, "key"), args.list("copyKeys"))),
					args.whenSet("copyKey", eq(column(copy, "key"), args.value("copyKey"))),
					args.whenSet(
						"integrationSourceKey",
						eq(
							castText(jsonPath(column(copy, "properties"), "integrationSourceKey")),
							args.value("integrationSourceKey"),
						),
					),
					args.whenSet(
						"notSeenInRun",
						or(
							isNull(castText(jsonPath(column(copy, "properties"), "seenInRun"))),
							neq(
								castText(jsonPath(column(copy, "properties"), "seenInRun")),
								args.value("notSeenInRun"),
							),
						),
					),
					...[...mediaCopyEnumFilters, "is3d" as const].map((field) =>
						or(
							eq(args.value(field), literal("all")),
							eq(castText(jsonPath(column(copy, "properties"), field)), args.value(field)),
						),
					),
					or(
						eq(args.value("audioChannels"), literal("")),
						eq(
							castText(jsonPath(column(copy, "properties"), "audioChannels")),
							args.value("audioChannels"),
						),
					),
				),
			}),
		},
	});
};

export type MediaCopyRow = Recipe.Success<ReturnType<typeof mediaCopiesRecipe>>["items"][number];
