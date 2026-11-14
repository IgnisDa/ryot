import { expect } from "bun:test";

import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	genericImportChunkOperationIds,
	genericImportChunkSchema,
	genericImportKernelInputSchema,
} from "@ryot-app/plugin-backend-sdk/imports";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

it.effect(
	"decodes generic media write intents without admitting plugin-private event fields",
	() =>
		Effect.gen(function* () {
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
						subjectEntityAlias: "item",
						collectionMemberships: [
							{ entityAlias: "item", collectionName: "Pinned", operationId: "pinned-membership" },
						],
						events: [
							{
								properties: {},
								entityAlias: "item",
								subjectEntityId: "record-1",
								operationId: "completion-1",
								eventSchemaSlug: "complete",
								occurredAt: "2026-01-01T00:00:00.000Z",
							},
						],
						relationships: [
							{
								sourceAlias: "item",
								propertiesMode: "merge",
								targetAlias: "mediaLibrary",
								operationId: "library-membership",
								relationshipSchemaSlug: "in-media-library",
								properties: { ownershipSources: ["watcharr"] },
							},
						],
						entities: [
							{
								alias: "item",
								properties: {},
								name: "Arrival",
								operationId: "item",
								entityId: "record-1",
								entitySchemaSlug: "record",
								providerResolution: {
									value: "external-1",
									providerSlug: "provider",
									identifierType: "external-id",
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

			expect(yield* Schema.decodeUnknownEffect(genericImportChunkSchema)(chunk)).toEqual<unknown>(
				chunk,
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(genericImportChunkSchema)({
					...chunk,
					items: [
						{
							...chunk.items[0],
							events: [{ ...chunk.items[0]?.events[0], pluginPrivateField: { any: "shape" } }],
						},
					],
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(genericImportChunkSchema)({
					...chunk,
					items: [
						{ ...chunk.items[0], events: [{ ...chunk.items[0]?.events[0], subjectEntityId: "" }] },
					],
				}),
			);
		}),
	testTimeout,
);

it.effect(
	"rejects chunks whose failures repeat an operation or reuse an intent operation",
	() =>
		Effect.gen(function* () {
			const failure = {
				itemIndex: 0,
				unit: "plays",
				recordKind: "play",
				message: "invalid",
				sourceLabel: "Lost",
				sourceIdentifier: "20",
			};
			const decode = Schema.decodeUnknownEffect(genericImportChunkSchema);
			const item = {
				events: [],
				itemIndex: 0,
				relationships: [],
				recordId: "record",
				sourceLabel: "Lost",
				sourceIdentifier: "20",
				subjectEntityAlias: "item",
				entities: [
					{
						name: "Lost",
						alias: "item",
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
			expect(
				(yield* Effect.flip(
					decode({
						items: [],
						failures: [
							{ ...failure, operationId: "same" },
							{ ...failure, operationId: "same" },
						],
					}),
				)).message,
			).toContain("Ingestion chunk identities must be unique and bounded");
			expect(
				(yield* Effect.flip(
					decode({ items: [item], failures: [{ ...failure, operationId: "entity" }] }),
				)).message,
			).toContain("Ingestion chunk identities must be unique and bounded");
		}),
	testTimeout,
);

it.effect(
	"requires kernel import commands to carry matching import attribution",
	() =>
		Effect.gen(function* () {
			const input = {
				runId: "run-1",
				operation: { action: "seal" },
				command: {
					accountUserId: "user-1",
					occurredAt: "2026-01-01T00:00:00.000Z",
					itemIdentity: '["integration-run","run-1"]',
					causation: {
						depth: 0,
						parentRunId: null,
						lane: "background",
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

			expect(
				yield* Schema.decodeUnknownEffect(genericImportKernelInputSchema)(input),
			).toEqual<unknown>(input);
			expect(
				(yield* Effect.flip(
					Schema.decodeUnknownEffect(genericImportKernelInputSchema)({
						...input,
						command: {
							...input.command,
							causation: { ...input.command.causation, importRunId: "another-run" },
						},
					}),
				)).message,
			).toContain("Generic import command attribution does not match the import run");
		}),
	testTimeout,
);
