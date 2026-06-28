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
	...queryRecipes,
	...operationalGate,
] satisfies ReadonlyArray<PurityAllowlistEntry>;
