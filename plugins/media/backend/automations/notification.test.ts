import { expect } from "bun:test";

import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { englishRenderer } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import { automationContext } from "../../tests/backend/automations/automation-test-utils";
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
				{ role: "Director", associatedName: "Barbie", subjectName: "Greta Gerwig" },
				"Greta Gerwig has been associated with Barbie as Director",
			] as const,
	),
	[
		"person.media.associated",
		{ roleCode: "author", associatedName: "Dune", subjectName: "Frank Herbert" },
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

it.effect.each(cases)(
	"builds the %s message exclusively from the signal snapshot",
	([slug, properties, expected]) =>
		Effect.gen(function* () {
			const result = yield* definition.run(
				yield* automationContext({
					properties,
					operation: "emit",
					category: "signal",
					resource: "signal",
					actorUserId: "user-1",
					signalSchemaSlug: slug,
					signalSchemaPluginId: "media-plugin",
				}),
			);
			expect(result.changes.notifications.map(render)).toEqual([expected]);
		}),
	testTimeout,
);
