import { expect, it } from "@effect/vitest";
import { Conflict, DbError } from "@ryot/contract/errors";
import { TrackerId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import type { MockOverrides } from "#lib/test-support/effect";
import type { CreateDefaultSavedViewPayload } from "#modules/entity-schemas/durable-queues";

import { processDefaultSavedView } from "./default-view-worker";
import { SavedViewsService } from "./service";

const mockSavedViewsService = Layer.mock(SavedViewsService);

const makeSavedViewsService = (overrides: MockOverrides<typeof mockSavedViewsService> = {}) =>
	mockSavedViewsService({ _tag: "SavedViewsService", ...overrides });

const payload = {
	icon: "book",
	executionId: "exec-1",
	accentColor: "#FF5733",
	entitySchemaName: "Book",
	entitySchemaSlug: "book",
	userId: UserId.make("user-id"),
	trackerId: TrackerId.make("tracker-id"),
} satisfies CreateDefaultSavedViewPayload;

it.effect("swallows a Conflict when the default saved view already exists", () => {
	const layer = makeSavedViewsService({
		createDefaultForSchema: () =>
			Effect.fail(new Conflict({ message: "Entity schema default saved view already exists" })),
	});

	return Effect.exit(processDefaultSavedView(payload)).pipe(
		Effect.tap((exit) => Effect.sync(() => expect(exit._tag).toBe("Success"))),
		Effect.provide(layer),
	);
});

it.effect("propagates database errors from default saved view creation", () => {
	const layer = makeSavedViewsService({
		createDefaultForSchema: () => Effect.fail(new DbError({ message: "schema lookup failed" })),
	});

	return Effect.exit(processDefaultSavedView(payload)).pipe(
		Effect.tap((exit) =>
			Effect.sync(() =>
				expect(exit).toEqual(Exit.fail(new DbError({ message: "schema lookup failed" }))),
			),
		),
		Effect.provide(layer),
	);
});
