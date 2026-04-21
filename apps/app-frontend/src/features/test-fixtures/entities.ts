import { dayjs } from "@ryot/ts-utils";
import type { AppEntity } from "~/features/entities/model";
import type { SearchResultItem } from "~/features/entities/use-search";

export function createEntityFixture(
	overrides: Partial<AppEntity> = {},
): AppEntity {
	return {
		image: null,
		id: "entity-1",
		name: "Entity",
		properties: {},
		externalId: null,
		sandboxScriptId: null,
		entitySchemaId: "schema-1",
		createdAt: dayjs("2026-03-08T08:00:00.000Z").toDate(),
		populatedAt: dayjs("2026-03-08T08:30:00.000Z").toDate(),
		updatedAt: dayjs("2026-03-08T08:30:00.000Z").toDate(),
		...overrides,
	};
}

export function createSearchResultItemFixture(
	overrides: Partial<SearchResultItem> = {},
): SearchResultItem {
	return {
		externalId: "item-1",
		calloutProperty: { kind: "null", value: null },
		imageProperty: { kind: "null", value: null },
		primarySubtitleProperty: { kind: "null", value: null },
		secondarySubtitleProperty: { kind: "null", value: null },
		titleProperty: { kind: "text", value: "Test Item" },
		...overrides,
	};
}
