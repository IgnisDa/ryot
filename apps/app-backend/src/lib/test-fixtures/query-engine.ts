import { withOverrides } from "~/lib/test-fixtures/fixture-helpers";

const smartphoneSchemaDefaults = {
	slug: "smartphones",
	propertiesSchema: {
		fields: {
			nameplate: { label: "Nameplate", type: "string" as const },
			screenSize: { label: "Screen Size", type: "number" as const },
			announcedAt: { label: "Announced At", type: "date" as const },
			isFoldable: { label: "Is Foldable", type: "boolean" as const },
			releasedAt: { label: "Released At", type: "datetime" as const },
			releaseYear: { label: "Release Year", type: "integer" as const },
			manufacturer: { label: "Manufacturer", type: "string" as const },
			tags: {
				label: "Tags",
				type: "array" as const,
				items: { label: "Item", type: "string" as const },
			},
			metadata: {
				label: "Metadata",
				type: "object" as const,
				properties: { source: { label: "Source", type: "string" as const } },
			},
		},
	},
};

const tabletSchemaDefaults = {
	slug: "tablets",
	propertiesSchema: {
		fields: {
			maker: { label: "Maker", type: "string" as const },
			releaseYear: { label: "Release Year", type: "integer" as const },
		},
	},
};

export const createSmartphoneSchema = (
	overrides: Partial<typeof smartphoneSchemaDefaults> = {},
) => withOverrides(smartphoneSchemaDefaults, overrides);

export const createTabletSchema = (
	overrides: Partial<typeof tabletSchemaDefaults> = {},
) => withOverrides(tabletSchemaDefaults, overrides);
