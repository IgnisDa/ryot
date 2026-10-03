import type { ContractPayload, ContractPathParams } from "@ryot-app/contract/client";
import {
	measurementMetricCreateRecipe,
	measurementMetricPinRecipe,
	measurementReadingDeleteRecipe,
	measurementReadingLogRecipe,
	measurementReadingUpdateRecipe,
} from "@ryot-app/fitness-plugin/contracts/operation-recipes";
import { invokeOperationRecipe, type OperationRecipe } from "@ryot-app/plugin-kit/operations";
import type { PluginId } from "@ryot-app/plugin-kit/schema";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import { listEventSchemas, requireEventSchemaBySlug } from "~/fixtures/kernel/event-schemas";
import { waitForCreateEvents } from "~/fixtures/kernel/events";

import { findFitnessEntitySchema, fitnessFixtureInstallation } from "./exercises";

type InvokePayload = ContractPayload<"plugins", "invoke">["payload"];

const invokeMeasurementOperation = <
	Input,
	InputEncoded extends InvokePayload,
	Output,
	OutputEncoded,
>(
	client: Client,
	recipe: (pluginId: PluginId) => OperationRecipe<Input, InputEncoded, Output, OutputEncoded>,
	input: Input,
) =>
	fitnessFixtureInstallation.pipe(
		Effect.flatMap(({ id }) =>
			invokeOperationRecipe(
				recipe(id),
				input,
				(request: ContractPathParams<"plugins", "invoke"> & { readonly payload: InputEncoded }) =>
					client
						.call((contract) =>
							contract.plugins.invoke({
								payload: { payload: request.payload },
								params: { pluginId: request.pluginId, operationSlug: request.operationSlug },
							}),
						)
						.pipe(Effect.map(({ result }) => result)),
			),
		),
	);

type RecipeInput<
	Recipe extends (pluginId: PluginId) => { readonly input: { readonly Type: unknown } },
> = ReturnType<Recipe>["input"]["Type"];

export const createMeasurementMetric = (
	client: Client,
	input: RecipeInput<typeof measurementMetricCreateRecipe>,
) => invokeMeasurementOperation(client, measurementMetricCreateRecipe, input);

export const pinMeasurementMetric = (
	client: Client,
	input: RecipeInput<typeof measurementMetricPinRecipe>,
) => invokeMeasurementOperation(client, measurementMetricPinRecipe, input);

export const logMeasurementReadings = (
	client: Client,
	input: RecipeInput<typeof measurementReadingLogRecipe>,
) => invokeMeasurementOperation(client, measurementReadingLogRecipe, input);

export const updateMeasurementReadings = (
	client: Client,
	input: RecipeInput<typeof measurementReadingUpdateRecipe>,
) => invokeMeasurementOperation(client, measurementReadingUpdateRecipe, input);

export const deleteMeasurementReadings = (
	client: Client,
	input: RecipeInput<typeof measurementReadingDeleteRecipe>,
) => invokeMeasurementOperation(client, measurementReadingDeleteRecipe, input);

export const createMeasurementReadingFixture = (client: Client) =>
	Effect.gen(function* () {
		const { schema: metricSchema } = yield* findFitnessEntitySchema(client, "measurement-metric");
		const readingSchema = requireEventSchemaBySlug(
			yield* listEventSchemas(client, metricSchema.reference),
			"measurement-reading",
		);

		const metric = yield* createEntity(client, {
			name: "Weight",
			entitySchema: metricSchema.reference,
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
