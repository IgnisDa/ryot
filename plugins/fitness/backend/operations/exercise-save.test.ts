import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import type { EntityEditorSubmission } from "@ryot-app/plugin-kit/schema";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import { expect, it } from "vitest";

import definition, { manifest } from "./exercise-save.sandbox";

const submission = (overrides: Partial<EntityEditorSubmission> = {}): EntityEditorSubmission => ({
	name: "Curl",
	target: { kind: "create" },
	entitySchemaSlug: "exercise",
	properties: { kind: "reps_weight" },
	relationships: [
		{
			relationshipSchemaSlug: "exercise-targets",
			targets: [{ properties: { role: "primary" }, entityId: EntityId.make("target-1") }],
		},
	],
	...overrides,
});

const recordingHost = () => {
	const saved: EntityEditorSubmission[] = [];
	const host = defineSandboxTestHost(manifest, {
		saveUserEntity: (item) =>
			Effect.sync(() => {
				saved.push(item);
				return { kind: "saved", entityId: EntityId.make("exercise-1") } as const;
			}),
	});
	return { host, saved };
};

it("forwards an exercise submission to the atomic entity save", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { host, saved } = recordingHost();
			const input = submission();
			expect(yield* definition.run(input, host)).toEqual({
				kind: "saved",
				entityId: EntityId.make("exercise-1"),
			});
			expect(saved).toEqual([input]);
		}),
	));

it("rejects another entity schema or relationship schema without saving", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { host, saved } = recordingHost();
			for (const input of [
				submission({ entitySchemaSlug: "workout" }),
				submission({
					relationships: [{ targets: [], relationshipSchemaSlug: "in-fitness-library" }],
				}),
			]) {
				expect(yield* definition.run(input, host)).toMatchObject({ kind: "invalid" });
			}
			expect(saved).toEqual([]);
		}),
	));
