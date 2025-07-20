import { dayjs } from "@ryot/ts-utils/dayjs";
import type { AppEntity } from "#/features/entities/model";

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
		updatedAt: dayjs("2026-03-08T08:30:00.000Z").toDate(),
		...overrides,
	};
}
