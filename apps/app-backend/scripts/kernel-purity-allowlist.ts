import type { PurityAllowlistEntry } from "./kernel-purity";

type RemovalTask = Extract<PurityAllowlistEntry, { kind: "temporary" }>["removalTask"];

const temporary = (
	removalTask: RemovalTask,
	reason: string,
	entries: ReadonlyArray<readonly [path: string, term: string]>,
) =>
	entries.map(([path, term]) => ({
		path,
		term,
		reason,
		removalTask,
		kind: "temporary" as const,
	}));

const importEventMembership = temporary(
	3,
	"Task 03 moves import and event library membership into the media plugin",
	[
		["apps/app-backend/src/app/kernel-workflow-references.ts", "library"],
		["apps/app-backend/src/app/kernel-workflow-references.ts", "library-membership"],
		["apps/app-backend/src/lib/infrastructure/config/service.ts", "library"],
		["apps/app-backend/src/modules/events/durable-queues.ts", "library"],
		["apps/app-backend/src/modules/events/event-create-workflow-live.ts", "library"],
		["apps/app-backend/src/modules/imports/generic-import-workflow.ts", "library"],
		[
			"apps/app-backend/src/modules/library-membership/library-entity-import-workflow.ts",
			"library",
		],
		["apps/app-backend/src/modules/library-membership/membership-worker.ts", "library"],
		["apps/app-backend/src/modules/library-membership/operations-workflow.ts", "library"],
		["apps/app-backend/src/modules/sandbox/kernel-workflow-references.ts", "library"],
	],
);

const collectionUserStateMembership = temporary(
	4,
	"Task 04 removes native collection and user-state media library policy",
	[
		["apps/app-backend/src/app/layers.ts", "library"],
		["apps/app-backend/src/app/layers.ts", "library-membership"],
		["apps/app-backend/src/app/server.ts", "library"],
		["apps/app-backend/src/app/server.ts", "library-membership"],
		["apps/app-backend/src/modules/collections/repository.ts", "library"],
		["apps/app-backend/src/modules/collections/service.ts", "in-library"],
		["apps/app-backend/src/modules/collections/service.ts", "library"],
		["apps/app-backend/src/modules/library-membership/routes.ts", "library"],
		["apps/app-backend/src/modules/library-membership/service.ts", "library"],
		["apps/app-backend/src/modules/user-state/service.ts", "library"],
		["libs/contract/src/contract.ts", "library"],
		["libs/contract/src/contract.ts", "library-membership"],
		["libs/contract/src/modules/library-membership/contract.ts", "library"],
	],
);

const importEnvelope = temporary(5, "Task 05 replaces the closed first-party import source union", [
	["libs/contract/src/modules/imports/schemas.ts", "anilist"],
	["libs/contract/src/modules/imports/schemas.ts", "anime"],
	["libs/contract/src/modules/imports/schemas.ts", "audiobookshelf"],
	["libs/contract/src/modules/imports/schemas.ts", "goodreads"],
	["libs/contract/src/modules/imports/schemas.ts", "grouvee"],
	["libs/contract/src/modules/imports/schemas.ts", "hardcover"],
	["libs/contract/src/modules/imports/schemas.ts", "hevy"],
	["libs/contract/src/modules/imports/schemas.ts", "igdb"],
	["libs/contract/src/modules/imports/schemas.ts", "imdb"],
	["libs/contract/src/modules/imports/schemas.ts", "jellyfin"],
	["libs/contract/src/modules/imports/schemas.ts", "manga"],
	["libs/contract/src/modules/imports/schemas.ts", "media"],
	["libs/contract/src/modules/imports/schemas.ts", "media_tracker"],
	["libs/contract/src/modules/imports/schemas.ts", "movary"],
	["libs/contract/src/modules/imports/schemas.ts", "myanimelist"],
	["libs/contract/src/modules/imports/schemas.ts", "netflix"],
	["libs/contract/src/modules/imports/schemas.ts", "open_scale"],
	["libs/contract/src/modules/imports/schemas.ts", "plex"],
	["libs/contract/src/modules/imports/schemas.ts", "storygraph"],
	["libs/contract/src/modules/imports/schemas.ts", "strong_app"],
	["libs/contract/src/modules/imports/schemas.ts", "trakt"],
	["libs/contract/src/modules/imports/schemas.ts", "watcharr"],
]);

