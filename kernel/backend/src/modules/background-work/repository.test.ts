import { expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { assert } from "vitest";

import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { BackgroundWorkRepository } from "./repository";

const testLayer = BackgroundWorkRepository.layer.pipe(Layer.provideMerge(revisionDatabaseLayer));

layer(testLayer)((test) => {
	test.effect("prunes old settled work except each scope's latest and streams' current jobs", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* BackgroundWorkRepository;
			const now = Date.parse("2026-10-28T00:00:00.000Z");
			yield* TestClock.setTime(now);
			const { pluginId } = yield* installRevisionPackage(revisionPackage("work"));
			const at = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000);
			const work = (
				id: string,
				scope: string,
				status: "failed" | "queued" | "succeeded",
				hoursAgo: number,
			) => ({
				id,
				scope,
				status,
				key: id,
				pluginId,
				payload: {},
				inputHash: id,
				userId: "owner",
				accountToken: "token",
				createdAt: at(hoursAgo),
				updatedAt: at(hoursAgo),
				purpose: "user-script" as const,
			});
			yield* session.run((db) =>
				db
					.insert(tables.backgroundWork)
					.values([
						work("old-succeeded", "a", "succeeded", 400),
						work("old-failed", "a", "failed", 300),
						work("latest", "a", "failed", 100),
						work("only", "b", "failed", 400),
						work("queued", "c", "queued", 400),
						work("queued-newer", "c", "succeeded", 300),
						work("stream-job", "d", "failed", 400),
						work("stream-newer", "d", "succeeded", 300),
					]),
			);
			const [entity] = yield* session.run((db) =>
				db
					.insert(tables.entity)
					.values({ name: "Stream", userId: "owner", entitySchemaSlug: "stream" })
					.returning({ id: tables.entity.id }),
			);
			assert(entity);
			yield* session.run((db) =>
				db
					.insert(tables.eventStream)
					.values({ id: "stream", userId: "owner", entityId: entity.id, eventSchemaSlug: "seen" }),
			);
			yield* session.run((db) =>
				db
					.insert(tables.eventStreamWork)
					.values({
						id: "stream",
						pluginPin: {},
						accountToken: "token",
						currentJobId: "stream-job",
						processorScriptId: "script",
						outputSchema: { fields: {} },
						pluginRevisionId: "revision",
					}),
			);

			expect(yield* repository.pruneSettled(100)).toBe(2);

			const remaining = yield* session.run((db) =>
				db.select({ id: tables.backgroundWork.id }).from(tables.backgroundWork),
			);
			expect(new Set(remaining.map(({ id }) => id))).toEqual(
				new Set(["only", "latest", "queued", "stream-job", "queued-newer", "stream-newer"]),
			);
		}),
	);
});
