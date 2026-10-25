import { expect, it } from "@effect/vitest";
import { CreateImportRunBody } from "@ryot-app/contract/modules/imports/schemas";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { Effect, Schema } from "effect";

import { FitnessCreateImportRunBody } from "./import-sources";

const uploadToken = "upload-1";
const timezone = TimeZone.make("Asia/Kolkata");

const createFitnessImportRunBody = <const Source extends FitnessCreateImportRunBody["source"]>(
	body: Extract<FitnessCreateImportRunBody, { readonly source: Source }>,
) => ({ ...body, source: { slug: body.source, owner: definitionOwner("fitness-owner") } });
const sources = [
	["open_scale", { timezone, uploadToken, source: "open_scale" }],
	["hevy", { timezone, uploadToken, source: "hevy" }],
	["strong_app", { timezone, uploadToken, source: "strong_app" }],
] as const;

it.effect.each(sources)(
	"builds a typed %s request accepted by the open import envelope",
	([source, input]) =>
		Effect.gen(function* () {
			const body = createFitnessImportRunBody(input);

			expect(yield* Schema.decodeEffect(FitnessCreateImportRunBody)(input)).toEqual(input);
			expect(yield* Schema.decodeEffect(CreateImportRunBody)(body)).toEqual(body);
			expect(body.source).toEqual({
				slug: source,
				owner: { kind: "plugin", pluginId: "fitness-owner" },
			});
		}),
);

it.effect.each(["open_scale", "hevy", "strong_app"] as const)(
	"requires a timezone for %s",
	(source) =>
		Effect.flip(Schema.decodeUnknownEffect(FitnessCreateImportRunBody)({ source, uploadToken })),
);

it.effect("keeps fitness-specific request validation strict and contract-owned", () =>
	Effect.gen(function* () {
		yield* Effect.flip(
			Schema.decodeEffect(FitnessCreateImportRunBody)({
				timezone,
				source: "hevy",
				uploadToken: "",
			}),
		);
		yield* Effect.flip(
			Schema.decodeUnknownEffect(FitnessCreateImportRunBody)({
				source: "hevy",
				uploadToken: { token: "upload-1", expiresAt: "2026-08-23T00:00:00.000Z" },
			}),
		);
		yield* Effect.flip(
			Schema.decodeUnknownEffect(FitnessCreateImportRunBody)({
				timezone,
				uploadToken,
				source: "hevy",
				unexpected: true,
			}),
		);
	}),
);
