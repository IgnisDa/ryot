import { expect, it } from "@effect/vitest";
import type { ImportEntityRunResult } from "@ryot-app/contract/modules/provider-entities/schemas";
import { ProviderEntityImportBacklogFull } from "@ryot-app/contract/modules/provider-entities/schemas";
import { EntityId, EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import {
	importProviderEntity,
	type ProviderEntityImportEntry,
	PROVIDER_IMPORT_BACKLOG_FULL_MESSAGE,
	PROVIDER_IMPORT_FAILED_MESSAGE,
	PROVIDER_IMPORT_TIMEOUT_MESSAGE,
	PROVIDER_IMPORT_UNAVAILABLE_MESSAGE,
} from "#/modules/provider-add/import-controller";
import { ProviderAddLoadError } from "#/modules/provider-add/service";

const completed = {
	status: "completed",
	data: {
		name: "Dune",
		properties: {},
		providerId: null,
		populatedAt: null,
		externalId: "ext-1",
		id: EntityId.make("entity-1"),
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		entitySchemaSlug: EntitySchemaSlug.make("book"),
	},
} satisfies ImportEntityRunResult;

const scripted = (results: readonly ImportEntityRunResult[]) => {
	const pending = [...results];
	return () => Effect.sync(() => pending.shift() ?? ({ status: "running" } as const));
};

it.effect("polls a pending job until it completes", () =>
	Effect.gen(function* () {
		const fiber = yield* Effect.forkChild(
			importProviderEntity({
				onProgress: () => undefined,
				start: Effect.succeed({ jobId: "job-1" }),
				poll: scripted([{ status: "running" }, { status: "running" }, completed]),
			}),
		);

		yield* TestClock.adjust("2 seconds");
		yield* TestClock.adjust("2 seconds");

		expect(yield* Fiber.join(fiber)).toEqual({ status: "imported", entityId: "entity-1" });
	}),
);

it.effect("surfaces a failed run result without waiting further", () =>
	Effect.gen(function* () {
		const entry = yield* importProviderEntity({
			onProgress: () => undefined,
			start: Effect.succeed({ jobId: "job-1" }),
			poll: scripted([
				{ status: "failed", reason: { stage: "population", code: "import-failed" } },
			]),
		});

		expect(entry).toEqual({ status: "failed", message: PROVIDER_IMPORT_FAILED_MESSAGE });
	}),
);

it.effect("reports a stable message when the job never leaves pending", () =>
	Effect.gen(function* () {
		let attempts = 0;
		const fiber = yield* Effect.forkChild(
			importProviderEntity({
				onProgress: () => undefined,
				start: Effect.succeed({ jobId: "job-1" }),
				poll: () =>
					Effect.sync(() => {
						attempts += 1;
						return { status: "running" } as const;
					}),
			}),
		);

		yield* TestClock.adjust("2 minutes");

		expect(yield* Fiber.join(fiber)).toEqual({
			status: "failed",
			message: PROVIDER_IMPORT_TIMEOUT_MESSAGE,
		});
		expect(attempts).toBe(61);
	}),
);

it.effect("reports a stable message when the job cannot be started", () =>
	Effect.gen(function* () {
		const entry = yield* importProviderEntity({
			onProgress: () => undefined,
			start: Effect.fail("offline"),
			poll: () => Effect.die("unreachable"),
		});

		expect(entry).toEqual({ status: "failed", message: PROVIDER_IMPORT_UNAVAILABLE_MESSAGE });
	}),
);

it.effect("reports queued and running progress without spending the timeout while queued", () =>
	Effect.gen(function* () {
		const progress: ProviderEntityImportEntry["status"][] = [];
		const fiber = yield* Effect.forkChild(
			importProviderEntity({
				start: Effect.succeed({ jobId: "job-1" }),
				onProgress: (entry) => progress.push(entry.status),
				poll: scripted([
					...Array.from({ length: 100 }, () => ({ status: "queued" }) as const),
					{ status: "running" },
					completed,
				]),
			}),
		);

		yield* TestClock.adjust("202 seconds");

		expect(yield* Fiber.join(fiber)).toEqual({ status: "imported", entityId: "entity-1" });
		expect(progress.filter((status) => status === "queued")).toHaveLength(100);
		expect(progress.at(-1)).toBe("importing");
	}),
);

it.effect("tells the user to retry later when their import backlog is full", () =>
	Effect.gen(function* () {
		const entry = yield* importProviderEntity({
			onProgress: () => undefined,
			poll: () => Effect.die("unreachable"),
			start: Effect.fail(
				new ProviderAddLoadError({
					stage: "import",
					cause: new ProviderEntityImportBacklogFull({
						reason: { limit: 50, retryAfterSeconds: 30, code: "import-backlog-full" },
					}),
				}),
			),
		});

		expect(entry).toEqual({ status: "failed", message: PROVIDER_IMPORT_BACKLOG_FULL_MESSAGE });
	}),
);
