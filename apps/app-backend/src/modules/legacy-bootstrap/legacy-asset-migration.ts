import {
	uploadContentTypeExtensions,
	uploadContentTypes,
} from "@ryot/contract/modules/uploads/upload-policy";
import { UserId } from "@ryot/contract/schema/brands";
import { CryptoHasher } from "bun";
import { eq, sql } from "drizzle-orm";
import { Effect, Stream } from "effect";

import { entity } from "#lib/infrastructure/db/schema/tables/entities";
import { event } from "#lib/infrastructure/db/schema/tables/events";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { S3Service } from "#lib/infrastructure/s3";
import { ManagedAssetsRepository } from "#modules/uploads/managed-assets/repository";

import { buildReportSql } from "./shared";

type JsonRecord = Record<string, unknown>;

type LegacyS3Row = {
	id: string;
	properties: JsonRecord;
	source: "entity" | "event";
	userId: string | null;
};

type LegacyS3AssetReference = {
	key: string;
	userId: string | null;
};

type LegacyS3AssetMigrationResult = {
	discovered: number;
	managedAssetRows: number;
	referencesMigrated: number;
	updatedRows: number;
	unresolved: number;
};

type ReportEntry = {
	count: string;
	level?: "info" | "warning";
	message: string;
};

const isJsonRecord = (value: unknown): value is JsonRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const referenceKey = (userId: string | null, key: string) => `${userId ?? ""}\u0000${key}`;

const collectS3Keys = (value: unknown, keys: Set<string>) => {
	if (Array.isArray(value)) {
		for (const child of value) {
			collectS3Keys(child, keys);
		}
		return;
	}
	if (!isJsonRecord(value)) {
		return;
	}
	if (value["type"] === "s3" && typeof value["key"] === "string") {
		keys.add(value["key"]);
	}
	for (const child of Object.values(value)) {
		collectS3Keys(child, keys);
	}
};

const rewriteS3Keys = (
	value: unknown,
	userId: string,
	replacements: ReadonlyMap<string, string>,
): [unknown, boolean] => {
	if (Array.isArray(value)) {
		let changed = false;
		const rewritten = value.map((child) => {
			const [next, childChanged] = rewriteS3Keys(child, userId, replacements);
			changed ||= childChanged;
			return next;
		});
		return [changed ? rewritten : value, changed];
	}
	if (!isJsonRecord(value)) {
		return [value, false];
	}

	let changed = false;
	const rewritten: JsonRecord = { ...value };
	if (value["type"] === "s3" && typeof value["key"] === "string") {
		const replacement = replacements.get(referenceKey(userId, value["key"]));
		if (replacement !== undefined) {
			rewritten["key"] = replacement;
			changed = true;
		}
	}
	for (const [key, child] of Object.entries(value)) {
		const [next, childChanged] = rewriteS3Keys(child, userId, replacements);
		if (childChanged) {
			rewritten[key] = next;
			changed = true;
		}
	}
	return [changed ? rewritten : value, changed];
};

const isUploadContentType = (value: string): value is keyof typeof uploadContentTypeExtensions =>
	(uploadContentTypes as readonly string[]).includes(value);

const resolvePermanentExtension = (contentType: string) => {
	const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	if (isUploadContentType(normalized)) {
		return uploadContentTypeExtensions[normalized][0];
	}
	return normalized === "application/octet-stream" ? "bin" : null;
};

const ownerNamespace = (userId: string) => new CryptoHasher("sha256").update(userId).digest("hex");

