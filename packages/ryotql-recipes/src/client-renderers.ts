import { ClientRendererDefinition } from "@ryot-app/contract/modules/client-pages/schemas";
import { ClientRendererId } from "@ryot-app/contract/schema/brands";
import {
	ascending,
	column,
	defineRecipe,
	eq,
	literal,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/ryotql";
import { Option, Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const renderer = table("clientRenderer", "renderer");
const metadata = {
	id: selectedField(column(renderer, "id"), ClientRendererId),
	slug: selectedField(column(renderer, "slug"), Schema.String),
	name: selectedField(column(renderer, "name"), Schema.String),
	createdAt: selectedField(column(renderer, "createdAt"), IsoDateString),
	updatedAt: selectedField(column(renderer, "updatedAt"), IsoDateString),
	draftRevision: selectedField(column(renderer, "draftRevision"), Schema.Int),
	publishedHash: selectedField(column(renderer, "publishedHash"), Schema.NullOr(Schema.String)),
	publishedRevision: selectedField(
		column(renderer, "publishedRevision"),
		Schema.NullOr(Schema.Int),
	),
};

export const clientRenderersRecipe = defineRecipe(
	(input: { readonly after?: string; readonly limit: number }) => ({
		map: ({ renderers }) => Result.succeed(renderers),
		queries: {
			renderers: selectedRows(renderer, {
				after: input.after,
				limit: input.limit,
				selection: metadata,
				orderBy: [ascending(column(renderer, "name")), ascending(column(renderer, "id"))],
			}),
		},
	}),
);

export const clientRendererRecipe = defineRecipe((input: { readonly id: string }) => ({
	map: ({ renderer: item }) =>
		Result.succeed(item === undefined ? Option.none() : Option.some(item)),
	queries: {
		renderer: selectedOptionalRow(renderer, {
			orderBy: [ascending(column(renderer, "id"))],
			where: eq(column(renderer, "id"), literal(input.id)),
			selection: {
				...metadata,
				draftDefinition: selectedField(
					column(renderer, "draftDefinition"),
					ClientRendererDefinition,
				),
				publishedDefinition: selectedField(
					column(renderer, "publishedDefinition"),
					Schema.NullOr(ClientRendererDefinition),
				),
			},
		}),
	},
}));

export type ClientRendererPage = Recipe.Success<typeof clientRenderersRecipe>;
export type ClientRendererDetail = Recipe.Success<typeof clientRendererRecipe>;
export type ClientRendererListItem = ClientRendererPage["items"][number];