const queryRecipes = temporary(6, "Task 06 moves domain query recipes into their plugin packages", [
	["libs/query-engine/src/recipes/app.ts", "in-library"],
	["libs/query-engine/src/recipes/app.ts", "library"],
	["libs/query-engine/src/recipes/fitness.ts", "exercise"],
	["libs/query-engine/src/recipes/fitness.ts", "measurement"],
	["libs/query-engine/src/recipes/fitness.ts", "workout"],
	["libs/query-engine/src/recipes/fitness.ts", "workout-template"],
	["libs/query-engine/src/recipes/fitness.ts", "workout-to-workout-template"],
	["libs/query-engine/src/recipes/media.ts", "in-library"],
	["libs/query-engine/src/recipes/media.ts", "library"],
	["libs/query-engine/src/recipes/media.ts", "media"],
	["libs/query-engine/src/recipes/media.ts", "media-suggestion"],
	["libs/query-engine/src/recipes/media.ts", "media-trending"],
	["libs/query-engine/src/recipes/media.ts", "podcast"],
	["libs/query-engine/src/recipes/media.ts", "podcast-episode"],
	["libs/query-engine/src/recipes/media.ts", "podcast-to-podcast-episode"],
	["libs/query-engine/src/recipes/media.ts", "show"],
	["libs/query-engine/src/recipes/media.ts", "show-episode"],
	["libs/query-engine/src/recipes/media.ts", "show-season"],
	["libs/query-engine/src/recipes/media.ts", "show-season-to-show-episode"],
	["libs/query-engine/src/recipes/media.ts", "show-to-show-season"],
]);

const operationalGate = temporary(
	7,
	"Task 07 makes production operational test support domain-neutral",
	[
		["apps/app-backend/src/modules/test-support/operational-gate-service.ts", "media"],
		[
			"apps/app-backend/src/modules/test-support/operational-gate-service.ts",
			"media-import-population",
		],
		["apps/app-backend/src/modules/test-support/operational-gate-service.ts", "netflix"],
		["apps/app-backend/src/modules/test-support/routes.ts", "media"],
		["libs/contract/src/modules/test-support/contract.ts", "media"],
		["libs/contract/src/modules/test-support/schemas.ts", "media"],
	],
);

const permanent = [
	{
		term: "*",
		kind: "permanent",
		category: "legacy-bootstrap",
		path: "apps/app-backend/src/modules/legacy-bootstrap/**",
		reason: "Documented V1 adoption quarantine retains domain mappings",
	},
	...(["fitness", "media"] as const).map((term) => ({
		term,
		kind: "permanent" as const,
		category: "boot-wiring" as const,
		path: "apps/app-backend/src/modules/plugins/boot-sources.ts",
		reason: "First-party trusted package wiring is intentionally explicit at boot",
	})),
	...(
		["anime", "audiobook", "book", "manga", "media", "movie", "music", "podcast", "show"] as const
	).map((term) => ({
		term,
		kind: "permanent" as const,
		category: "backup-contract" as const,
		path: "libs/contract/src/schema/media-types.ts",
		reason: "Retained backup client requires this narrow media contract type",
	})),
] satisfies ReadonlyArray<PurityAllowlistEntry>;

export const kernelPurityAllowlist = [
	...permanent,
	...importEventMembership,
	...collectionUserStateMembership,
	...importEnvelope,
	...queryRecipes,
	...operationalGate,
] satisfies ReadonlyArray<PurityAllowlistEntry>;
