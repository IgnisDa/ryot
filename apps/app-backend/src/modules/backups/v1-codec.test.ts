import { describe, expect, it } from "@effect/vitest";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect, Result, Schema } from "effect";

import { BackupArchiveError } from "#modules/backup-data/archive-error";
import {
	backupV1EntityReferenceRules,
	backupV1EventReferenceRules,
	redactV1SchemaSecrets,
	rewriteV1AssetLocatorForArchive,
	rewriteV1EntityEmbeddedReferences,
	rewriteV1EventReferences,
	rewriteV1ManagedAssetLocators,
	rewriteV1RelationshipReferences,
} from "#modules/backup-data/v1-rewrites";

import { decodeNdjson, encodeNdjson } from "./streaming";
import {
	V1Manifest,
	V1Profile,
	V1NotificationSubscription,
	V1_SECTION_PATHS,
	type V1Event,
	type V1UserEntity,
} from "./v1-codec";

const timestamp = "2026-08-23T12:00:00.000Z";

const event = (properties: V1Event["properties"] = {}): V1Event => ({
	properties,
	id: "event-1",
	entityId: "entity-1",
	createdAt: timestamp,
	updatedAt: timestamp,
	occurredAt: timestamp,
	sessionEntityId: "session-1",
	eventSchemaSlug: "collection:add-entity-to-collection",
});

const entity = (properties: V1UserEntity["properties"]): V1UserEntity => ({
	properties,
	provider: null,
	id: "template-1",
	name: "Template",
	externalId: null,
	populatedAt: null,
	createdAt: timestamp,
	updatedAt: timestamp,
	entitySchemaSlug: "workout-template",
});

describe("V1 codecs", () => {
	it("decodes exact V1 literals and profile nulls", () => {
		const portableProfile = { name: "Test", image: null, preferences: { locale: "en" } };
		const profile = Schema.decodeUnknownResult(V1Profile)(portableProfile);
		expect(Result.isSuccess(profile)).toBe(true);
		const manifest = {
			assets: [],
			version: 1,
			redactions: [],
			appVersion: "1.0.0",
			requiredPlugins: [],
			createdAt: timestamp,
			format: "ryot-backup",
			archiveId: "archive-1",
			sections: V1_SECTION_PATHS.map((path) => ({ path, count: 0, sha256: "a".repeat(64) })),
		} as const;
		expect(Result.isSuccess(Schema.decodeUnknownResult(V1Manifest)(manifest))).toBe(true);
		expect(
			Result.isFailure(
				Schema.decodeUnknownResult(V1Profile)({ ...portableProfile, email: "test@example.com" }),
			),
		).toBe(true);
		expect(
			Result.isFailure(Schema.decodeUnknownResult(V1Manifest)({ ...manifest, extra: true })),
		).toBe(true);
	});

	it("decodes NDJSON across chunks and rejects a truncated final line", () => {
		const codec = Schema.Struct({ id: Schema.String });
		const bytes = [...encodeNdjson([{ id: "one" }, { id: "two" }], codec)];
		const joined = new Uint8Array(bytes.reduce((size, chunk) => size + chunk.byteLength, 0));
		let offset = 0;
		for (const chunk of bytes) {
			joined.set(chunk, offset);
			offset += chunk.byteLength;
		}
		expect([...decodeNdjson([joined.slice(0, 5), joined.slice(5)], codec)]).toEqual([
			{ id: "one" },
			{ id: "two" },
		]);
		expect(() => [...decodeNdjson([joined.slice(0, -1)], codec)]).toThrow(BackupArchiveError);
	});

	it("keeps notification overrides keyed only by signal schema slug", () => {
		const override = { metadata: null, isActive: false, signalSchemaSlug: "review.created" };
		expect(Schema.decodeUnknownSync(V1NotificationSubscription)(override)).toEqual(override);
		expect(
			Result.isFailure(
				Schema.decodeUnknownResult(V1NotificationSubscription)({
					...override,
					id: "archived-id",
					createdAt: timestamp,
					updatedAt: timestamp,
				}),
			),
		).toBe(true);
	});
});

