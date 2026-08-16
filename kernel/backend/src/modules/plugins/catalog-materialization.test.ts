import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { publishAfterCatalogMaterialization } from "./catalog-materialization";

it.effect("refreshes all affected user surfaces before publishing a system catalog change", () => {
	const operations: string[] = [];
	return Effect.gen(function* () {
		yield* publishAfterCatalogMaterialization(
			Effect.succeed([UserId.make("first"), UserId.make("second")]),
			(userId) =>
				Effect.sync(() => {
					operations.push(`views:${userId}`);
				}),
			(userId) =>
				Effect.sync(() => {
					operations.push(`builds:${userId}`);
				}),
			Effect.sync(() => {
				operations.push("publish");
			}),
		);
		expect(operations).toEqual([
			"views:first",
			"builds:first",
			"views:second",
			"builds:second",
			"publish",
		]);
	});
});

it.effect("does not publish when an affected user's materialization fails", () => {
	const operations: string[] = [];
	return Effect.gen(function* () {
		const result = yield* Effect.exit(
			publishAfterCatalogMaterialization(
				Effect.succeed([UserId.make("first"), UserId.make("second")]),
				(userId) =>
					Effect.sync(() => {
						operations.push(`views:${userId}`);
					}),
				(userId) =>
					userId === "second"
						? Effect.fail("build failed")
						: Effect.sync(() => {
								operations.push(`builds:${userId}`);
							}),
				Effect.sync(() => {
					operations.push("publish");
				}),
			),
		);
		expect(result._tag).toBe("Failure");
		expect(operations).toEqual(["views:first", "builds:first", "views:second"]);
	});
});
