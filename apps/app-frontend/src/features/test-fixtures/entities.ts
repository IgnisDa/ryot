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
		entitySchemaId: "schema-1",
		detailsSandboxScriptId: null,
		createdAt: new Date("2026-03-08T08:00:00.000Z"),
		updatedAt: new Date("2026-03-08T08:30:00.000Z"),
		...overrides,
	};
}
