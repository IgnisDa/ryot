import { Schema } from "@ryot-app/sandbox-sdk/effect";
import {
	genericImportChunkSchema,
	genericImportKernelInputSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { expect, it } from "vitest";

it("decodes generic media write intents without admitting plugin-private event fields", () => {
	const chunk = {
		failures: [
			{
				itemIndex: 0,
				sourceLabel: "Lost",
				sourceIdentifier: "20",
				entitySchemaSlug: "show",
				stage: "provider_resolution",
				message: "Could not resolve S1E99",
			},
		],
		items: [
			{
				itemIndex: 1,
				sourceLabel: "Arrival",
				sourceIdentifier: "10",
				subjectEntityAlias: "media",
				collectionMemberships: [{ entityAlias: "media", collectionName: "Pinned" }],
				events: [
					{
						properties: {},
						entityAlias: "media",
						subjectEntityId: "movie-1",
						eventSchemaSlug: "complete",
						occurredAt: "2026-01-01T00:00:00.000Z",
					},
				],
				relationships: [
					{
						sourceAlias: "media",
						targetAlias: "library",
						propertiesMode: "merge",
						relationshipSchemaSlug: "in-library",
						properties: { ownershipSources: ["watcharr"] },
					},
				],
				entities: [
					{
						alias: "media",
						properties: {},
						name: "Arrival",
						entityId: "movie-1",
						entitySchemaSlug: "movie",
						providerResolution: {
							value: "tt2543164",
							providerSlug: "tmdb",
							identifierType: "imdb",
						},
					},
					{
						scope: "user",
						properties: {},
						name: "Library",
						alias: "library",
						existingOnly: true,
						entitySchemaSlug: "library",
					},
				],
			},
		],
	};

	expect(Schema.decodeUnknownSync(genericImportChunkSchema)(chunk)).toEqual(chunk);
	expect(() =>
		Schema.decodeUnknownSync(genericImportChunkSchema)({
			...chunk,
			items: [
				{
					...chunk.items[0],
					events: [{ ...chunk.items[0]?.events[0], pluginPrivateField: { any: "shape" } }],
				},
			],
		}),
	).toThrow();
	expect(() =>
		Schema.decodeUnknownSync(genericImportChunkSchema)({
			...chunk,
			items: [
				{ ...chunk.items[0], events: [{ ...chunk.items[0]?.events[0], subjectEntityId: "" }] },
			],
		}),
	).toThrow();
});

it("requires kernel import commands to carry matching import attribution", () => {
	const input = {
		totalItems: 0,
		runId: "run-1",
		failureCount: 0,
		chunkHandles: [],
		writeItemCount: 0,
		command: {
			occurredAt: "2026-01-01T00:00:00.000Z",
			itemIdentity: '["integration-run","run-1"]',
			causation: {
				depth: 0,
				parentRunId: null,
				executionId: "run-1",
				importRunId: "run-1",
				source: "integration",
				parentTriggerId: null,
				rootExecutionId: "run-1",
				integrationId: "integration-1",
				initiator: { id: "integration-1", kind: "integration" },
			},
		},
	};

	expect(Schema.decodeUnknownSync(genericImportKernelInputSchema)(input)).toEqual(input);
	expect(() =>
		Schema.decodeUnknownSync(genericImportKernelInputSchema)({
			...input,
			command: {
				...input.command,
				causation: { ...input.command.causation, importRunId: "another-run" },
			},
		}),
	).toThrow("Generic import command attribution does not match the import run");
});
