import type { AutomationInput } from "@ryot/sandbox-sdk/automation";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot/sandbox-sdk/testing";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import { expect, it } from "vitest";

import definition, { manifest } from "./notification.sandbox";

const input = (
	signalSchemaSlug: string,
	properties: Record<string, JsonValue>,
): AutomationInput => ({
	automation: {
		ruleId: "rule-1",
		operation: "signal",
		origin: { kind: "api" },
		occurrenceId: "signal-1",
		occurredAt: "2026-07-20T10:00:00.000Z",
		source: {
			kind: "signal",
			signal: {
				properties,
				id: "signal-1",
				signalSchemaSlug,
				origin: { kind: "api" },
				occurredAt: "2026-07-20T10:00:00.000Z",
			},
		},
	},
});

it.each([
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
				{ role: "Director", subjectName: "Greta Gerwig", associatedName: "Barbie" },
				"Greta Gerwig has been associated with Barbie as Director",
			] as const,
	),
	[
		"media.status.changed",
		{ entityName: "Severance", oldStatus: "Airing", newStatus: "Ended" },
		"Status of Severance changed from Airing to Ended",
	],
	[
		"media.content-count.changed",
		{ entityName: "One Piece", contentType: "chapters", oldCount: 100, newCount: 101 },
		"Number of chapters changed from 100 to 101 for One Piece",
	],
	[
		"media.season-count.changed",
		{ entityName: "Severance", oldCount: 1, newCount: 2 },
		"Number of seasons changed from 1 to 2 for Severance",
	],
	[
		"media.episode.discovered",
		{ entityName: "Severance", discoveredCount: 3, oldCount: 7, newCount: 10, seasonNumber: 2 },
		"3 new episodes discovered in season 2 for Severance",
	],
	[
		"media.release-date.changed",
		{ entityName: "Dune", changeKind: "publish_year", oldYear: 2025, newYear: 2026 },
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
		"Episode release date changed from 2026-01-01 to 2026-02-01 (S2E1) for Severance",
	],
	[
		"media.episode.name.changed",
		{ oldName: null, episodeNumber: 3, newName: "Premiere", entityName: "Podcast" },
		'Episode name changed from null to "Premiere" (EP3) for Podcast',
	],
	[
		"media.episode.images.changed",
		{ entityName: "Podcast", episodeNumber: 3 },
		"Episode image changed for EP3 in Podcast",
	],
] as const)("formats %s exclusively from the signal snapshot", (slug, properties, expected) => {
	const messages: string[] = [];
	return Effect.runPromise(
		definition.drivers.automation
			.run(
				input(slug, properties),
				defineSandboxTestHost(manifest, {
					sendNotification: (message) => {
						messages.push(message);
						return Effect.succeed(null);
					},
				}),
				{ metadata: {}, sandboxScriptId: "script-1" },
			)
			.pipe(
				Effect.map((result) => {
					expect(result).toBeNull();
					expect(messages).toEqual([expected]);
					return undefined;
				}),
			),
	);
});
