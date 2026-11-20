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
const hostFor = (copies: readonly MediaCopyRow[], writes: unknown[]) =>
	defineSandboxTestHost(manifest, {
		changeUserRelationships: (batches) =>
			Effect.sync(() => {
				writes.push(...batches);
				return [{ created: 1, updated: 0, deleted: 0 }];
			}),
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

it.live("adds independently addressable copies of one title", () =>
	Effect.gen(function* () {
		const writes: unknown[] = [];
		const host = hostFor([], writes);
		expect(
			yield* runSandboxTestScript(
				definition,
				{
					action: "add",
					copyId: "disc",
					entityId: "title",
					details: { resolution: "2160", format: "uhd-blu-ray" },
				},
				host,
				execution,
			),
		).toEqual({ copyId: "manual:disc" });
		expect(
			yield* runSandboxTestScript(
				definition,
				{
					action: "add",
					copyId: "file",
					entityId: "title",
					details: { format: "digital", resolution: "1080" },
				},
				host,
				execution,
			),
		).toEqual({ copyId: "manual:file" });
		expect(writes).toMatchObject([
			{
				creates: [
					{ relationshipSchemaSlug: "in-media-library" },
					{
						key: "manual:disc",
						targetEntityId: "title",
						properties: { resolution: "2160", format: "uhd-blu-ray" },
					},
				],
			},
			{
				creates: [
					{ relationshipSchemaSlug: "in-media-library" },
					{
						key: "manual:file",
						targetEntityId: "title",
						properties: { format: "digital", resolution: "1080" },
					},
				],
			},
		]);
	}),
);

it.live("removes only the selected copy", () =>
	Effect.gen(function* () {
		const writes: unknown[] = [];
		const host = hostFor(
			[
				{
					name: "Title",
					id: "manual:file",
					entityId: "title",
					entitySchemaSlug: "movie",
					properties: { origin: "manual" },
				},
			],
			writes,
		);
		yield* runSandboxTestScript(
			definition,
			{ action: "remove", copyId: "manual:file" },
			host,
			execution,
		);
		expect(writes).toEqual([
			{
				creates: [],
				deletes: [
					{
						key: "manual:file",
						targetEntityId: "title",
						sourceEntityId: "library",
						relationshipSchemaSlug: "media-copy",
					},
				],
			},
		]);
	}),
);
