import { expect, it } from "@effect/vitest";
import type { ImportEntityRunResult } from "@ryot-app/contract/modules/provider-entities/schemas";
import { EntityId, EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import {
	importProviderEntity,
	PROVIDER_IMPORT_FAILED_MESSAGE,
	PROVIDER_IMPORT_TIMEOUT_MESSAGE,
	PROVIDER_IMPORT_UNAVAILABLE_MESSAGE,
} from "#/modules/provider-add/import-controller";

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
			start: Effect.fail("offline"),
			poll: () => Effect.die("unreachable"),
		});

		expect(entry).toEqual({ status: "failed", message: PROVIDER_IMPORT_UNAVAILABLE_MESSAGE });
	}),
);
