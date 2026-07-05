import { Effect } from "effect";

import type { Client } from "./auth";
import { createEntity } from "./entities";
import { findBuiltinSchemaBySlug } from "./entity-schemas";

export const createMeasurementEntityFixture = (client: Client) =>
	Effect.gen(function* () {
		const { schema: measurementSchema } = yield* findBuiltinSchemaBySlug(client, "measurement");

		const measurement = yield* createEntity(client, {
			name: "Measurement - 2026-04-27 08:00",
			entitySchemaSlug: measurementSchema.id,
			properties: {
				recordedAt: "2026-04-27T08:00:00Z",
				statistics: [{ key: "weight", label: "Weight", value: 75.5 }],
			},
		});

		return { measurementId: measurement.id };
	});