describe("V1 reference rewrites", () => {
	it.effect("rewrites relationship, event, collection, and workout-template references", () =>
		Effect.gen(function* () {
			const entityIds = new Map([
				["entity-1", "new-entity-1"],
				["session-1", "new-session-1"],
				["exercise-1", "new-exercise-1"],
			]);
			const relationship = yield* rewriteV1RelationshipReferences(
				{
					scope: "user",
					properties: {},
					createdAt: timestamp,
					id: "relationship-1",
					sourceEntityId: "entity-1",
					targetEntityId: "session-1",
					relationshipSchemaSlug: "membership",
				},
				entityIds,
			);
			expect(relationship).toMatchObject({
				sourceEntityId: "new-entity-1",
				targetEntityId: "new-session-1",
			});
			const rewrittenEvent = yield* rewriteV1EventReferences(
				event({ entityId: "entity-1", relationshipId: "relationship-1" }),
				entityIds,
				new Map([["relationship-1", "new-relationship-1"]]),
				backupV1EventReferenceRules,
			);
			expect(rewrittenEvent).toMatchObject({
				entityId: "new-entity-1",
				sessionEntityId: "new-session-1",
				properties: { entityId: "new-entity-1", relationshipId: "new-relationship-1" },
			});
			const template = yield* rewriteV1EntityEmbeddedReferences(
				entity({ exercises: [{ exerciseId: "exercise-1", notes: [] }] }),
				entityIds,
				backupV1EntityReferenceRules,
			);
			expect(template.properties).toMatchObject({
				exercises: [{ exerciseId: "new-exercise-1" }],
			});
		}),
	);

	it.effect("rewrites only schema-declared managed assets and leaves remote assets unchanged", () =>
		Effect.gen(function* () {
			const imageSha = "a".repeat(64);
			const schema: AppSchema = {
				fields: {
					text: { type: "string", label: "Text", description: "Ordinary text" },
					image: {
						type: "object",
						label: "Image",
						properties: {},
						description: "Image",
						validation: { asset: true },
					},
					remote: {
						type: "object",
						properties: {},
						label: "Remote",
						validation: { asset: true },
						description: "Remote image",
					},
				},
			};
			const rewritten = yield* rewriteV1ManagedAssetLocators(
				{
					text: "local:key is ordinary text",
					image: { type: "local", key: "image-key" },
					remote: { type: "remote", url: "https://example.com/image.jpg" },
				},
				schema,
				new Map([
					[
						"local:image-key",
						rewriteV1AssetLocatorForArchive({ type: "local", key: "image-key" }, imageSha),
					],
				]),
			);
			expect(rewritten).toEqual({
				text: "local:key is ordinary text",
				image: { type: "local", key: imageSha },
				remote: { type: "remote", url: "https://example.com/image.jpg" },
			});
			expect(rewriteV1AssetLocatorForArchive({ type: "s3", key: "image-key" }, imageSha)).toEqual({
				type: "s3",
				key: imageSha,
			});
			const restored = yield* rewriteV1ManagedAssetLocators(
				{ image: { type: "local", key: imageSha } },
				schema,
				new Map([[`local:${imageSha}`, { type: "s3", key: "restored-key" }]]),
			);
			expect(restored["image"]).toEqual({ type: "s3", key: "restored-key" });
			expect(
				rewriteV1AssetLocatorForArchive(
					{ type: "remote", url: "https://example.com/image.jpg" },
					imageSha,
				),
			).toEqual({ type: "remote", url: "https://example.com/image.jpg" });
		}),
	);
});

describe("V1 secret redaction", () => {
	it("removes only recursively declared secrets and reports JSON pointer paths", () => {
		const schema: AppSchema = {
			fields: {
				note: { type: "string", label: "Note", description: "Ordinary note" },
				token: { secret: true, type: "string", label: "Token", description: "API token" },
				accounts: {
					type: "array",
					label: "Accounts",
					description: "Accounts",
					items: {
						type: "object",
						label: "Account",
						description: "Account",
						properties: {
							name: { type: "string", label: "Name", description: "Name" },
							password: {
								secret: true,
								type: "string",
								label: "Password",
								description: "Password",
							},
						},
					},
				},
			},
		};
		const result = redactV1SchemaSecrets(
			{
				token: "top-secret",
				note: "the word password is ordinary text",
				accounts: [{ name: "Alice", password: "nested-secret" }],
			},
			schema,
			"/plugin-state/media/config",
		);
		const serialized = JSON.stringify(result.redacted);
		expect(serialized).not.toContain("top-secret");
		expect(serialized).not.toContain("nested-secret");
		expect(serialized).toContain("the word password is ordinary text");
		expect(result.redactions).toEqual([
			"/plugin-state/media/config/token",
			"/plugin-state/media/config/accounts/0/password",
		]);
	});
});
