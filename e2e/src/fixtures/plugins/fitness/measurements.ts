import { PluginSlug } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	measurementMetricCreateRecipe,
	measurementReadingDeleteRecipe,
	measurementReadingLogRecipe,
	measurementReadingUpdateRecipe,
} from "@ryot-app/fitness-plugin/contracts/operation-recipes";
import type { OperationRecipe } from "@ryot-app/plugin-kit/operations";
import { Effect, Schema } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import { findBuiltinSchemaBySlug } from "~/fixtures/kernel/entity-schemas";
import { listEventSchemas, requireEventSchemaBySlug } from "~/fixtures/kernel/event-schemas";
import { waitForCreateEvents } from "~/fixtures/kernel/events";

const invokeMeasurementOperation = <Input extends JsonValue, InputEncoded, Output, OutputEncoded>(
	client: Client,
	recipe: OperationRecipe<Input, InputEncoded, Output, OutputEncoded>,
	input: Input,
) =>
	client
		.call((contract) =>
			contract.plugins.invoke({
				payload: { payload: input },
				params: {
					operationSlug: recipe.operationSlug,
					pluginSlug: PluginSlug.make(recipe.pluginSlug),
				},
			}),
		)
		.pipe(Effect.flatMap(({ result }) => Schema.decodeUnknownEffect(recipe.output)(result)));

export const createMeasurementMetric = (
	client: Client,
	input: typeof measurementMetricCreateRecipe.input.Type,
) => invokeMeasurementOperation(client, measurementMetricCreateRecipe, input);

export const logMeasurementReadings = (
	client: Client,
	input: typeof measurementReadingLogRecipe.input.Type,
) => invokeMeasurementOperation(client, measurementReadingLogRecipe, input);

export const updateMeasurementReadings = (
	client: Client,
	input: typeof measurementReadingUpdateRecipe.input.Type,
) => invokeMeasurementOperation(client, measurementReadingUpdateRecipe, input);

export const deleteMeasurementReadings = (
	client: Client,
	input: typeof measurementReadingDeleteRecipe.input.Type,
) => invokeMeasurementOperation(client, measurementReadingDeleteRecipe, input);

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
