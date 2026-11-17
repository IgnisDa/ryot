import { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/authored";
import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { SavedViewRenderer } from "@ryot-app/contract/modules/saved-views/schemas";
import { PluginPackageId, SavedViewId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { DisplayText } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	and,
	ascending,
	castText,
	column,
	defineRecipe,
	eq,
	jsonPath,
	literal,
	or,
	type Recipe,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const savedView = table("savedView", "savedView");
const selection = {
	id: selectedField(column(savedView, "id"), SavedViewId),
	name: selectedField(column(savedView, "name"), DisplayText),
	slug: selectedField(column(savedView, "slug"), Schema.String),
	icon: selectedField(column(savedView, "icon"), Schema.String),
	isHidden: selectedField(column(savedView, "isHidden"), Schema.Boolean),
	sortOrder: selectedField(column(savedView, "sortOrder"), Schema.Finite),
	isBuiltin: selectedField(column(savedView, "isBuiltin"), Schema.Boolean),
	renderer: selectedField(column(savedView, "renderer"), SavedViewRenderer),
	reference: selectedField(column(savedView, "reference"), SavedViewReference),
	createdAt: selectedField(column(savedView, "createdAt"), Schema.NullOr(IsoDateString)),
	updatedAt: selectedField(column(savedView, "updatedAt"), Schema.NullOr(IsoDateString)),
	packageId: selectedField(column(savedView, "packageId"), Schema.NullOr(PluginPackageId)),
	dataSources: selectedField(column(savedView, "dataSources"), Schema.NullOr(RyotQLDocument)),
	settings: selectedField(column(savedView, "settings"), Schema.Record(Schema.String, JsonValue)),
};

export const savedViewRecordsRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			pluginId: {
				type: "string",
				description: "Query pluginId",
				label: kernelMessage("recipe.parameter.plugin"),
			},
			includeHidden: {
				type: "boolean",
				defaultValue: false,
				description: "Query includeHidden",
				label: kernelMessage("recipe.parameter.include-hidden"),
			},
		},
	});

	const predicates = [
		or(
			eq(recipeParameters.value("includeHidden"), literal(true)),
			eq(column(savedView, "isHidden"), literal(false)),
		),
		recipeParameters.whenSet(
			"pluginId",
			eq(column(savedView, "pluginId"), recipeParameters.value("pluginId")),
		),
	];
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ savedViews }) => Result.succeed(savedViews),
		queries: {
			savedViews: selectedRows(savedView, {
				selection,

				limit: 20,
				maxLimit: 1000,
				where: predicates.length > 0 ? and(...predicates) : undefined,
				orderBy: [
					ascending(column(savedView, "packageId")),
					ascending(column(savedView, "sortOrder")),
					ascending(column(savedView, "slug")),
				],
			}),
		},
	});
})();

export const savedViewReferenceFields = {
	slug: {
		type: "string",
		defaultValue: "",
		description: "Builtin saved view slug",
		label: kernelMessage("recipe.parameter.slug"),
	},
	pluginId: {
		type: "string",
		defaultValue: "",
		description: "Local saved view plugin ID",
		label: kernelMessage("recipe.parameter.plugin"),
	},
	savedViewId: {
		type: "string",
		defaultValue: "",
		description: "Custom saved view ID",
		label: kernelMessage("recipe.parameter.saved-view"),
	},
	referenceKind: {
		type: "enum",
		defaultValue: "kernel",
		description: "Saved view reference kind",
		label: kernelMessage("recipe.parameter.reference-kind"),
		choices: {
			kind: "static",
			values: [{ value: "custom" }, { value: "kernel" }, { value: "plugin" }],
		},
	},
} as const;

export const savedViewReferenceArguments = (reference: SavedViewReference) => ({
	referenceKind: reference.kind,
	slug: reference.kind === "custom" ? "" : reference.slug,
	pluginId: reference.kind === "plugin" ? reference.pluginId : "",
	savedViewId: reference.kind === "custom" ? reference.savedViewId : "",
});

export const savedViewReferencePredicate = (
	reference: ScalarExpression,
	input: {
		readonly id: ScalarExpression;
		readonly kind: ScalarExpression;
		readonly slug: ScalarExpression;
		readonly pluginId: ScalarExpression;
	},
) =>
	and(
		eq(castText(jsonPath(reference, "kind")), input.kind),
		or(
			and(
				eq(input.kind, literal("custom")),
				eq(castText(jsonPath(reference, "savedViewId")), input.id),
			),
			and(eq(input.kind, literal("kernel")), eq(castText(jsonPath(reference, "slug")), input.slug)),
			and(
				eq(input.kind, literal("plugin")),
				eq(castText(jsonPath(reference, "pluginId")), input.pluginId),
				eq(castText(jsonPath(reference, "slug")), input.slug),
			),
		),
	);
const referenceParameters = parameters({ fields: savedViewReferenceFields });
export const savedViewRecordRecipe = defineRecipe({
	parameters: referenceParameters.schema,
	map: ({ savedView: record }) => Result.succeed(record),
	queries: {
		savedView: selectedOptionalRow(savedView, {
			selection,
			orderBy: [ascending(column(savedView, "id"))],
			where: savedViewReferencePredicate(column(savedView, "reference"), {
				slug: referenceParameters.value("slug"),
				id: referenceParameters.value("savedViewId"),
				pluginId: referenceParameters.value("pluginId"),
				kind: referenceParameters.value("referenceKind"),
			}),
		}),
	},
});

export type SavedViewRecordList = Recipe.Success<typeof savedViewRecordsRecipe>;
export type SavedViewRecord = NonNullable<Recipe.Success<typeof savedViewRecordRecipe>>;
