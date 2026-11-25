import { expect } from "bun:test";

import type { NamedQuery } from "@ryot-app/contract/modules/ryotql/authored";
import {
	and,
	ascending,
	castDate,
	castNumber,
	coalesce,
	column,
	count,
	descending,
	document,
	eq,
	exists,
	field,
	first,
	gte,
	join,
	jsonPath,
	literal,
	lt,
	rows,
	sum,
	table,
} from "@ryot-app/ryotql";
import { validateAuthoredFixture } from "@ryot-app/ryotql/fixture.test-support";
import { assert } from "@ryot-app/testing/assert";
import { it } from "@voila.dev/effect-bun-test";

import { planQuery, planScopes } from "./planner";

const execution = {
	type: "user",
	weekStart: 1,
	language: null,
	userId: "owner",
	audience: "plugin",
	accessClass: "standard",
} as const;

const plan = (query: NamedQuery) => {
	const validated = validateAuthoredFixture(document({ query }), execution);
	assert(validated.value !== null, validated.error ?? "invalid document");
	const expanded = validated.value.queries["query"];
	assert(expanded !== undefined);
	return planQuery(expanded, execution);
};

const root = table("entity", "root");
const event = table("event", "event");
const batch = table("entity", "batch");
const slot = (reference: typeof event) =>
	castNumber(jsonPath(column(reference, "properties"), "slot"));
const range = and(
	gte(column(event, "occurredAt"), castDate(literal("2026-01-01T00:00:00Z"))),
	lt(column(event, "occurredAt"), castDate(literal("2026-02-01T00:00:00Z"))),
);
const correlation = eq(column(event, "entityId"), column(root, "id"));

it("fuses identical correlated query sets into one group per scope, except in join conditions", () => {
	const where = and(correlation, range);
	const score = coalesce(sum(event, slot(event), { where }), literal(0));
	const planned = plan(
		rows(root, {
			orderBy: [descending(score)],
			joins: [join("left", batch, eq(count(event, { where }), literal(1)))],
			fields: [field("score", score), field("count", count(event, { where }))],
		}),
	);
	expect([...planned.groups.values()].map((group) => group.measures.size)).toEqual([2]);
	expect(planned.children.size).toBe(1);
});

it("fuses firsts sharing a query and ordering that a scope reads more than once, except lone, join-condition and JSON firsts", () => {
	const latest = (select: Parameters<typeof first>[1]["select"]) =>
		first(event, {
			select,
			where: correlation,
			orderBy: [descending(column(event, "occurredAt"))],
		});
	const planned = plan(
		rows(root, {
			joins: [join("left", batch, eq(column(batch, "id"), latest(column(event, "entityId"))))],
			fields: [
				field("slug", latest(column(event, "eventSchemaSlug"))),
				field("sameSlug", latest(column(event, "eventSchemaSlug"))),
				field("session", latest(column(event, "sessionEntityId"))),
				field("properties", latest(column(event, "properties"))),
				field(
					"earliest",
					first(event, {
						where: correlation,
						select: column(event, "id"),
						orderBy: [ascending(column(event, "occurredAt"))],
					}),
				),
			],
		}),
	);
	expect([...planned.firsts.values()].map((group) => [...group.values.values()].length)).toEqual([
		2,
	]);
	expect(planned.children.size).toBe(1);
});

it("hoists a closed range and outer-independent JSON keys of fused aggregates", () => {
	const ranged = plan(
		rows(root, { fields: [field("count", count(event, { where: and(correlation, range) }))] }),
	);
	const [rangedGroup] = ranged.groups.values();
	assert(rangedGroup !== undefined);
	expect([...rangedGroup.scope.hoisted.keys()]).toEqual(["event"]);
	expect(rangedGroup.scope.hoisted.get("event")?.local).toHaveLength(2);

	const keyed = table("event", "keyed");
	const joined = plan(
		rows(root, {
			fields: [
				field(
					"count",
					count(event, {
						where: correlation,
						joins: [join("inner", keyed, eq(slot(keyed), slot(event)))],
					}),
				),
			],
		}),
	);
	const [joinedGroup] = joined.groups.values();
	assert(joinedGroup !== undefined);
	expect([...joinedGroup.scope.hoisted.keys()]).toEqual(["keyed"]);
	expect(joinedGroup.scope.hoisted.get("keyed")?.keys.size).toBe(1);

	const unhoisted = plan(
		rows(root, {
			fields: [
				field(
					"count",
					count(event, {
						where: and(correlation, range),
						joins: [join("left", keyed, eq(slot(keyed), slot(event)))],
					}),
				),
			],
		}),
	);
	expect(planScopes(unhoisted).every((scope) => scope.hoisted.size === 0)).toBe(true);
});

it("plans catalog fields referenced from nested correlated queries", () => {
	const planned = plan(
		rows(root, {
			fields: [field("id", column(root, "id"))],
			where: exists(event, {
				where: and(correlation, eq(column(event, "projectionStatus"), literal("ready"))),
			}),
		}),
	);
	const [child] = planned.children.values();
	expect(child?.tables.get("event")?.fields).toEqual(new Set(["entityId", "projectionStatus"]));
	expect(planned.tables.get("root")?.fields).toEqual(new Set(["id"]));
});
