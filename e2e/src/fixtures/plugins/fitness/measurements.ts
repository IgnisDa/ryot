import {
	measurementMetricCreateRecipe,
	measurementMetricPinRecipe,
	measurementReadingDeleteRecipe,
	measurementReadingLogRecipe,
	measurementReadingUpdateRecipe,
} from "@ryot-app/fitness-plugin/contracts/operation-recipes";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import { listEventSchemas, requireEventSchemaBySlug } from "~/fixtures/kernel/event-schemas";
import { waitForCreateEvents } from "~/fixtures/kernel/events";

import { findFitnessEntitySchema } from "./exercises";
import {
	invokeEncodedFitnessOperation,
	invokeFitnessOperation,
	type RecipeEncodedInput,
	type RecipeInput,
} from "./operation-transport";

export const createMeasurementMetric = (
	client: Client,
	input: RecipeEncodedInput<typeof measurementMetricCreateRecipe>,
) => invokeEncodedFitnessOperation(client, measurementMetricCreateRecipe, input);

export const pinMeasurementMetric = (
	client: Client,
	input: RecipeInput<typeof measurementMetricPinRecipe>,
) => invokeFitnessOperation(client, measurementMetricPinRecipe, input);

type SubmissionKeys = "submissionId" | "submittedAt";
type ReadingLogInput = RecipeEncodedInput<typeof measurementReadingLogRecipe>;

export const logMeasurementReadings = (
	client: Client,
	input: Omit<ReadingLogInput, SubmissionKeys> & Partial<Pick<ReadingLogInput, SubmissionKeys>>,
) =>
	invokeEncodedFitnessOperation(client, measurementReadingLogRecipe, {
		...input,
		submissionId: input.submissionId ?? crypto.randomUUID(),
		submittedAt: input.submittedAt ?? new Date().toISOString(),
	});

export const updateMeasurementReadings = (
	client: Client,
	input: RecipeInput<typeof measurementReadingUpdateRecipe>,
) => invokeFitnessOperation(client, measurementReadingUpdateRecipe, input);

export const deleteMeasurementReadings = (
	client: Client,
	input: RecipeInput<typeof measurementReadingDeleteRecipe>,
) => invokeFitnessOperation(client, measurementReadingDeleteRecipe, input);

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
