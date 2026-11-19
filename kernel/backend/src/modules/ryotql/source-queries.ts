import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";

export const collectionSubjectDocument: RyotQLDocument = {
	parameters: {
		fields: {
			collectionId: {
				type: "string",
				label: "Collection",
				validation: { required: true },
				reference: { kind: "entity-id" },
				description: "Owned collection ID",
			},
		},
	},
	queries: {
		source: {
			from: { table: "entity", alias: "subject" },
			output: {
				fields: [],
				type: "rows",
				pagination: { limit: 100, maxLimit: 100 },
				orderBy: [
					{
						direction: "asc",
						expr: { type: "column", field: "collectionRank", tableAlias: "membership" },
					},
					{ direction: "asc", expr: { field: "id", type: "column", tableAlias: "subject" } },
				],
			},
			joins: [
				{
					type: "inner",
					table: { alias: "membership", table: "relationship" },
					on: {
						type: "and",
						predicates: [
							{
								operator: "eq",
								type: "comparison",
								right: { field: "id", type: "column", tableAlias: "subject" },
								left: { type: "column", field: "sourceEntityId", tableAlias: "membership" },
							},
							{
								operator: "eq",
								type: "comparison",
								right: { type: "parameter", name: "collectionId" },
								left: { type: "column", field: "targetEntityId", tableAlias: "membership" },
							},
							{
								operator: "eq",
								type: "comparison",
								right: { type: "literal", value: "member-of" },
								left: { type: "column", tableAlias: "membership", field: "relationshipSchemaSlug" },
							},
							{
								type: "isNull",
								expr: {
									type: "column",
									tableAlias: "membership",
									field: "relationshipSchemaPluginId",
								},
							},
						],
					},
				},
			],
		},
	},
};
