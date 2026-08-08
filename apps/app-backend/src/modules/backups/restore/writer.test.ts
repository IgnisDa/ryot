import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
	assertV1DependencySchemaOwnership,
	resolveV1BootstrapSourceMapping,
	selectV1TranslationsForRestore,
} from "./writer";

const bootstrapSource = (id: string) => ({
	id,
	provider: null,
	properties: {},
	name: "Library",
	externalId: null,
	entitySchemaSlug: "library",
});

it.effect("maps the exact V1 bootstrap source without collapsing arbitrary rows", () =>
	Effect.gen(function* () {
		expect(
			yield* resolveV1BootstrapSourceMapping(
				[
					bootstrapSource("archived-library"),
					{
						provider: null,
						properties: {},
						externalId: null,
						name: "Arbitrary",
						id: "arbitrary-empty-row",
						entitySchemaSlug: "library",
					},
				],
				[bootstrapSource("target-library")],
			),
		).toEqual({ archivedId: "archived-library", targetId: "target-library" });
	}),
);

it.effect("rejects ambiguous archived V1 bootstrap sources", () =>
	resolveV1BootstrapSourceMapping(
		[bootstrapSource("first"), bootstrapSource("second")],
		[bootstrapSource("target")],
	).pipe(
		Effect.flip,
		Effect.tap((error) => Effect.sync(() => expect(error.message).toContain("exactly one"))),
	),
);

it.effect("rejects a crafted provider dependency whose schema belongs to another plugin", () =>
	assertV1DependencySchemaOwnership(
		{
			properties: {},
			id: "global-id",
			name: "Crafted",
			translations: [],
			populatedAt: null,
			externalId: "external-id",
			entitySchemaSlug: "foreign-schema",
			createdAt: "2026-08-23T12:00:00.000Z",
			updatedAt: "2026-08-23T12:00:00.000Z",
			provider: { pluginSlug: "provider-owner", providerSlug: "provider" },
			identity: { kind: "provider", pluginSlug: "provider-owner", providerSlug: "provider" },
		},
		"foreign-owner",
	).pipe(
		Effect.flip,
		Effect.tap((error) => Effect.sync(() => expect(error.message).toContain("not owned"))),
	),
);

it("does not apply archived translations to an existing global entity", () => {
	const translations = [
		{
			language: "en",
			properties: null,
			populatedAt: null,
			id: "translation-id",
			name: "Archived overwrite",
			createdAt: "2026-08-23T12:00:00.000Z",
			updatedAt: "2026-08-23T12:00:00.000Z",
		},
	];
	expect(selectV1TranslationsForRestore(false, translations)).toEqual([]);
	expect(selectV1TranslationsForRestore(true, translations)).toBe(translations);
});
