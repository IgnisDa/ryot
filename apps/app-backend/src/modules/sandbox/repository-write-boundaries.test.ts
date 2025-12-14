import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
	analyzeRepositoryWrites,
	type RepositoryWriteFinding,
} from "#lib/test-support/repository-write-analysis";

const packageRoot = Bun.fileURLToPath(new URL("../../../", import.meta.url));

// Cross-module repository write call sites (a repository write method invoked on a `yield* XRepository`
// DI receiver from a file outside that repository's owning module directory). The automation
// refactor forbids feature modules from writing another module's tables through its repository,
// EXCEPT the sanctioned atomicity carve-out documented in apps/app-backend/AGENTS.md ("Reach into
// another module's repository only when atomicity within one shared transaction requires it, and
// only to write tables that module owns"). Each entry below is one of those sanctioned writers and
// must stay a plain transactional row write that starts no durable work:
//
// - entity-schemas -> TrackersRepository.linkEntitySchema: EntitySchemasService.create writes the
//   new entity schema and its tracker link in one transaction so both rows commit atomically.
// - user-state -> Events/Relationships bulk delete/move: the documented occurrence-free bulk
//   mutations (see modules/automations/AGENTS.md "Write-path ownership"); clearUserState and
//   mergeUserState delete/move events and relationships for an entity inside one transaction,
//   writing only tables those modules own.
//
// A NEW cross-module repository write fails this test: add an owner (route it through the owning
// module's service/workflow) or, if it is genuinely a sanctioned atomic write, justify it here.
const ALLOWLIST: ReadonlyArray<readonly [string, string, string]> = [
	["modules/entity-schemas/service.ts", "TrackersRepository", "linkEntitySchema"],
	["modules/user-state/service.ts", "EventsRepository", "deleteUserEventsForEntity"],
	["modules/user-state/service.ts", "EventsRepository", "moveUserEventsBetweenEntities"],
	["modules/user-state/service.ts", "RelationshipsRepository", "deleteUserRelationshipsForEntity"],
	[
		"modules/user-state/service.ts",
		"RelationshipsRepository",
		"moveUserRelationshipsBetweenEntities",
	],
];

const keyOf = (file: string, repository: string, method: string) =>
	`${file}::${repository}::${method}`;
const findingKey = (finding: RepositoryWriteFinding) =>
	keyOf(finding.file, finding.repository, finding.method);
const byString = (a: string, b: string) => a.localeCompare(b);

it.effect("analyzer detects a cross-module repository write it must never miss", () =>
	Effect.gen(function* () {
		const findings = yield* analyzeRepositoryWrites(packageRoot);
		expect(
			findings.some(
				(finding) =>
					finding.file === "modules/user-state/service.ts" &&
					finding.repository === "EventsRepository" &&
					finding.method === "deleteUserEventsForEntity",
			),
			"expected the user-state bulk EventsRepository write to be detected",
		).toBe(true);
	}),
);

it.effect("pins the sanctioned set of cross-module repository writes", () =>
	Effect.gen(function* () {
		const findings = yield* analyzeRepositoryWrites(packageRoot);
		const actual = new Set(findings.map(findingKey));
		const expected = new Set(
			ALLOWLIST.map(([file, repository, method]) => keyOf(file, repository, method)),
		);

		const unexpected = [...actual].filter((key) => !expected.has(key)).sort(byString);
		const removed = [...expected].filter((key) => !actual.has(key)).sort(byString);

		expect(
			unexpected,
			`New cross-module repository write introduced (route it through the owning module's service/workflow, or justify it in ALLOWLIST):\n${unexpected.join("\n")}`,
		).toEqual([]);
		expect(
			removed,
			`Sanctioned cross-module write no longer present (remove it from ALLOWLIST):\n${removed.join("\n")}`,
		).toEqual([]);
	}),
);
