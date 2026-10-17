import {
	measurementMetricCreateRecipe,
	measurementMetricPinRecipe,
	measurementReadingDeleteRecipe,
	measurementReadingLogRecipe,
	measurementReadingUpdateRecipe,
} from "@ryot-app/fitness-plugin/contracts/operation-recipes";
import {
	type MeasurementEntryReading,
	measurementEntryReadingsRecipe,
	type MeasurementSummary,
	measurementSummaryRecipe,
} from "@ryot-app/fitness-plugin/measurement-recipes";
import { measurementEntryListRecipe } from "@ryot-app/fitness-plugin/query-recipes";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import { listEventSchemas, requireEventSchemaBySlug } from "~/fixtures/kernel/event-schemas";
import { waitForCreateEvents } from "~/fixtures/kernel/events";
import {
	invokeEncodedOperation,
	invokeOperation,
	type RecipeEncodedInput,
	type RecipeInput,
} from "~/fixtures/kernel/operations";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";

import { findFitnessEntitySchema } from "./exercises";

export const createMeasurementMetric = (
	client: Client,
	input: RecipeEncodedInput<typeof measurementMetricCreateRecipe>,
) => invokeEncodedOperation(client, measurementMetricCreateRecipe, input);

export const pinMeasurementMetric = (
	client: Client,
	input: RecipeInput<typeof measurementMetricPinRecipe>,
) => invokeOperation(client, measurementMetricPinRecipe, input);

type SubmissionKeys = "submissionId" | "submittedAt";
type ReadingLogInput = RecipeEncodedInput<typeof measurementReadingLogRecipe>;

export const logMeasurementReadings = (
	client: Client,
	input: Omit<ReadingLogInput, SubmissionKeys> & Partial<Pick<ReadingLogInput, SubmissionKeys>>,
) =>
	invokeEncodedOperation(client, measurementReadingLogRecipe, {
		...input,
		submissionId: input.submissionId ?? crypto.randomUUID(),
		submittedAt: input.submittedAt ?? new Date().toISOString(),
	});

export const updateMeasurementReadings = (
	client: Client,
	input: RecipeInput<typeof measurementReadingUpdateRecipe>,
) => invokeOperation(client, measurementReadingUpdateRecipe, input);

export const deleteMeasurementReadings = (
	client: Client,
	input: RecipeInput<typeof measurementReadingDeleteRecipe>,
) => invokeOperation(client, measurementReadingDeleteRecipe, input);

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
		const { schema: entrySchema } = yield* findFitnessEntitySchema(client, "measurement-entry");
		const entry = yield* createEntity(client, {
			name: "Measurement",
			entitySchema: entrySchema.reference,
			properties: { comment: "Morning", occurredAt: "2026-04-27T08:00:00.000Z" },
		});
		yield* waitForCreateEvents(
			client,
			yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: metric.id,
							sessionEntityId: entry.id,
							properties: { value: 75.5 },
							eventSchemaSlug: readingSchema.id,
							occurredAt: "2026-04-27T08:00:00Z",
						},
					],
				}),
			),
		);

		return { entryId: entry.id, metricId: metric.id };
	});

export const readMeasurementLogReadings = Effect.fn(function* (
	client: Client,
	input: Parameters<typeof measurementEntryListRecipe>[0],
) {
	const entries = yield* executeRyotQLRecipe(client, measurementEntryListRecipe(input));
	const metrics = new Map<string, MeasurementSummary>();
	let after: string | undefined;
	do {
		const page = yield* executeRyotQLRecipe(
			client,
			measurementSummaryRecipe({
				after,
				reference: input.reference,
				rangeStart: "1970-01-01T00:00:00.000Z",
			}),
		);
		for (const metric of page.items) {
			metrics.set(metric.id, metric);
		}
		after = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
	} while (after !== undefined);
	const batches = yield* Effect.forEach(entries.items, (entry) =>
		Effect.gen(function* () {
			const values: MeasurementEntryReading[] = [];
			let childAfter: string | undefined;
			do {
				const page = yield* executeRyotQLRecipe(
					client,
					measurementEntryReadingsRecipe({
						after: childAfter,
						entryId: entry.id,
						reference: input.reference,
					}),
				);
				values.push(...page.items);
				childAfter = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
			} while (childAfter !== undefined);
			return values
				.map((reading) => {
					const metric = metrics.get(reading.metricId);
					if (metric === undefined) {
						throw new Error("Expected measurement metric");
					}
					return {
						id: reading.id,
						entryId: entry.id,
						unit: metric.unit,
						value: reading.value,
						metricKey: metric.key,
						comment: entry.comment,
						metricName: metric.name,
						metricId: reading.metricId,
						occurredAt: entry.occurredAt,
					};
				})
				.sort((left, right) => (left.metricKey ?? "").localeCompare(right.metricKey ?? ""));
		}),
	);
	return { ...entries, items: batches.flat() };
});
