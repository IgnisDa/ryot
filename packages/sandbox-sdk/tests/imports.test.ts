import { Schema } from "@ryot-app/sandbox-sdk/effect";
import {
	genericImportChunkOperationIds,
	genericImportChunkSchema,
	genericImportKernelInputSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { expect, it } from "vitest";

it("decodes generic media write intents without admitting plugin-private event fields", () => {
	const chunk = {
		failures: [
			{
				itemIndex: 0,
				unit: "plays",
				recordKind: "play",
				sourceLabel: "Lost",
				sourceIdentifier: "20",
				entitySchemaSlug: "show",
				operationId: "failed-lost",
				stage: "provider_resolution",
				message: "Could not resolve S1E99",
			},
		],
		items: [
			{
				itemIndex: 1,
				recordId: "media-1",
				sourceLabel: "Arrival",
				sourceIdentifier: "10",
				subjectEntityAlias: "media",
				collectionMemberships: [
					{ entityAlias: "media", collectionName: "Pinned", operationId: "pinned-membership" },
				],
				events: [
					{
						properties: {},
						entityAlias: "media",
						subjectEntityId: "movie-1",
						operationId: "completion-1",
						eventSchemaSlug: "complete",
						occurredAt: "2026-01-01T00:00:00.000Z",
					},
				],
				relationships: [
					{
						sourceAlias: "media",
						propertiesMode: "merge",
						targetAlias: "mediaLibrary",
						operationId: "library-membership",
						relationshipSchemaSlug: "in-media-library",
						properties: { ownershipSources: ["watcharr"] },
					},
				],
				entities: [
					{
						alias: "media",
						properties: {},
						name: "Arrival",
						entityId: "movie-1",
						operationId: "media",
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
						existingOnly: true,
						alias: "mediaLibrary",
						operationId: "media-library",
						entitySchemaSlug: "media-library",
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

it("rejects chunks whose failures repeat an operation or reuse an intent operation", () => {
	const failure = {
		itemIndex: 0,
		unit: "plays",
		recordKind: "play",
		message: "invalid",
		sourceLabel: "Lost",
		sourceIdentifier: "20",
	};
	const decode = Schema.decodeUnknownSync(genericImportChunkSchema);
	const item = {
		events: [],
		itemIndex: 0,
		relationships: [],
		recordId: "record",
		sourceLabel: "Lost",
		sourceIdentifier: "20",
		subjectEntityAlias: "media",
		entities: [
			{
				name: "Lost",
				alias: "media",
				properties: {},
				operationId: "entity",
				entitySchemaSlug: "show",
			},
		],
	};

	expect(
		genericImportChunkOperationIds({
			items: [item],
			failures: [{ ...failure, operationId: "failed" }],
		}),
	).toEqual(["entity", "failed"]);
	expect(() =>
		decode({
			items: [],
			failures: [
				{ ...failure, operationId: "same" },
				{ ...failure, operationId: "same" },
			],
		}),
	).toThrow("Ingestion chunk identities must be unique and bounded");
	expect(() =>
		decode({ items: [item], failures: [{ ...failure, operationId: "entity" }] }),
	).toThrow("Ingestion chunk identities must be unique and bounded");
});

it("requires kernel import commands to carry matching import attribution", () => {
	const input = {
		runId: "run-1",
		operation: { action: "seal" },
		command: {
			occurredAt: "2026-01-01T00:00:00.000Z",
			itemIdentity: '["integration-run","run-1"]',
			accountGeneration: { userId: "user-1", token: "test-account-generation" },
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
