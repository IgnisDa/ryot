import { expect } from "bun:test";

import { stampRyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { PluginRevisionId } from "@ryot-app/contract/schema/brands";
import { RyotQLService } from "@ryot-app/kernel-backend/modules/ryotql/service";
import type { Recipe } from "@ryot-app/plugin-kit/ryotql";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer, Result } from "effect";

import {
	insertEntities,
	insertEvents,
	libraryId,
	mediaDatabaseLayer,
	mediaPluginId,
} from "../../tests/media-database";
import { mediaFoldEventsRecipe } from "./recipes";

const at = (hour: number) => new Date(Date.UTC(2026, 0, 1, hour));

const seed = Effect.gen(function* () {
	yield* insertEntities([
		{ id: "show", slug: "show" },
		{ slug: "show", id: "other-show" },
		{ id: "episode", slug: "show-episode" },
	]);
	yield* insertEvents([
		{ slug: "progress", entityId: "show", occurredAt: at(1), id: "show-progress" },
		{
			slug: "complete",
			occurredAt: at(2),
			entityId: "episode",
			id: "episode-complete",
			sessionEntityId: "show",
		},
		{ slug: "progress", occurredAt: at(3), id: "episode-alone", entityId: "episode" },
		{
			slug: "review",
			entityId: "show",
			occurredAt: at(4),
			id: "show-in-other-session",
			sessionEntityId: "other-show",
		},
		{
			slug: "progress",
			entityId: "show",
			occurredAt: at(5),
			id: "show-in-library-session",
			sessionEntityId: libraryId("owner"),
		},
		{ slug: "seen", id: "show-seen", entityId: "show", occurredAt: at(6) },
	]);
});

const ids = (
	argumentsValue: Omit<Recipe.Arguments<typeof mediaFoldEventsRecipe>, "subjectEntityId">,
) =>
	read({ ...argumentsValue, subjectEntityId: "show" }).pipe(
		Effect.map((events) => events.map(({ id }) => id)),
	);

const read = (argumentsValue: Recipe.Arguments<typeof mediaFoldEventsRecipe>) =>
	Effect.gen(function* () {
		const service = yield* RyotQLService;
		const response = yield* service.executeForUser(
			"owner",
			null,
			"plugin",
			{
				arguments: argumentsValue,
				source: {
					kind: "inline",
					document: stampRyotQLDocument("media", mediaFoldEventsRecipe.document),
				},
			},
			"standard",
			undefined,
			{ pluginId: mediaPluginId, pluginRevisionId: PluginRevisionId.make("media-revision") },
		);
		return Result.getOrThrow(mediaFoldEventsRecipe.decode(response)).items;
	});

layer(Layer.effectDiscard(seed).pipe(Layer.provideMerge(mediaDatabaseLayer("media_fold_events"))))(
	(test) => {
		test.effect(
			"reads a subject's fold events as the kernel routes them, with ISO timestamps",
			() =>
				Effect.gen(function* () {
					const events = yield* read({ subjectEntityId: "show" });
					expect(events.map(({ id }) => id)).toEqual<unknown>([
						"episode-complete",
						"show-in-library-session",
						"show-progress",
					]);
					expect(events.find(({ id }) => id === "episode-complete")).toMatchObject({
						entityId: "episode",
						sessionEntityId: "show",
						entitySchemaSlug: "show-episode",
						occurredAt: "2026-01-01T02:00:00.000Z",
					});
					expect(
						(yield* read({ subjectEntityId: "other-show" })).map(({ id }) => id),
					).toEqual<unknown>(["show-in-other-session"]);
				}),
		);

		test.effect("narrows the subject's events by each set parameter", () =>
			Effect.gen(function* () {
				expect(yield* ids({ entityId: "episode" })).toEqual<unknown>(["episode-complete"]);
				expect(yield* ids({ slugs: ["progress"] })).toEqual<unknown>([
					"show-in-library-session",
					"show-progress",
				]);
				expect(
					yield* ids({ from: at(2).toISOString(), until: at(5).toISOString() }),
				).toEqual<unknown>(["episode-complete", "show-in-library-session"]);
				expect(yield* ids({ excluded: ["show-progress"] })).toEqual<unknown>([
					"episode-complete",
					"show-in-library-session",
				]);
			}),
		);
	},
);
