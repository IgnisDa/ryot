import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { measurementMetricCreateRecipe } from "@ryot-app/fitness-plugin/contracts/operation-recipes";
import { Effect, Schema } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import { findBuiltinSchemaBySlug } from "~/fixtures/kernel/entity-schemas";
import { listEventSchemas, requireEventSchemaBySlug } from "~/fixtures/kernel/event-schemas";
import { waitForCreateEvents } from "~/fixtures/kernel/events";

export const createMeasurementMetric = (
	client: Client,
	input: typeof measurementMetricCreateRecipe.input.Type,
) =>
	client
		.call((contract) =>
			contract.plugins.invoke({
				payload: { payload: input },
				params: {
					operationSlug: measurementMetricCreateRecipe.operationSlug,
					pluginSlug: PluginSlug.make(measurementMetricCreateRecipe.pluginSlug),
				},
			}),
		)
		.pipe(
			Effect.flatMap(({ result }) =>
				Schema.decodeUnknownEffect(measurementMetricCreateRecipe.output)(result),
			),
		);

export const createMeasurementReadingFixture = (client: Client) =>
	Effect.gen(function* () {
		const { schema: metricSchema } = yield* findBuiltinSchemaBySlug(client, "measurement-metric");
		const readingSchema = requireEventSchemaBySlug(
			yield* listEventSchemas(client, metricSchema.id),
			"measurement-reading",
		);

		const metric = yield* createEntity(client, {
			name: "Weight",
			entitySchemaSlug: metricSchema.id,
			properties: { unit: "kg", key: "weight" },
		});
		yield* waitForCreateEvents(
			client,
			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: metric.id,
							eventSchemaSlug: readingSchema.id,
							occurredAt: "2026-04-27T08:00:00Z",
							properties: { value: 75.5, comment: "Morning" },
						},
					],
				}),
			),
		);

		return { metricId: metric.id };
	});
