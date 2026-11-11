import { PublicationSource } from "@ryot-app/contract/modules/publications/schemas";
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
	selectedField,
	selectedInclude,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import type { Recipe } from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";
import {
	savedViewReferenceArguments,
	savedViewReferenceFields,
	savedViewReferencePredicate,
} from "./saved-view-records";

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
			source: selectedField(column(publication, "source"), PublicationSource),
			createdAt: selectedField(column(publication, "createdAt"), IsoDateString),
			updatedAt: selectedField(column(publication, "updatedAt"), IsoDateString),
			showOwnerName: selectedField(column(publication, "showOwnerName"), Schema.Boolean),
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

/** The owner's active publications of exactly this source, newest first. */
const sourceParameters = parameters({
	fields: {
		...savedViewReferenceFields,
		collectionId: {
			type: "string",
			defaultValue: "",
			label: "Collection",
			description: "Collection source ID",
		},
		sourceKind: {
			type: "enum",
			label: "Source",
			validation: { required: true },
			description: "Publication source kind",
			choices: { kind: "static", values: [{ value: "collection" }, { value: "saved-view" }] },
		},
	},
});
export const publicationSourceArguments = (source: PublicationSource) =>
	source.kind === "collection"
		? { sourceKind: source.kind, collectionId: source.collectionId }
		: { sourceKind: source.kind, ...savedViewReferenceArguments(source.reference) };
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
					castText(jsonPath(column(sourcePublication, "source"), "kind")),
					sourceParameters.value("sourceKind"),
				),
				sourceParameters.choice("sourceKind", {
					collection: eq(
						castText(jsonPath(column(sourcePublication, "source"), "collectionId")),
						sourceParameters.value("collectionId"),
					),
					"saved-view": savedViewReferencePredicate(
						jsonPath(column(sourcePublication, "source"), "reference"),
						{
							slug: sourceParameters.value("slug"),
							id: sourceParameters.value("savedViewId"),
							pluginId: sourceParameters.value("pluginId"),
							kind: sourceParameters.value("referenceKind"),
						},
					),
				}),
			),
			...publicationSelection(sourcePublication),
		}),
	},
});

export type PublicationSummary = PublicationsResult["items"][number];

export type PublicationsResult = Recipe.Success<typeof publicationsRecipe>;
