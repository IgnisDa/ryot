import { PageDefinition, PageOrigin } from "@ryot-app/contract/modules/pages/schemas";
import {
	ascending,
	column,
	defineRecipe,
	eq,
	type Recipe,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const page = table("page", "page");
const metadata = {
	id: selectedField(column(page, "id"), Schema.String),
	slug: selectedField(column(page, "slug"), Schema.String),
	name: selectedField(column(page, "name"), Schema.String),
	origin: selectedField(column(page, "origin"), PageOrigin),
	createdAt: selectedField(column(page, "createdAt"), IsoDateString),
	updatedAt: selectedField(column(page, "updatedAt"), IsoDateString),
	writeAccess: selectedField(column(page, "writeAccess"), Schema.Boolean),
	draftRevision: selectedField(column(page, "draftRevision"), Schema.Int),
	authorityRevision: selectedField(column(page, "authorityRevision"), Schema.Int),
	draftDefinitionHash: selectedField(column(page, "draftDefinitionHash"), Schema.String),
	publishedRevision: selectedField(column(page, "publishedRevision"), Schema.NullOr(Schema.Int)),
	draftArtifactHash: selectedField(column(page, "draftArtifactHash"), Schema.NullOr(Schema.String)),
	draftCompiledRevision: selectedField(
		column(page, "draftCompiledRevision"),
		Schema.NullOr(Schema.Int),
	),
	publishedArtifactHash: selectedField(
		column(page, "publishedArtifactHash"),
		Schema.NullOr(Schema.String),
	),
	publishedDefinitionHash: selectedField(
		column(page, "publishedDefinitionHash"),
		Schema.NullOr(Schema.String),
	),
};
export const pagesRecipe = defineRecipe({
	map: ({ pages }) => Result.succeed(pages),
	queries: {
		pages: selectedRows(page, {
			limit: 20,
			maxLimit: 100,
			selection: metadata,
			orderBy: [ascending(column(page, "name")), ascending(column(page, "id"))],
		}),
	},
});
const detailParameters = parameters({
	fields: {
		pageId: {
			label: "Page",
			type: "string",
			description: "Page ID",
			validation: { required: true },
		},
	},
});
export const pageRecipe = defineRecipe({
	parameters: detailParameters.schema,
	map: ({ page: record }) => Result.succeed(record),
	queries: {
		page: selectedOptionalRow(page, {
			orderBy: [ascending(column(page, "id"))],
			where: eq(column(page, "id"), detailParameters.value("pageId")),
			selection: {
				...metadata,
				draftDefinition: selectedField(column(page, "draftDefinition"), PageDefinition),
				publishedDefinition: selectedField(
					column(page, "publishedDefinition"),
					Schema.NullOr(PageDefinition),
				),
			},
		}),
	},
});
export type PageList = Recipe.Success<typeof pagesRecipe>;
export type PageRecord = NonNullable<Recipe.Success<typeof pageRecipe>>;
