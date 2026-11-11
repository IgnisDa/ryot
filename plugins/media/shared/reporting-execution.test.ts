import { expect } from "bun:test";

import type { ReportingSelection } from "@ryot-app/contract/modules/analytics/reporting";
import { PluginId, PluginRevisionId } from "@ryot-app/contract/schema/brands";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { defaultUserPreferences } from "@ryot-app/contract/schema/user-preferences";
import { RyotQLService } from "@ryot-app/kernel-backend/modules/ryotql/service";
import { DatabaseSession } from "@ryot-app/kernel-backend/platform/db/session";
import * as tables from "@ryot-app/kernel-backend/schema/tables/combined";
import { makeAppConfigLayer } from "@ryot-app/kernel-backend/testing/effect";
import { isolatedDatabaseLayer } from "@ryot-app/kernel-backend/testing/isolated-database";
import {
	and,
	column,
	dateBucket,
	defineRecipe,
	eq,
	groupAscending,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import {
	reportingArguments,
	reportingGroupingExpression,
	reportingParameterFields,
	reportingPeriodPredicate,
	reportingWindow,
} from "@ryot-app/ryotql-recipes/reporting-parameters";
import { parameters, reportingTimeZone } from "@ryot-app/ryotql/authoring";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer, Result, Schema } from "effect";
import { TestClock } from "effect/testing";

import { mediaAnalyticsSummaryRecipe, mediaAnalyticsTrendRecipe } from "./analytics-recipes";
import { consumptionPeriod } from "./consumption-recipes";
import { PLUGIN_PACKAGE_ID } from "./plugin-identity";

const input = parameters({
	fields: {
		...reportingParameterFields,
		entityId: {
			type: "string",
			label: "Entity",
			description: "Event owner",
			validation: { required: true },
		},
	},
});
const event = table("event", "reportedEvent");
const query = (side?: "current" | "previous") =>
	selectedAggregate(event, {
		limit: 366,
		orderBy: [groupAscending("at")],
		measures: { count: selectedMeasure({ function: "count" }, Schema.Finite) },
		where: and(
			eq(column(event, "entityId"), input.value("entityId")),
			reportingPeriodPredicate(column(event, "occurredAt"), side),
		),
		groupBy: {
			at: selectedField(
				reportingGroupingExpression((bucket) =>
					dateBucket(column(event, "occurredAt"), { bucket, timeZone: reportingTimeZone }),
				),
				Schema.String,
			),
		},
	});
const recipe = defineRecipe({
	parameters: input.schema,
	queries: {
		requested: query(),
		current: query("current"),
		previous: query("previous"),
		windowPrevious: selectedAggregate(event, {
			measures: { count: selectedMeasure({ function: "count" }, Schema.Finite) },
			where: and(
				eq(column(event, "entityId"), input.value("entityId")),
				consumptionPeriod(event, reportingWindow("previous")),
			),
		}),
	},
});
const eventTimes = {
	compared: ["2026-10-20T12:00:00Z", "2026-10-29T12:00:00Z"],
	cap: ["2026-01-01T12:00:00Z", "2026-01-04T12:00:00Z", "2026-01-05T12:00:00Z"],
	calendar: [
		"2026-12-31T23:59:00-05:00",
		"2027-01-01T00:00:00-05:00",
		"2027-01-31T23:59:00-05:00",
		"2027-02-01T00:00:00-05:00",
	],
	dst: [
		"2025-10-31T23:59:00-04:00",
		"2025-11-01T00:00:00-04:00",
		"2026-10-25T23:59:00-04:00",
		"2026-10-31T23:59:00-04:00",
		"2026-11-01T00:00:00-04:00",
		"2026-11-01T01:30:00-04:00",
		"2026-11-01T01:30:00-05:00",
		"2026-11-01T23:59:00-05:00",
		"2026-11-02T00:00:00-05:00",
	],
};
const seed = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db
				.insert(tables.user)
				.values({
					name: "Reporter",
					id: "report-owner",
					email: "report-owner@test.local",
					preferences: {
						...defaultUserPreferences,
						reportingTimeZone: TimeZone.make("America/New_York"),
					},
				});
			yield* db
				.insert(tables.entity)
				.values(
					Object.keys(eventTimes).map((id) => ({
						id,
						name: id,
						userId: "report-owner",
						entitySchemaSlug: "root",
					})),
				);
			yield* db
				.insert(tables.plugin)
				.values({ status: "inactive", id: "report-plugin", packageId: PLUGIN_PACKAGE_ID });
			yield* db
				.insert(tables.event)
				.values(
					Object.entries(eventTimes).flatMap(([entityId, times]) =>
						times.map((at, index) => ({
							entityId,
							userId: "report-owner",
							occurredAt: new Date(at),
							id: `${entityId}-${index}`,
							eventSchemaSlug: entityId === "compared" ? "complete" : "occurrence",
							eventSchemaPluginId: entityId === "compared" ? "report-plugin" : null,
						})),
					),
				);
			yield* db
				.insert(tables.derivedValue)
				.values(
					Object.entries(eventTimes).flatMap(([entityId, times]) =>
						times.map((at, index) => ({
							kind: "event" as const,
							userId: "report-owner",
							pluginId: "report-plugin",
							subjectEntityId: entityId,
							targetId: `${entityId}-${index}`,
							pluginRevisionId: "report-revision",
							value: {
								contribution: {
									titleCompletions: 1,
									activeObservation: true,
									attribution: { value: at, kind: "instant" },
									minutes: { recorded: 6, estimated: 0, missing: false, supersededEstimate: false },
								},
							},
						})),
					),
				);
		}),
	);
});
const database = Layer.merge(RyotQLService.layer, Layer.effectDiscard(seed)).pipe(
	Layer.provideMerge(isolatedDatabaseLayer("media_reporting")),
	Layer.provide(makeAppConfigLayer()),
);
const read = (
	entityId: string,
	selection: ReportingSelection,
	consistency = false,
	comparisonSide: "current" | "previous" = "current",
) =>
	Effect.gen(function* () {
		const service = yield* RyotQLService;
		return Result.getOrThrow(
			recipe.decode(
				yield* service.executeForUser("report-owner", null, "plugin", {
					source: { kind: "inline", document: recipe.document },
					arguments: { entityId, ...reportingArguments(selection, comparisonSide), consistency },
				}),
			),
		);
	});
