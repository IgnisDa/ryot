import { describe, expect } from "bun:test";

import {
	type AutomationPolicyInput,
	automationPolicyInputSchema,
} from "@ryot-app/plugin-backend-sdk/automation";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

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
	it.effect(
		"retains independent numbered items without reading current metadata",
		() =>
			Effect.gen(function* () {
				const test = harness({ episodes: 999, chapters: 999 });
				const inputs: Parameters<typeof policyAutomationContext>[0][] = [
					{
						entitySchemaSlug: "anime",
						properties: {
							sourceRun: "seen:a",
							position: { position: 12, unit: "episodes" },
							consumptionBasis: { unit: "episodes", property: "episodes" },
						},
					},
					{
						entitySchemaSlug: "anime",
						properties: {
							sourceRun: "seen:b",
							position: { position: 12, unit: "episodes" },
							consumptionBasis: { unit: "episodes", property: "episodes" },
						},
					},
					{
						entitySchemaSlug: "manga",
						properties: {
							position: { volume: 7, position: 42.5, unit: "chapters" },
							consumptionBasis: { unit: "chapters", property: "chapters" },
						},
					},
					{
						entitySchemaSlug: "manga",
						properties: {
							position: { position: 8, unit: "volumes" },
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
		testTimeout,
	);
	it.effect(
		"rejects volume context on volumes and items with cumulative progress",
		() =>
			Effect.gen(function* () {
				const test = harness();
				const inputs: Parameters<typeof policyAutomationContext>[0][] = [
					{
						entitySchemaSlug: "manga",
						properties: { position: { volume: 1, position: 1, unit: "volumes" } },
					},
					{
						entitySchemaSlug: "anime",
						properties: { progressPercent: 50, position: { position: 1, unit: "episodes" } },
					},
					{
						entitySchemaSlug: "manga",
						properties: {
							sourceProgress: { volume: 1, percent: 50, position: 1, unit: "volumes" },
						},
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
		testTimeout,
	);
	it.effect(
		"captures exact page evidence and a frozen metadata basis",
		() =>
			Effect.gen(function* () {
				const test = harness({ pages: 123 });
				expect(
					yield* test.run(
						yield* policyAutomationContext({
							entitySchemaSlug: "book",
							eventSchemaSlug: "progress",
							properties: { progressPages: 40, calendarDate: "2025-12-31" },
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
		testTimeout,
	);
	it.effect(
		"does not fill missing historical metadata or reread retained estimates",
		() =>
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
		testTimeout,
	);
	it.effect(
		"preserves snapshots through unrelated edits and attempts to recapture",
		() =>
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
							draft: { ...payload.draft, properties: { consumedOn: ["Changed"] } },
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
		testTimeout,
	);
	it.effect(
		"measures a volume run against the volume total and recaptures when an edit switches units",
		() =>
			Effect.gen(function* () {
				const test = harness({ volumes: 12, chapters: 120 });
				const context = yield* policyAutomationContext({
					entitySchemaSlug: "manga",
					eventSchemaSlug: "progress",
					properties: { position: { position: 3, unit: "volumes" } },
				});
				expect(yield* test.run(context)).toMatchObject({
					action: "transform",
					patch: {
						draft: {
							properties: {
								set: { consumptionBasis: { total: 12, unit: "volumes", property: "volumes" } },
							},
						},
					},
				});
				const payload = context.automation.payload;
				if (payload.resource !== "event" || payload.operation !== "create") {
					throw new Error("Expected event create");
				}
				const chapterBasis = { total: 120, unit: "chapters", property: "chapters" };
				const before = {
					...payload.draft,
					id: "source",
					createdAt: payload.draft.occurredAt,
					updatedAt: payload.draft.occurredAt,
					properties: {
						consumptionBasis: chapterBasis,
						position: { position: 30, unit: "chapters" },
					},
				};
				const edit = (position: Schema.Json) =>
					Schema.decodeEffect(automationPolicyInputSchema)({
						automation: {
							...context.automation,
							payload: {
								...payload,
								before,
								operation: "update",
								changedProperties: ["position"],
								draft: {
									...payload.draft,
									properties: { position, consumptionBasis: chapterBasis },
								},
							},
						},
					});
				expect(yield* test.run(yield* edit({ position: 31, unit: "chapters" }))).toEqual({
					action: "allow",
				});
				expect(yield* test.run(yield* edit({ position: 3, unit: "volumes" }))).toMatchObject({
					action: "transform",
					patch: {
						draft: { properties: { set: { consumptionBasis: { total: 12, unit: "volumes" } } } },
					},
				});
			}),
		testTimeout,
	);
	it.effect(
		"accepts a volume basis only where a manga volume run can carry it",
		() =>
			Effect.gen(function* () {
				const test = harness();
				const volumes = { total: 12, unit: "volumes", property: "volumes" };
				expect(
					yield* test.run(
						yield* policyAutomationContext({
							entitySchemaSlug: "manga",
							eventSchemaSlug: "complete",
							properties: { consumptionBasis: volumes, completionKey: "progress:a" },
						}),
					),
				).toEqual({ action: "allow" });
				const inputs: Parameters<typeof policyAutomationContext>[0][] = [
					{
						entitySchemaSlug: "manga",
						eventSchemaSlug: "progress",
						properties: { consumptionBasis: volumes, position: { position: 3, unit: "chapters" } },
					},
					{
						entitySchemaSlug: "book",
						eventSchemaSlug: "complete",
						properties: { consumptionBasis: volumes },
					},
				];
				for (const input of inputs) {
					expect(yield* test.run(yield* policyAutomationContext(input))).toMatchObject({
						action: "reject",
					});
				}
				expect(test.reads()).toBe(0);
			}),
		testTimeout,
	);
	it.effect(
		"rejects duplicate amount forms, contradictory or distant date evidence and game estimates",
		() =>
			Effect.gen(function* () {
				const test = harness();
				const inputs: Parameters<typeof policyAutomationContext>[0][] = [
					{ properties: { sourceRun: "seen:missing-basis" } },
					{ entitySchemaSlug: "book", properties: { progressPages: 40, progressPercent: 40 } },
					{ properties: { dateUnknown: true, calendarDate: "2026-01-01" } },
					{ properties: { calendarDate: "2026-01-03" } },
					{ properties: { calendarDate: "2025-12-30" } },
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
		testTimeout,
	);
});
