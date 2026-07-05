import type { AutomationInput } from "@ryot/sandbox-sdk/automation";
import type { JsonValue } from "@ryot/sandbox-sdk/core";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { expect, it } from "vitest";

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

const input = (overrides: InputOverrides = {}): AutomationInput => {
	const operation = overrides.operation ?? "create";
	const targetKind = overrides.targetKind ?? "movie";
	const subjectKind = overrides.subjectKind ?? "person";
	const snapshot = (properties: Record<string, JsonValue>) => ({
		properties,
		id: "relationship-1",
		relationshipSchemaId: "relationship-schema-1",
		relationshipSchemaSlug: `${subjectKind}-to-${targetKind}`,
		target: { id: "associated-1", name: "Barbie", entitySchemaSlug: targetKind },
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
	return {
		automation: {
			operation,
			ruleId: "rule-1",
			occurrenceId: "occurrence-1",
			origin: { kind: "provider_refresh" },
			occurredAt: "2026-07-20T10:00:00.000Z",
			source: { kind: "relationship", ...relationshipSource },
			population: {
				rootPreviouslyPopulated: overrides.rootPreviouslyPopulated ?? true,
				scopeEntity: {
					name: "Barbie",
					entitySchemaSlug: targetKind,
					entitySchemaId: "scope-schema",
					id: overrides.rootEntityId ?? "associated-1",
				},
			},
		},
	};
};

const run = (value: AutomationInput) => {
	const calls: Array<Record<string, JsonValue | undefined>> = [];
	return runSandboxTestDriver(
		definition.drivers.automation,
		value,
		defineSandboxTestHost(manifest, {
			emitSignal: (request) => {
				calls.push(request);
				return Promise.resolve({ success: true, data: { wasCreated: true, signalId: "signal-1" } });
			},
		}),
		{ metadata: {}, sandboxScriptId: "script-1" },
	).then(() => calls);
};

it.each([
	["person", "movie", "person.media.associated"],
	["company", "movie", "company.media.associated"],
	["person", "music-group", "person.media-group.associated"],
	["company", "music-group", "company.media-group.associated"],
] as const)("maps a %s credit to a %s signal", (subjectKind, targetKind, schemaSlug) =>
	run(input({ subjectKind, targetKind })).then((calls) => {
		expect(calls).toEqual([
			{
				schemaSlug,
				subjectEntityId: "subject-1",
				discriminator: "subject-1:Director",
				properties: { role: "Director", subjectName: "Greta Gerwig", associatedName: "Barbie" },
			},
		]);
		return undefined;
	}),
);

it("suppresses only the credited subject's own first population", () =>
	Promise.all([
		run(input({ rootEntityId: "subject-1", rootPreviouslyPopulated: false })),
		run(input({ rootEntityId: "associated-1", rootPreviouslyPopulated: false })),
	]).then(([subjectRoot, mediaRoot]) => {
		expect(subjectRoot).toEqual([]);
		expect(mediaRoot).toHaveLength(1);
		return undefined;
	}));

it("emits each newly added role once and ignores unchanged, removed, and deleted roles", () =>
	Promise.all([
		run(input({ operation: "update", afterRoles: ["Actor", "Director", "Director"] })),
		run(input({ operation: "update", beforeRoles: ["Actor", "Director"], afterRoles: ["Actor"] })),
		run(input({ operation: "delete" })),
	]).then(([added, removed, deleted]) => {
		expect(added.map(({ discriminator }) => discriminator)).toEqual(["subject-1:Director"]);
		expect(removed).toEqual([]);
		expect(deleted).toEqual([]);
		return undefined;
	}));

it("uses stable per-role discriminators across replay", () => {
	const value = input({ afterRoles: ["Actor", "Director"] });
	return Promise.all([run(value), run(value)]).then(([first, replay]) => {
		expect(first).toEqual(replay);
		expect(first.map(({ discriminator }) => discriminator)).toEqual([
			"subject-1:Actor",
			"subject-1:Director",
		]);
		return undefined;
	});
});
