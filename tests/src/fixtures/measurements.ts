import type { Client } from "./auth";
import { createEntity } from "./entities";
import { findBuiltinSchemaBySlug } from "./entity-schemas";

export async function createMeasurementEntityFixture(client: Client) {
	const { schema: measurementSchema } = await findBuiltinSchemaBySlug(
		client,
		"measurement",
	);

	const measurement = await createEntity(client, {
		image: null,
		name: "Measurement - 2026-04-27 08:00",
		entitySchemaId: measurementSchema.id,
		properties: {
			recordedAt: "2026-04-27T08:00:00Z",
			statistics: [{ key: "weight", label: "Weight", value: 75.5 }],
		},
	});

	return { measurementId: measurement.id };
}
