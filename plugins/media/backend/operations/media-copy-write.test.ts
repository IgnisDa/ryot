import { expect } from "bun:test";

import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { bindTestRequest } from "@ryot-app/ryotql-recipes/test-utils";
import { it } from "@voila.dev/effect-bun-test";

import type { MediaCopyRow } from "../../shared/media-copy-recipes";
import { execution } from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./media-copy-write.sandbox";

const pageInfo = { limit: 50, hasMore: false, nextCursor: null };
const hostFor = (copies: readonly MediaCopyRow[]) =>
	defineSandboxTestHost(manifest, {
		executeRyotql: (request) =>
			Effect.gen(function* () {
				const { queries } = yield* Schema.decodeEffect(RyotQLDocument)(
					bindTestRequest(request),
				).pipe(Effect.orDie);
				if ("mediaLibrary" in queries) {
					return {
						data: { mediaLibrary: { pageInfo, type: "rows", items: [{ entityId: "library" }] } },
					};
				}
				if ("copies" in queries) {
					return { data: { copies: { pageInfo, type: "rows", items: copies } } };
				}
				return { data: { targets: { pageInfo, type: "rows", items: [{ entityId: "title" }] } } };
			}),
	});

const library = { kind: "existing", entityId: "library" };
const title = { kind: "existing", entityId: "title" };

it.live("adds independently addressable copies of one title", () =>
	Effect.gen(function* () {
		const host = hostFor([]);
		for (const [copyId, details] of [
			["disc", { resolution: "2160", format: "uhd-blu-ray" }],
			["file", { format: "digital", resolution: "1080" }],
		] as const) {
			expect(
				yield* runSandboxTestScript(
					definition,
					{ copyId, details, action: "add", entityId: "title" },
					host,
					execution,
				),
			).toEqual<unknown>({
				output: { copyId: `manual:${copyId}` },
				changes: {
					relationships: {
						upserts: [
							{
								source: title,
								properties: {},
								target: library,
								propertiesMode: "merge",
								relationshipSchemaSlug: "in-media-library",
							},
							{
								target: title,
								source: library,
								key: `manual:${copyId}`,
								propertiesMode: "replace",
								relationshipSchemaSlug: "media-copy",
								properties: { ...details, origin: "manual" },
							},
						],
					},
				},
			});
		}
	}),
);

it.live("removes only the selected copy", () =>
	Effect.gen(function* () {
		const host = hostFor([
			{
				name: "Title",
				id: "manual:file",
				entityId: "title",
				entitySchemaSlug: "movie",
				properties: { origin: "manual" },
			},
		]);
		expect(
			yield* runSandboxTestScript(
				definition,
				{ action: "remove", copyId: "manual:file" },
				host,
				execution,
			),
		).toEqual<unknown>({
			output: { copyId: "manual:file" },
			changes: {
				relationships: {
					deletes: [
						{
							target: title,
							source: library,
							key: "manual:file",
							relationshipSchemaSlug: "media-copy",
						},
					],
				},
			},
		});
	}),
);