const total = (rows: readonly { readonly count: number }[]) =>
	rows.reduce((sum, row) => sum + row.count, 0);
layer(Layer.effectContext(TestClock.withLive(Layer.build(database))))((test) => {
	test.effect(
		"decodes empty canonical reports with comparison selection independent of event data",
		() =>
			Effect.gen(function* () {
				const service = yield* RyotQLService;
				yield* TestClock.setTime(Date.parse("2026-11-01T18:00:00Z"));
				const reference = { kind: "self" } as const;
				const definitionContext = {
					pluginId: PluginId.make("report-plugin"),
					pluginRevisionId: PluginRevisionId.make("report-revision"),
				};
				for (const [selection, consistency, enabled] of [
					[
						{ grouping: "day", comparison: "none", range: { days: 7, kind: "rolling" } },
						false,
						false,
					],
					[
						{ grouping: "day", range: { kind: "all-time" }, comparison: "previous-period" },
						false,
						false,
					],
					[
						{ grouping: "day", comparison: "previous-period", range: { days: 7, kind: "rolling" } },
						true,
						false,
					],
					[
						{ grouping: "day", comparison: "previous-period", range: { days: 7, kind: "rolling" } },
						false,
						true,
					],
				] as const) {
					const argumentsValue = {
						...reportingArguments(selection),
						consistency,
						entityId: "no-events",
					};
					const summary = mediaAnalyticsSummaryRecipe({ reference });
					const report = Result.getOrThrow(
						summary.decode(
							yield* service.executeForUser(
								"report-owner",
								null,
								"plugin",
								{
									arguments: argumentsValue,
									source: { kind: "inline", document: summary.document },
								},
								"standard",
								undefined,
								definitionContext,
							),
						),
					);
					expect(report.current).toEqual({ types: [], reviews: [], activeDays: 0 });
					expect(report.previous).toEqual(
						enabled ? { types: [], reviews: [], activeDays: 0 } : null,
					);
					const trend = mediaAnalyticsTrendRecipe({ reference });
					const series = Result.getOrThrow(
						trend.decode(
							yield* service.executeForUser(
								"report-owner",
								null,
								"plugin",
								{ arguments: argumentsValue, source: { kind: "inline", document: trend.document } },
								"standard",
								undefined,
								definitionContext,
							),
						),
					);
					expect(series.current).toEqual({ items: [] });
					expect(series.previous).toEqual(enabled ? { items: [] } : null);
				}
			}),
	);

	test.effect("decodes canonical previous-period contributions when comparison is enabled", () =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			yield* TestClock.setTime(Date.parse("2026-11-01T18:00:00Z"));
			const trend = mediaAnalyticsTrendRecipe({ reference: { kind: "self" } });
			const series = Result.getOrThrow(
				trend.decode(
					yield* service.executeForUser(
						"report-owner",
						null,
						"plugin",
						{
							source: { kind: "inline", document: trend.document },
							arguments: {
								...reportingArguments({
									grouping: "day",
									comparison: "previous-period",
									range: { days: 7, kind: "rolling" },
								}),
								entityId: "compared",
							},
						},
						"standard",
						undefined,
						{
							pluginId: PluginId.make("report-plugin"),
							pluginRevisionId: PluginRevisionId.make("report-revision"),
						},
					),
				),
			);
			expect(series.current.items).toMatchObject([
				{ at: "2026-10-29", minutesRecorded: 6, titleCompletions: 1 },
			]);
			expect(series.previous).toMatchObject({
				items: [{ at: "2026-10-20", minutesRecorded: 6, titleCompletions: 1 }],
			});
		}),
	);

	test.effect(
		"suppresses every previous-period path for comparison none and all-time, including the unbounded window",
		() =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.parse("2026-11-01T18:00:00Z"));
				const selection = {
					grouping: "day",
					comparison: "none",
					range: { days: 7, kind: "rolling" },
				} as const;
				const current = yield* read("dst", selection);
				expect(total(current.current.items)).toBe(5);
				expect(total(current.previous.items)).toBe(0);
				expect(current.windowPrevious.count).toBe(0);
				const disabled = yield* read("dst", selection, false, "previous");
				expect(total(disabled.requested.items)).toBe(0);
				const compared = yield* read(
					"dst",
					{ ...selection, comparison: "previous-period" },
					false,
					"previous",
				);
				expect(total(compared.previous.items)).toBe(1);
				expect(total(compared.requested.items)).toBe(1);
				expect(compared.windowPrevious.count).toBe(1);
				const allTime = yield* read(
					"dst",
					{ ...selection, range: { kind: "all-time" }, comparison: "previous-period" },
					false,
					"previous",
				);
				expect(total(allTime.current.items)).toBe(9);
				expect(total(allTime.previous.items)).toBe(0);
				expect(total(allTime.requested.items)).toBe(0);
				expect(allTime.windowPrevious.count).toBe(0);
			}),
	);

	test.effect(
		"uses the server clock and account zone through the repeated DST hour and comparison day",
		() =>
			Effect.gen(function* () {
				const selection = {
					grouping: "day",
					comparison: "previous-period",
					range: { days: 7, kind: "rolling" },
				} as const;
				const argumentsBefore = reportingArguments(selection);
				yield* TestClock.setTime(Date.parse("2026-11-01T18:00:00Z"));
				const first = yield* read("dst", selection);
				expect(total(first.current.items)).toBe(5);
				expect(total(first.previous.items)).toBe(1);
				yield* TestClock.setTime(Date.parse("2026-11-08T18:00:00Z"));
				const second = yield* read("dst", selection);
				expect(total(second.current.items)).toBe(1);
				expect(total(second.previous.items)).toBe(5);
				expect(reportingArguments(selection)).toEqual(argumentsBefore);
			}),
	);
	test.effect(
		"keeps local week, month and year boundaries and their preceding comparison periods",
		() =>
			Effect.gen(function* () {
				for (const [unit, now, current, previous] of [
					["week", "2027-02-01T18:00:00Z", 1, 1],
					["month", "2027-02-01T18:00:00Z", 1, 2],
					["year", "2027-01-01T18:00:00Z", 3, 1],
				] as const) {
					yield* TestClock.setTime(Date.parse(now));
					const result = yield* read("calendar", {
						grouping: "day",
						comparison: "previous-period",
						range: { unit, offset: 0, kind: "calendar" },
					});
					expect(total(result.current.items)).toBe(current);
					expect(total(result.previous.items)).toBe(previous);
				}
			}),
	);
	test.effect("coarsens bounded buckets using actual server-calendar alignment", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse("2026-01-05T18:00:00Z"));
			const explicit = yield* read("cap", {
				grouping: "day",
				comparison: "none",
				range: { kind: "custom", endDate: "2026-01-05", startDate: "2025-01-01" },
			});
			expect(explicit.current.items).toHaveLength(2);
			expect(explicit.current.items.map((row) => row.count)).toEqual([2, 1]);
			const automatic = yield* read("cap", {
				grouping: "auto",
				comparison: "none",
				range: { days: 365, kind: "rolling" },
			});
			expect(automatic.current.items.map((row) => row.count)).toEqual([2, 1]);
		}),
	);
	test.effect(
		"clips consistency at the selected civil end, forces daily grouping and disables comparison",
		() =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.parse("2026-11-01T18:00:00Z"));
				const allTime = yield* read(
					"dst",
					{ grouping: "year", range: { kind: "all-time" }, comparison: "previous-period" },
					true,
				);
				expect(allTime.current.items.map((row) => row.count)).toEqual([1, 1, 1, 4]);
				expect(allTime.previous.items).toEqual([]);
				const short = yield* read(
					"dst",
					{
						grouping: "month",
						comparison: "previous-period",
						range: { kind: "custom", endDate: "2026-11-01", startDate: "2026-11-01" },
					},
					true,
					"previous",
				);
				expect(short.current.items.map((row) => row.count)).toEqual([4]);
				expect(short.previous.items).toEqual([]);
				yield* TestClock.setTime(Date.parse("2027-02-15T18:00:00Z"));
				const calendar = yield* read(
					"calendar",
					{
						grouping: "year",
						comparison: "previous-period",
						range: { offset: -1, unit: "month", kind: "calendar" },
					},
					true,
				);
				expect(calendar.current.items.map((row) => row.count)).toEqual([1, 1]);
				expect(calendar.previous.items).toEqual([]);
				const custom = yield* read(
					"dst",
					{
						grouping: "year",
						comparison: "none",
						range: { kind: "custom", endDate: "2026-11-01", startDate: "2025-01-01" },
					},
					true,
				);
				expect(custom.current.items.map((row) => row.count)).toEqual([1, 1, 1, 4]);
			}),
	);
});
