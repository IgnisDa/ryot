import type { Client } from "./auth";
import { createEntity } from "./entities";
import { findBuiltinSchemaBySlug } from "./entity-schemas";

export async function createMeasurementEntityFixture(
	client: Client,
	cookies: string,
) {
	const { schema: measurementSchema } = await findBuiltinSchemaBySlug(
		client,
		cookies,
		"measurement",
	);

	const measurement = await createEntity(client, cookies, {
		image: null,
		name: "2026-04-27",
		entitySchemaId: measurementSchema.id,
		properties: { weight: 75.5, recordedAt: "2026-04-27T08:00:00Z" },
	});

	return { measurement, measurementId: measurement.id };
}
