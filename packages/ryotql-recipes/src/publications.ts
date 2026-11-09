import {
	type PublicationScope,
	PublicationSource,
} from "@ryot-app/contract/modules/publications/schemas";
import type { RyotQLDocument, TableReference } from "@ryot-app/contract/modules/ryotql/language";
import { EntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import { PublicationId, PublicationLinkId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { Recipe } from "@ryot-app/ryotql";
import {
	and,
	ascending,
	column,
	defineRecipe,
	descending,
	eq,
	field,
	isNull,
	join,
	literal,
	relationshipSchemaPredicate,
	rows,
	selectedField,
	selectedInclude,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Option, Result, Schema } from "effect";

import { IsoDateString } from "./codecs";
import { subjectSchemaPredicate } from "./saved-views";

export const collectionPublicationScope = (collectionId: string): PublicationScope => {
	const subject = table("entity", "subject");
	const membership = table("relationship", "membership");
	return {
		subjectAlias: subject.alias,
		query: rows(subject, {
			fields: [field("id", column(subject, "id"))],
			orderBy: [ascending(column(membership, "collectionRank")), ascending(column(subject, "id"))],
			joins: [
				join(
					"inner",
					membership,
					and(
						eq(column(membership, "sourceEntityId"), column(subject, "id")),
						eq(column(membership, "targetEntityId"), literal(collectionId)),
						relationshipSchemaPredicate(membership, "member-of", { kind: "kernel" }),
					),
				),
			],
		}),
	};
};

export const savedViewPublicationScope = (view: {
	readonly dataSources: null | RyotQLDocument;
	readonly settings: Readonly<Record<string, JsonValue>>;
}): null | PublicationScope => {
	const settings = Schema.decodeUnknownOption(EntityBrowserSavedViewSettings)(view.settings);
	if (Option.isNone(settings) || view.dataSources === null) {
		return null;
	}
	const source = view.dataSources.queries[settings.value.sourceName];
	if (source?.output.type !== "rows") {
		return null;
	}
	const subjectAlias = settings.value.subject.entityAlias;
	const subjects = subjectSchemaPredicate(settings.value.subject, table("entity", subjectAlias));
	return {
		subjectAlias,
		query: {
			...source,
			where: source.where === undefined ? subjects : and(source.where, subjects),
		},
	};
};

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

export const publicationsRecipe = defineRecipe(
	(input: { readonly limit: number; readonly after?: string | undefined }) => {
		const publication = table("publication", "publication");
		return {
			map: ({ publications }) => Result.succeed(publications),
			queries: {
				publications: selectedRows(publication, {
					after: input.after,
					limit: input.limit,
					orderBy: orderedPublications(publication),
					...publicationSelection(publication),
				}),
			},
		};
	},
);

/** The owner's active publications of exactly this source, newest first. */
export const sourcePublicationsRecipe = defineRecipe(
	(input: { readonly source: PublicationSource }) => {
		const publication = table("publication", "publication");
		return {
			map: ({ publications }) => Result.succeed(publications.items),
			queries: {
				publications: selectedRows(publication, {
					limit: 20,
					orderBy: orderedPublications(publication),
					where: and(
						isNull(column(publication, "revokedAt")),
						eq(column(publication, "source"), literal(input.source)),
					),
					...publicationSelection(publication),
				}),
			},
		};
	},
);

export type PublicationSummary = PublicationsResult["items"][number];

export type PublicationsResult = Recipe.Success<typeof publicationsRecipe>;
