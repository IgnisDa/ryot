import { expect } from "bun:test";

import { CHANGE_SET_LIMITS } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { englishRenderer, signalAutomationInput } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import { englishCatalog } from "../../tests/english-catalog";
import definition, { manifest } from "./notification.sandbox";

const cases = [
	["review.created", { entityName: "Dune" }, "Review posted for Dune"],
	...(
		[
			"person.media.associated",
			"company.media.associated",
			"person.media-group.associated",
			"company.media-group.associated",
		] as const
	).map(
		(slug) =>
			[
				slug,
				{
					subjectName: "Greta Gerwig",
					associations: [
						{ role: "Director", associatedName: "Barbie", associatedEntityId: "barbie" },
					],
				},
				"Greta Gerwig has been associated with Barbie as Director",
			] as const,
	),
	[
		"person.media.associated",
		{
			subjectName: "Frank Herbert",
			associations: [{ roleCode: "author", associatedName: "Dune", associatedEntityId: "dune" }],
		},
		"Frank Herbert has been associated with Dune as an author",
	],
	[
		"media.status.changed",
		{ newStatus: "Ended", oldStatus: "Airing", entityName: "Severance" },
		"Status of Severance changed from Airing to Ended",
	],
	[
		"media.content-count.changed",
		{ oldCount: 100, newCount: 101, entityName: "One Piece", contentType: "chapters" },
		"Number of chapters changed from 100 to 101 for One Piece",
	],
	[
		"media.season-count.changed",
		{ oldCount: 1, newCount: 2, entityName: "Severance" },
		"Number of seasons changed from 1 to 2 for Severance",
	],
	[
		"media.episode.discovered",
		{ oldCount: 7, newCount: 10, seasonNumber: 2, discoveredCount: 3, entityName: "Severance" },
		"3 new episodes discovered in season 2 for Severance",
	],
	[
		"media.episode.discovered",
		{ oldCount: 0, newCount: 1, discoveredCount: 1, entityName: "Podcast" },
		"1 new episode discovered for Podcast",
	],
	[
		"media.release-date.changed",
		{ oldYear: 2025, newYear: 2026, entityName: "Dune", changeKind: "publish_year" },
		"Publish year changed from 2025 to 2026 for Dune",
	],
	[
		"media.release-date.changed",
		{
			seasonNumber: 2,
			episodeNumber: 1,
			oldDate: "2026-01-01",
			newDate: "2026-02-01",
			entityName: "Severance",
			changeKind: "episode_date",
		},
		"Episode release date changed from Jan 1, 2026 to Feb 1, 2026 (S2E1) for Severance",
	],
	[
		"media.episode.name.changed",
		{ oldName: null, episodeNumber: 3, newName: "Premiere", entityName: "Podcast" },
		'Episode name changed from no name to "Premiere" (EP3) for Podcast',
	],
	[
		"media.episode.name.changed",
		{ newName: null, oldName: "Pilot", episodeNumber: 3, entityName: "Podcast" },
		'Episode name changed from "Pilot" to no name (EP3) for Podcast',
	],
	[
		"media.episode.images.changed",
		{ episodeNumber: 3, entityName: "Podcast" },
		"Episode image changed for EP3 in Podcast",
	],
	["media.released", { entityName: "Dune" }, "Dune has been released today"],
	[
		"media.released",
		{ seasonNumber: 2, episodeNumber: 5, entityName: "Severance" },
		"S2E5 of Severance has been released today",
	],
	[
		"media.released",
		{ episodeNumber: 12, entityName: "Frieren" },
		"EP12 of Frieren has been released today",
	],
	[
		"media.progress-stale",
		{ days: 7, entityName: "Dune", lifecycleState: "in_progress" },
		"Dune has been in progress for 7 days without activity",
	],
	[
		"media.progress-stale",
		{ days: 14, entityName: "Dune", lifecycleState: "on_hold" },
		"Dune has been on hold for 14 days without activity",
	],
	[
		"media.episodes-available",
		{ entityName: "Severance" },
		"New episodes of Severance are available",
	],
] as const;

it("projects every property the formatted signals read", () => {
	const projected = new Set<string>(manifest.inputProjection.signal.properties);
	for (const [, properties] of cases) {
		for (const key of Object.keys(properties)) {
			expect(projected).toContain(key);
		}
	}
});

const render = englishRenderer(englishCatalog);

const notify = (signalSchemaSlug: string, properties: Readonly<Record<string, unknown>>) =>
	Effect.gen(function* () {
		const result = yield* definition.run(
			yield* signalAutomationInput({
				properties,
				signalSchemaSlug,
				hookSlug: "media.test",
				signalSchemaPluginId: "media-plugin",
			}),
		);
		return result.changes.notifications.map(render);
	});

it.effect.each(cases)(
	"builds the %s message exclusively from the signal snapshot",
	([slug, properties, expected]) =>
		Effect.gen(function* () {
			expect(yield* notify(slug, properties)).toEqual([expected]);
		}),
	testTimeout,
);

const associations = (count: number) =>
	Array.from({ length: count }, (_, index) => ({
		role: "Director",
		associatedName: `Title ${index + 1}`,
		associatedEntityId: `title-${index + 1}`,
	}));

it.effect(
	"notifies once per association a subject gained",
	() =>
		Effect.gen(function* () {
			expect(
				yield* notify("person.media.associated", {
					subjectName: "Greta Gerwig",
					associations: [
						...associations(1),
						{ roleCode: "author", associatedName: "Title 2", associatedEntityId: "title-2" },
					],
				}),
			).toEqual([
				"Greta Gerwig has been associated with Title 1 as Director",
				"Greta Gerwig has been associated with Title 2 as an author",
			]);
		}),
	testTimeout,
);

it.effect(
	"counts the associations past the notification limit in its last message",
	() =>
		Effect.gen(function* () {
			const messages = yield* notify("person.media.associated", {
				subjectName: "Greta Gerwig",
				associations: associations(25),
			});
			expect(messages).toHaveLength(CHANGE_SET_LIMITS.notifications);
			expect(messages.at(-2)).toBe("Greta Gerwig has been associated with Title 19 as Director");
			expect(messages.at(-1)).toBe("Greta Gerwig has 6 more new credits");
		}),
	testTimeout,
);
