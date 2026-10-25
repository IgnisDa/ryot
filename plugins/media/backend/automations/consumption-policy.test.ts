import { describe, expect, it } from "@effect/vitest";
import {
	type AutomationPolicyInput,
	automationPolicyInputSchema,
} from "@ryot-app/plugin-backend-sdk/automation";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";

import {
	policyAutomationContext,
	ryotqlRows,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./consumption-policy.sandbox";

const harness = (properties: Readonly<Record<string, Schema.Json>> = {}) => {
	let reads = 0;
	const host = defineSandboxTestHost(manifest, {
		executeRyotql: () => {
			reads += 1;
			return Effect.succeed(ryotqlRows("target", [{ properties }]));
		},
	});
	return {
		reads: () => reads,
		run: (context: AutomationPolicyInput) => {
			const { payload, ...automation } = context.automation;
			return definition
				.run({ automation, items: [{ payload, itemIdentity: "source" }] }, host)
				.pipe(Effect.map((result) => result.items[0]?.decision));
		},
	};
};

describe("consumption policy", () => {
	it.effect("retains independent numbered items without reading current metadata", () =>
		Effect.gen(function* () {
			const test = harness({ episodes: 999, chapters: 999 });
			const inputs: Parameters<typeof policyAutomationContext>[0][] = [
				{
					entitySchemaSlug: "anime",
					properties: {
						sourceRun: "seen:a",
						consumedItem: { position: 12, unit: "episodes" },
						consumptionBasis: { unit: "episodes", property: "episodes" },
					},
				},
				{
					entitySchemaSlug: "anime",
					properties: {
						sourceRun: "seen:b",
						consumedItem: { position: 12, unit: "episodes" },
						consumptionBasis: { unit: "episodes", property: "episodes" },
					},
				},
				{
					entitySchemaSlug: "manga",
					properties: {
						consumptionBasis: { unit: "chapters", property: "chapters" },
						consumedItem: { volume: 7, position: 42.5, unit: "chapters" },
					},
				},
				{
					entitySchemaSlug: "manga",
					properties: {
						consumedItem: { position: 8, unit: "volumes" },
						consumptionBasis: { unit: "chapters", property: "chapters" },
					},
				},
			];
			for (const input of inputs) {
				expect(
					yield* test.run(
						yield* policyAutomationContext({ ...input, eventSchemaSlug: "item-complete" }),
					),
				).toEqual({ action: "allow" });
			}
			expect(test.reads()).toBe(0);
		}),
	);
	it.effect("rejects item identities that imply another unit or cumulative progress", () =>
		Effect.gen(function* () {
			const test = harness();
			const inputs: Parameters<typeof policyAutomationContext>[0][] = [
				{ properties: {}, entitySchemaSlug: "anime" },
				{
					entitySchemaSlug: "anime",
					properties: { consumedItem: { position: 1.5, unit: "episodes" } },
				},
				{
					entitySchemaSlug: "anime",
					properties: { consumedItem: { position: 1, unit: "chapters" } },
				},
				{
					entitySchemaSlug: "anime",
					properties: { consumedItem: { volume: 1, position: 1, unit: "episodes" } },
				},
				{
					entitySchemaSlug: "manga",
					properties: { consumedItem: { position: 1, unit: "episodes" } },
				},
				{
					entitySchemaSlug: "manga",
					properties: { consumedItem: { volume: 1, position: 1, unit: "volumes" } },
				},
				{
					entitySchemaSlug: "anime",
					properties: { animeEpisode: 1, consumedItem: { position: 1, unit: "episodes" } },
				},
				{
					entitySchemaSlug: "manga",
					properties: { consumedItem: { position: -1, unit: "chapters" } },
				},
			];
			for (const input of inputs) {
				expect(
					yield* test.run(
						yield* policyAutomationContext({ ...input, eventSchemaSlug: "item-complete" }),
					),
				).toMatchObject({ action: "reject" });
			}
			expect(test.reads()).toBe(0);
		}),
	);
	it.effect("captures exact page evidence and a frozen metadata basis", () =>
		Effect.gen(function* () {
			const test = harness({ pages: 123 });
			expect(
				yield* test.run(
					yield* policyAutomationContext({
						entitySchemaSlug: "book",
						eventSchemaSlug: "progress",
						properties: { progressPages: 40, calendarDate: "2026-02-01" },
					}),
				),
			).toEqual({
				action: "transform",
				patch: {
					resource: "event",
					draft: {
						properties: {
							remove: [],
							set: { consumptionBasis: { total: 123, unit: "pages", property: "pages" } },
						},
					},
				},
			});
			expect(test.reads()).toBe(1);
		}),
	);
	it.effect("does not fill missing historical metadata or reread retained estimates", () =>
		Effect.gen(function* () {
			const test = harness({ runtime: 999 });
			expect(
				yield* test.run(
					yield* policyAutomationContext({
						eventSchemaSlug: "complete",
						properties: {
							dateUnknown: true,
							consumptionBasis: { unit: "minutes", property: "runtime" },
						},
					}),
				),
			).toEqual({ action: "allow" });
			expect(test.reads()).toBe(0);
		}),
	);
	it.effect("preserves snapshots through unrelated edits and attempts to recapture", () =>
		Effect.gen(function* () {
			const test = harness({ runtime: 999 });
			const context = yield* policyAutomationContext({
				eventSchemaSlug: "complete",
				properties: { consumptionBasis: { total: 90, unit: "minutes", property: "runtime" } },
			});
			const payload = context.automation.payload;
			if (payload.resource !== "event" || payload.operation !== "create") {
				throw new Error("Expected event create");
			}
			const update = yield* Schema.decodeEffect(automationPolicyInputSchema)({
				automation: {
					...context.automation,
					payload: {
						...payload,
						operation: "update",
						changedProperties: ["consumedOn", "consumptionBasis"],
						draft: { ...payload.draft, properties: { consumedOn: "Changed" } },
						before: {
							...payload.draft,
							id: "source",
							createdAt: payload.draft.occurredAt,
							updatedAt: payload.draft.occurredAt,
						},
					},
				},
			});
			expect(yield* test.run(update)).toMatchObject({
				action: "transform",
				patch: { draft: { properties: { set: { consumptionBasis: { total: 90 } } } } },
			});
			expect(test.reads()).toBe(0);
		}),
	);
	it.effect("rejects duplicate amount forms, invalid date evidence and game estimates", () =>
		Effect.gen(function* () {
			const test = harness();
			const inputs: Parameters<typeof policyAutomationContext>[0][] = [
				{ properties: { sourceRun: "seen:missing-basis" } },
				{ properties: { sourceRun: " " } },
				{ entitySchemaSlug: "book", properties: { progressPages: 40, progressPercent: 40 } },
				{ properties: { calendarDate: "2026-02-29" } },
				{ properties: { dateUnknown: true, calendarDate: "2026-02-01" } },
				{
					entitySchemaSlug: "video-game",
					properties: { consumptionBasis: { total: 999, unit: "minutes" } },
				},
			];
			for (const input of inputs) {
				expect(yield* test.run(yield* policyAutomationContext(input))).toMatchObject({
					action: "reject",
				});
			}
			expect(test.reads()).toBe(0);
		}),
	);
});
