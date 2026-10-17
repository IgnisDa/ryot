import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import type { EntityEditorSubmission } from "@ryot-app/plugin-kit/schema";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import { expect, it } from "vitest";

import definition, { manifest } from "./media-entity-save.sandbox";

const submission = (overrides: Partial<EntityEditorSubmission> = {}): EntityEditorSubmission => ({
	properties: {},
	name: "Jane Doe",
	target: { kind: "create" },
	entitySchemaSlug: "person",
	relationships: [
		{
			relationshipSchemaSlug: "person-to-movie",
			targets: [{ entityId: EntityId.make("movie-1"), properties: { roles: ["Director"] } }],
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
				return { kind: "saved", entityId: EntityId.make("person-1") } as const;
			}),
	});
	return { host, saved };
};

it("forwards a media submission to the atomic entity save", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { host, saved } = recordingHost();
			const input = submission();
			expect(yield* definition.run(input, host)).toEqual({
				kind: "saved",
				entityId: EntityId.make("person-1"),
			});
			expect(saved).toEqual([input]);
		}),
	));

it("rejects schemas and relationships outside the media editors without saving", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { host, saved } = recordingHost();
			for (const input of [
				submission({ relationships: [], entitySchemaSlug: "show-season" }),
				submission({ relationships: [], entitySchemaSlug: "constructor" }),
				submission({
					entitySchemaSlug: "show",
					relationships: [{ targets: [], relationshipSchemaSlug: "show-to-show-season" }],
				}),
			]) {
				expect(yield* definition.run(input, host)).toMatchObject({ kind: "invalid" });
			}
			expect(saved).toEqual([]);
		}),
	));
