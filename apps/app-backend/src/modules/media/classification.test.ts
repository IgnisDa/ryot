import { describe, expect, it } from "bun:test";
import {
	compareContinueItems,
	compareRateTheseItems,
	compareUpNextItems,
	resolveBuiltInMediaLifecycleState,
	resolveBuiltInMediaRateTheseMembership,
} from "./classification";

const date = (value: string) => new Date(value);

describe("resolveBuiltInMediaLifecycleState", () => {
	it("classifies direct progress as continue without a backlog event", () => {
		expect(
			resolveBuiltInMediaLifecycleState({
				backlogAt: null,
				completeAt: null,
				progressAt: date("2026-03-20T10:00:00.000Z"),
			}),
		).toBe("continue");
	});

	it("classifies latest backlog as up next", () => {
		expect(
			resolveBuiltInMediaLifecycleState({
				completeAt: null,
				progressAt: null,
				backlogAt: date("2026-03-20T10:00:00.000Z"),
			}),
		).toBe("upNext");
	});

	it("excludes current-state sections when complete is the latest lifecycle event", () => {
		expect(
			resolveBuiltInMediaLifecycleState({
				backlogAt: date("2026-03-18T10:00:00.000Z"),
				progressAt: date("2026-03-19T10:00:00.000Z"),
				completeAt: date("2026-03-20T10:00:00.000Z"),
			}),
		).toBeNull();
	});
});

describe("resolveBuiltInMediaRateTheseMembership", () => {
	it("includes items with a completion and no review", () => {
		expect(
			resolveBuiltInMediaRateTheseMembership({
				reviewAt: null,
				completedOn: null,
				completeAt: date("2026-03-20T10:00:00.000Z"),
			}),
		).toBe(true);
	});

	it("re-enters rate these when a later completion follows a review", () => {
		expect(
			resolveBuiltInMediaRateTheseMembership({
				reviewAt: date("2026-03-20T10:00:00.000Z"),
				completeAt: date("2026-03-21T10:00:00.000Z"),
				completedOn: date("2026-03-22T10:00:00.000Z"),
			}),
		).toBe(true);
	});

	it("excludes items when the latest review catches up to the latest completion", () => {
		expect(
			resolveBuiltInMediaRateTheseMembership({
				reviewAt: date("2026-03-22T10:00:00.000Z"),
				completeAt: date("2026-03-21T10:00:00.000Z"),
				completedOn: date("2026-03-22T10:00:00.000Z"),
			}),
		).toBe(false);
	});
});

describe("overview comparators", () => {
	it("sorts continue items by latest progress descending with entity id fallback", () => {
		const items = [
			{ entityId: "b", progressAt: date("2026-03-20T10:00:00.000Z") },
			{ entityId: "a", progressAt: date("2026-03-20T10:00:00.000Z") },
			{ entityId: "c", progressAt: date("2026-03-19T10:00:00.000Z") },
		];

		expect(
			items.sort(compareContinueItems).map((item) => item.entityId),
		).toEqual(["a", "b", "c"]);
	});

	it("sorts up next items by latest backlog descending", () => {
		const items = [
			{ entityId: "c", backlogAt: date("2026-03-18T10:00:00.000Z") },
			{ entityId: "a", backlogAt: date("2026-03-20T10:00:00.000Z") },
			{ entityId: "b", backlogAt: date("2026-03-19T10:00:00.000Z") },
		];

		expect(items.sort(compareUpNextItems).map((item) => item.entityId)).toEqual(
			["a", "b", "c"],
		);
	});

	it("sorts rate these items by completedOn before complete createdAt fallback", () => {
		const items = [
			{
				entityId: "b",
				completeAt: date("2026-03-18T10:00:00.000Z"),
				completedOn: date("2026-03-20T10:00:00.000Z"),
			},
			{
				entityId: "a",
				completedOn: null,
				completeAt: date("2026-03-19T10:00:00.000Z"),
			},
			{
				entityId: "c",
				completedOn: null,
				completeAt: date("2026-03-21T10:00:00.000Z"),
			},
		];

		expect(
			items.sort(compareRateTheseItems).map((item) => item.entityId),
		).toEqual(["c", "b", "a"]);
	});
});
