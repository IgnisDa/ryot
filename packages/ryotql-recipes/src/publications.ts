import { PublicationDefinition } from "@ryot-app/contract/modules/publications/schemas";
import {
	encodeEntitySourceReference,
	type EntitySourceReference,
} from "@ryot-app/contract/modules/ryotql/entity-source";
import type { TableReference } from "@ryot-app/contract/modules/ryotql/language";
import { PublicationId, PublicationLinkId } from "@ryot-app/contract/schema/brands";
import {
	and,
	castText,
	column,
	defineRecipe,
	descending,
	eq,
	isNull,
	jsonPath,
	literal,
	selectedField,
	selectedInclude,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import type { Recipe } from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const publicationSelection = (publication: TableReference) => {
	const link = table("publicationLink", "link");
	return {
		include: {
			links: selectedInclude(link, {
				limit: 100,
				where: eq(column(link, "publicationId"), column(publication, "id")),
				orderBy: [descending(column(link, "createdAt")), descending(column(link, "id"))],
				selection: {
					id: selectedField(column(link, "id"), PublicationLinkId),
					label: selectedField(column(link, "label"), Schema.String),
					createdAt: selectedField(column(link, "createdAt"), IsoDateString),
					expiresAt: selectedField(column(link, "expiresAt"), Schema.NullOr(IsoDateString)),
					revokedAt: selectedField(column(link, "revokedAt"), Schema.NullOr(IsoDateString)),
					lastExchangedAt: selectedField(
						column(link, "lastExchangedAt"),
						Schema.NullOr(IsoDateString),
					),
				},
			}),
		},
		selection: {
			id: selectedField(column(publication, "id"), PublicationId),
			icon: selectedField(column(publication, "icon"), Schema.String),
			title: selectedField(column(publication, "title"), Schema.String),
			revision: selectedField(column(publication, "revision"), Schema.Int),
			createdAt: selectedField(column(publication, "createdAt"), IsoDateString),
			updatedAt: selectedField(column(publication, "updatedAt"), IsoDateString),
			showOwnerName: selectedField(column(publication, "showOwnerName"), Schema.Boolean),
			definition: selectedField(column(publication, "definition"), PublicationDefinition),
			revokedAt: selectedField(column(publication, "revokedAt"), Schema.NullOr(IsoDateString)),
			description: selectedField(column(publication, "description"), Schema.NullOr(Schema.String)),
		},
	};
};

const orderedPublications = (publication: TableReference) => [
	descending(column(publication, "createdAt")),
	descending(column(publication, "id")),
];

export const publicationsRecipe = (() => {
	const publication = table("publication", "publication");
	return defineRecipe({
		map: ({ publications }) => Result.succeed(publications),
		queries: {
			publications: selectedRows(publication, {
				limit: 20,
				maxLimit: 1000,
				orderBy: orderedPublications(publication),
				...publicationSelection(publication),
			}),
		},
	});
})();

const sourceParameters = parameters({
	fields: {
		source: {
			type: "string",
			label: "Source",
			validation: { required: true },
			description: "Encoded entity source",
			reference: { kind: "entity-source" },
		},
	},
});
export const publicationSourceArguments = (source: EntitySourceReference) => ({
	source: encodeEntitySourceReference(source),
});
const sourcePublication = table("publication", "publication");
export const sourcePublicationsRecipe = defineRecipe({
	parameters: sourceParameters.schema,
	map: ({ publications }) => Result.succeed(publications.items),
	queries: {
		publications: selectedRows(sourcePublication, {
			limit: 20,
			orderBy: orderedPublications(sourcePublication),
			where: and(
				isNull(column(sourcePublication, "revokedAt")),
				eq(
					castText(jsonPath(column(sourcePublication, "definition"), "page", "kind")),
					literal("kernel"),
				),
				eq(
					castText(jsonPath(column(sourcePublication, "definition"), "page", "name")),
					literal("publication"),
				),
				eq(
					castText(jsonPath(column(sourcePublication, "definition"), "arguments", "source")),
					sourceParameters.value("source"),
				),
			),
			...publicationSelection(sourcePublication),
		}),
	},
});

export type PublicationSummary = PublicationsResult["items"][number];

export type PublicationsResult = Recipe.Success<typeof publicationsRecipe>;