const migrateAsset = (
	s3: S3Service["Service"],
	repository: ManagedAssetsRepository["Service"],
	asset: LegacyS3AssetReference,
) =>
	Effect.gen(function* () {
		if (asset.userId === null || !s3.isConfigured) {
			return null;
		}

		const info = yield* s3.statObject(asset.key);
		const size = Number(info.size);
		const contentType = info.type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
		const extension = resolvePermanentExtension(contentType);
		if (!Number.isSafeInteger(size) || size < 0 || extension === null) {
			return null;
		}

		const hasher = new CryptoHasher("sha256");
		const source = yield* s3.openObject(asset.key);
		yield* Stream.runForEach(source, (chunk) =>
			Effect.sync(() => {
				hasher.update(chunk);
			}),
		);
		const sha256 = hasher.digest("hex");
		const key = `permanent/${ownerNamespace(asset.userId)}_${sha256}.${extension}`;

		yield* s3.writeObject(key, yield* s3.openObject(asset.key), contentType);
		yield* repository.registerPermanentOwnedObject({
			contentType,
			key,
			ownerUserId: UserId.make(asset.userId),
			provider: "s3",
			sha256,
			size,
		});
		return key;
	}).pipe(Effect.catchCause(() => Effect.succeed(null)));

export const migrateLegacyS3Assets = Effect.gen(function* () {
	const database = yield* Database;
	const s3 = yield* S3Service;
	const repository = yield* ManagedAssetsRepository;
	const rows = yield* mapDatabaseErrors(
		database.execute<LegacyS3Row>(
			sql`
				SELECT "id", "user_id" AS "userId", "properties", 'entity' AS "source"
				FROM "entity"
				WHERE jsonb_path_exists("properties", '$.** ? (@.type == "s3")')
				UNION ALL
				SELECT "id", "user_id" AS "userId", "properties", 'event' AS "source"
				FROM "event"
				WHERE jsonb_path_exists("properties", '$.** ? (@.type == "s3")')
			`,
			"objects",
		),
	);
	const references = new Map<string, LegacyS3AssetReference>();
	for (const row of rows) {
		const keys = new Set<string>();
		collectS3Keys(row.properties, keys);
		for (const key of keys) {
			references.set(referenceKey(row.userId, key), {
				key,
				userId: row.userId,
			});
		}
	}

	const replacements = new Map<string, string>();
	const managedAssetKeys = new Set<string>();
	let unresolved = 0;
	for (const asset of references.values()) {
		const replacement = yield* migrateAsset(s3, repository, asset);
		if (replacement === null) {
			unresolved += 1;
		} else {
			replacements.set(referenceKey(asset.userId, asset.key), replacement);
			managedAssetKeys.add(replacement);
		}
	}

	let updatedRows = 0;
	for (const row of rows) {
		if (row.userId === null) {
			continue;
		}
		const [properties, changed] = rewriteS3Keys(row.properties, row.userId, replacements);
		if (!changed) {
			continue;
		}
		if (row.source === "entity") {
			yield* mapDatabaseErrors(
				database
					.update(entity)
					.set({ properties: properties as JsonRecord })
					.where(eq(entity.id, row.id)),
			);
		} else {
			yield* mapDatabaseErrors(
				database
					.update(event)
					.set({ properties: properties as JsonRecord })
					.where(eq(event.id, row.id)),
			);
		}
		updatedRows += 1;
	}

	return {
		discovered: references.size,
		managedAssetRows: managedAssetKeys.size,
		referencesMigrated: replacements.size,
		unresolved,
		updatedRows,
	} satisfies LegacyS3AssetMigrationResult;
});

export const buildLegacyS3AssetReportSql = (result: LegacyS3AssetMigrationResult) => {
	const entries: ReportEntry[] = [
		{
			count: String(result.discovered),
			message: "asset locator(s) discovered",
		},
		{
			count: String(result.referencesMigrated),
			message: "asset locator(s) migrated to managed_asset",
		},
		{
			count: String(result.managedAssetRows),
			message: "managed_asset row(s) available",
		},
		{
			count: String(result.updatedRows),
			message: "entity/event row(s) updated with managed asset keys",
		},
	];
	if (result.unresolved > 0) {
		entries.push({
			count: String(result.unresolved),
			level: "warning" as const,
			message:
				"asset locator(s) could not be resolved or registered; original locators were retained",
		});
	}
	return `
		DO $$
		DECLARE started_at timestamptz := clock_timestamp();
		BEGIN
			${buildReportSql("legacy S3 assets -> managed_asset", entries)}
		END $$;
	`;
};
