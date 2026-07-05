import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type { AutomationInput } from "@ryot-app/sandbox-sdk/automation";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { expect, it } from "vitest";

import {
	automationOccurrenceRows,
	hostSuccess,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./media-association.sandbox";

type InputOverrides = {
	rootEntityId?: string;
	afterRoles?: string[];
	beforeRoles?: string[];
	rootPreviouslyPopulated?: boolean;
	subjectKind?: "person" | "company";
	targetKind?: "movie" | "music-group";
	operation?: "create" | "update" | "delete";
};

const input = (overrides: InputOverrides = {}) => {
	const operation = overrides.operation ?? "create";
	const targetKind = overrides.targetKind ?? "movie";
	const subjectKind = overrides.subjectKind ?? "person";
	const snapshot = (properties: Record<string, JsonValue>) => ({
		properties,
		id: "relationship-1",
		relationshipSchemaSlug: `${subjectKind}-to-${targetKind}`,
		target: { name: "Barbie", id: "associated-1", entitySchemaSlug: targetKind },
		source: { id: "subject-1", name: "Greta Gerwig", entitySchemaSlug: subjectKind },
	});
	let relationshipSource;
	if (operation === "create") {
		relationshipSource = { after: snapshot({ roles: overrides.afterRoles ?? ["Director"] }) };
	} else if (operation === "update") {
		relationshipSource = {
			before: snapshot({ roles: overrides.beforeRoles ?? ["Actor"] }),
			after: snapshot({ roles: overrides.afterRoles ?? ["Actor", "Director"] }),
		};
	} else {
		relationshipSource = { before: snapshot({ roles: overrides.beforeRoles ?? ["Actor"] }) };
	}
	const source = { kind: "relationship" as const, ...relationshipSource };
	const population = {
		rootPreviouslyPopulated: overrides.rootPreviouslyPopulated ?? true,
		scopeEntity: {
			name: "Barbie",
			entitySchemaSlug: targetKind,
			id: overrides.rootEntityId ?? "associated-1",
		},
	};
	return {
		occurrence: automationOccurrenceRows(source, population),
		context: {
			automation: {
				operation,
				ruleId: "rule-1",
				occurrenceId: "occurrence-1",
				origin: { kind: "provider_refresh" },
				occurredAt: "2026-07-20T10:00:00.000Z",
				source: { kind: "relationship", relationshipId: "relationship-1" },
			},
		} satisfies AutomationInput,
	};
};

const run = (value: ReturnType<typeof input>) => {
	const calls: Array<Record<string, JsonValue | undefined>> = [];
	return definition
		.run(
			value.context,
			defineSandboxTestHost(manifest, {
				executeRyotql: () => hostSuccess(value.occurrence),
				emitSignal: (request) => {
					calls.push(request);
					return Effect.succeed({ wasCreated: true, signalId: "signal-1" });
				},
			}),
			{ metadata: {}, sandboxScriptId: "script-1" },
		)
		.pipe(Effect.as(calls));
};

it.each([
	["person", "movie", "person.media.associated"],
	["company", "movie", "company.media.associated"],
	["person", "music-group", "person.media-group.associated"],
	["company", "music-group", "company.media-group.associated"],
] as const)("maps a %s credit to a %s signal", (subjectKind, targetKind, schemaSlug) =>
	Effect.runPromise(
		run(input({ targetKind, subjectKind })).pipe(
			Effect.map((calls) => {
				expect(calls).toEqual([
					{
						schemaSlug,
						subjectEntityId: "subject-1",
						discriminator: "subject-1:Director",
						properties: { role: "Director", associatedName: "Barbie", subjectName: "Greta Gerwig" },
					},
				]);
				return undefined;
			}),
		),
	),
);

it("suppresses only the credited subject's own first population", () =>
	Effect.runPromise(
		Effect.all(
			[
				run(input({ rootEntityId: "subject-1", rootPreviouslyPopulated: false })),
				run(input({ rootEntityId: "associated-1", rootPreviouslyPopulated: false })),
			],
			{ concurrency: "unbounded" },
		).pipe(
			Effect.map(([subjectRoot, mediaRoot]) => {
				expect(subjectRoot).toEqual([]);
				expect(mediaRoot).toHaveLength(1);
				return undefined;
			}),
		),
	));

it("emits each newly added role once and ignores unchanged, removed, and deleted roles", () =>
	Effect.runPromise(
		Effect.all(
			[
				run(input({ operation: "update", afterRoles: ["Actor", "Director", "Director"] })),
				run(
					input({ operation: "update", afterRoles: ["Actor"], beforeRoles: ["Actor", "Director"] }),
				),
				run(input({ operation: "delete" })),
			],
			{ concurrency: "unbounded" },
		).pipe(
			Effect.map(([added, removed, deleted]) => {
				expect(added.map(({ discriminator }) => discriminator)).toEqual(["subject-1:Director"]);
				expect(removed).toEqual([]);
				expect(deleted).toEqual([]);
				return undefined;
			}),
		),
	));

it("uses stable per-role discriminators across replay", () => {
	const value = input({ afterRoles: ["Actor", "Director"] });
	return Effect.runPromise(
		Effect.all([run(value), run(value)], { concurrency: "unbounded" }).pipe(
			Effect.map(([first, replay]) => {
				expect(first).toEqual(replay);
				expect(first.map(({ discriminator }) => discriminator)).toEqual([
					"subject-1:Actor",
					"subject-1:Director",
				]);
				return undefined;
			}),
		),
	);
});
