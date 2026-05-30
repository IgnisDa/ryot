import { withOverrides } from "~/lib/test-fixtures/fixture-helpers";

const smartphoneSchemaDefaults = {
	slug: "smartphones",
	propertiesSchema: {
		fields: {
			nameplate: {
				label: "Nameplate",
				type: "string" as const,
				description: "Marketing nameplate",
			},
			screenSize: {
				label: "Screen Size",
				type: "number" as const,
				description: "Screen size in inches",
			},
			announcedAt: {
				label: "Announced At",
				type: "date" as const,
				description: "Announcement date",
			},
			isFoldable: {
				label: "Is Foldable",
				type: "boolean" as const,
				description: "Whether the phone folds",
			},
			releasedAt: {
				label: "Released At",
				type: "datetime" as const,
				description: "Release timestamp",
			},
			releaseYear: {
				label: "Release Year",
				type: "integer" as const,
				description: "Release year",
			},
			manufacturer: {
				label: "Manufacturer",
				type: "string" as const,
				description: "Phone manufacturer",
			},
			tags: {
				label: "Tags",
				type: "array" as const,
				description: "Classification tags",
				items: {
					label: "Item",
					type: "string" as const,
					description: "Tag value",
				},
			},
			metadata: {
				label: "Metadata",
				type: "object" as const,
				description: "Supplemental metadata",
				properties: {
					source: {
						label: "Source",
						type: "string" as const,
						description: "Metadata source",
					},
				},
			},
		},
	},
};

const tabletSchemaDefaults = {
	slug: "tablets",
	propertiesSchema: {
		fields: {
			maker: {
				label: "Maker",
				type: "string" as const,
				description: "Tablet manufacturer",
			},
			releaseYear: {
				label: "Release Year",
				type: "integer" as const,
				description: "Tablet release year",
			},
		},
	},
};

export const createSmartphoneSchema = (overrides: Partial<typeof smartphoneSchemaDefaults> = {}) =>
	withOverrides(smartphoneSchemaDefaults, overrides);

export const createTabletSchema = (overrides: Partial<typeof tabletSchemaDefaults> = {}) =>
	withOverrides(tabletSchemaDefaults, overrides);
