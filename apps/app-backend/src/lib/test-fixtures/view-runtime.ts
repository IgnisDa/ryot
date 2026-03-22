import { withOverrides } from "~/lib/test-fixtures/fixture-helpers";

const smartphoneSchemaDefaults = {
	slug: "smartphones",
	propertiesSchema: {
		announcedAt: { type: "date" as const },
		nameplate: { type: "string" as const },
		screenSize: { type: "number" as const },
		isFoldable: { type: "boolean" as const },
		releaseYear: { type: "integer" as const },
		manufacturer: { type: "string" as const },
	},
};

const tabletSchemaDefaults = {
	slug: "tablets",
	propertiesSchema: {
		maker: { type: "string" as const },
		releaseYear: { type: "integer" as const },
	},
};

export const createSmartphoneSchema = (
	overrides: Partial<typeof smartphoneSchemaDefaults> = {},
) => withOverrides(smartphoneSchemaDefaults, overrides);

export const createTabletSchema = (
	overrides: Partial<typeof tabletSchemaDefaults> = {},
) => withOverrides(tabletSchemaDefaults, overrides);
