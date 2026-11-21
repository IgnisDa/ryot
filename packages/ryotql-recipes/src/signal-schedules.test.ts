import { describe, expect, it } from "bun:test";

import { EntitySchemaSlug, PluginId } from "@ryot-app/contract/schema/brands";
import {
	castDate,
	castText,
	column,
	eq,
	field,
	gte,
	isNull,
	jsonPath,
	literal,
	lt,
	or,
	pluginId,
	table,
} from "@ryot-app/ryotql";
import { objectContaining } from "@ryot-app/testing/matchers";
import { Result } from "effect";

import { signalScheduleRecipe, type SignalScheduleSource } from "./signal-schedules";
import { bindRecipe, requireRowsQuery, rowsResult } from "./test-utils";

const entity = table("entity", "record");
const owner = PluginId.make("plugin-1");
const dueAt = castDate(jsonPath(column(entity, "properties"), "dueAt"));
const confirmedAt = column(entity, "updatedAt");
const where = eq(
	column(entity, "entitySchemaPluginId"),
	pluginId({ kind: "local", pluginId: owner }),
);

const schedule: SignalScheduleSource = {
	dueAt: "dueAt",
	slug: "tasks-due",
	occurrence: "occurrence",
	freshness: { confirmedAt: "confirmedAt" },
	properties: { name: "unused", label: "label" },
	subject: {
		entityAlias: "record",
		schemas: [
			{ slug: EntitySchemaSlug.make("record"), owner: { kind: "plugin", pluginId: owner } },
		],
	},
	query: {
		where,
		from: entity,
		output: {
			type: "rows",
			fields: [
				field("dueAt", dueAt),
				field("confirmedAt", confirmedAt),
				field("unused", column(entity, "name")),
				field("occurrence", column(entity, "id")),
				field("label", castText(jsonPath(column(entity, "properties"), "label"))),
			],
		},
	},
};

const bounds = {
	end: "2026-03-15T00:00:00.000Z",
	start: "2026-03-12T00:00:00.000Z",
	confirmedAfter: "2026-03-13T00:00:00.000Z",
};

const page = (
	input: {
		readonly after?: string;
		readonly limit?: number;
		readonly schedule?: SignalScheduleSource;
		readonly bounds?: {
			readonly end: string;
			readonly start: string;
			readonly confirmedAfter: null | string;
		};
	} = {},
) =>
	bindRecipe(
		Result.getOrThrow(signalScheduleRecipe({ schedule: input.schedule ?? schedule })),
		input.bounds ?? bounds,
		undefined,
		{
			pages: {
				signalScheduleDue: {
					limit: input.limit ?? 10,
					...(input.after === undefined ? {} : { after: input.after }),
				},
			},
		},
	);

const decodeWithNext = (next: readonly unknown[]) =>
	Result.getOrThrow(
		page().decode({
			data: {
				signalScheduleNext: rowsResult(next, { limit: 1, hasMore: false, nextCursor: null }),
				signalScheduleDue: rowsResult(
					[
						{
							unused: null,
							label: "Step 2",
							__scheduleSubjectId: "record-1",
							__scheduleOccurrence: "record-1",
						},
					],
					{ limit: 10, hasMore: true, nextCursor: "next" },
				),
			},
		}),
	);

describe("signal schedule recipe", () => {
	it("selects fresh occurrences due inside the window in a stable order", () => {
		const query = requireRowsQuery(page().document.queries["signalScheduleDue"]);
		expect(query.where).toEqual<unknown>({
			type: "and",
			predicates: [
				where,
				objectContaining({ type: "or" }),
				gte(dueAt, castDate(literal(bounds.start))),
				lt(dueAt, castDate(literal(bounds.end))),
				or(isNull(confirmedAt), gte(confirmedAt, castDate(literal(bounds.confirmedAfter)))),
			],
		});
		expect(query.output.orderBy.map(({ expr }) => expr)).toEqual<unknown>([
			dueAt,
			column(entity, "id"),
		]);
		expect(query.output.pagination).toEqual({ limit: 10 });
		const unbounded = requireRowsQuery(
			page({ bounds: { ...bounds, confirmedAfter: null } }).document.queries["signalScheduleDue"],
		);
		expect(unbounded.where).toMatchObject({ predicates: { length: 5 } });
	});

	it("selects the earliest fresh due time at or after the window end", () => {
		const query = requireRowsQuery(page().document.queries["signalScheduleNext"]);
		expect(query.where).toEqual<unknown>({
			type: "and",
			predicates: [
				where,
				objectContaining({ type: "or" }),
				gte(dueAt, castDate(literal(bounds.end))),
				or(isNull(confirmedAt), gte(confirmedAt, castDate(literal(bounds.confirmedAfter)))),
			],
		});
		expect(query.output.orderBy.map(({ expr }) => expr)).toEqual<unknown>([dueAt]);
		expect(query.output.fields).toEqual<unknown>([field("__scheduleDueAt", dueAt)]);
	});

	it("decodes declared properties, omits null values and reads the next due time", () => {
		expect(decodeWithNext([{ __scheduleDueAt: "2026-03-20T00:00:00.000Z" }])).toEqual({
			signalScheduleNext: "2026-03-20T00:00:00.000Z",
			signalScheduleDue: {
				pageInfo: { hasMore: true, nextCursor: "next" },
				items: [{ subjectId: "record-1", occurrence: "record-1", properties: { label: "Step 2" } }],
			},
		});
		expect(decodeWithNext([]).signalScheduleNext).toBeNull();
	});

	it("rejects schedules that do not project their fields", () => {
		for (const candidate of [
			{ ...schedule, dueAt: "x" },
			{ ...schedule, occurrence: "x" },
			{ ...schedule, freshness: { confirmedAt: "x" } },
		]) {
			expect(Result.isFailure(signalScheduleRecipe({ schedule: candidate }))).toBe(true);
		}
	});
});
