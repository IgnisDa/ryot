import { configFromAppSchema } from "@ryot-app/config";
import { DbError } from "@ryot-app/contract/errors";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppPropertyDefinition, AppSchema } from "@ryot-app/contract/schema/property-schema";
import { generateId } from "better-auth";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { Context, Effect, Layer, Option, Schema } from "effect";

import * as tables from "#lib/infrastructure/db/schema/tables/core";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import {
	parseAppSchemaProperties,
	parseAppSchemaPropertiesSafe,
} from "#lib/property-schema/property-schema-runtime";

import { PluginConfigEncryptionKey } from "./config-encryption-key";
import { concretePluginConfigSecretPaths, redactPluginConfig } from "./config-redaction";

type ConfigRow = typeof tables.pluginConfigRevision.$inferSelect;
type CreateConfigRevisionInput = {
	pluginRevisionId: string;
	pluginInstallationId: string | null;
	ownerUserId: string | null;
	scope: ConfigRow["scope"];
	properties: Readonly<Record<string, unknown>>;
};
const Properties = Schema.Record(Schema.String, JsonValue);
const attribution = (
	row: Pick<
		ConfigRow,
		"id" | "pluginRevisionId" | "ownerUserId" | "scope" | "encryptionKeyId" | "payloadFingerprint"
	>,
) => ({
	id: row.id,
	scope: row.scope,
	ownerUserId: row.ownerUserId,
	encryptionKeyId: row.encryptionKeyId,
	pluginRevisionId: row.pluginRevisionId,
	payloadFingerprint: row.payloadFingerprint,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const encodePointerSegment = (value: string) => value.replaceAll("~", "~0").replaceAll("/", "~1");

const decodePointer = (pointer: string) => {
	if (!pointer.startsWith("/")) {
		return null;
	}
	const encoded = pointer.slice(1).split("/");
	if (encoded.some((segment) => /~(?:[^01]|$)/.test(segment))) {
		return null;
	}
	return encoded.map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
};

const definitionAtPointer = (schema: AppSchema, path: ReadonlyArray<string>) => {
	let definition: AppPropertyDefinition | undefined = schema.fields[path[0] ?? ""];
	for (const segment of path.slice(1)) {
		if (definition?.type === "object") {
			definition = definition.properties[segment];
		} else if (
			definition?.type === "array" &&
			/^(0|[1-9]\d*)$/.test(segment) &&
			Number.isSafeInteger(Number(segment))
		) {
			definition = definition.items;
		} else {
			return undefined;
		}
	}
	return definition;
};

const comparePointerPaths = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) => {
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		const leftSegment = left[index];
		const rightSegment = right[index];
		if (leftSegment === undefined || rightSegment === undefined) {
			return left.length - right.length;
		}
		if (leftSegment === rightSegment) {
			continue;
		}
		if (/^(0|[1-9]\d*)$/.test(leftSegment) && /^(0|[1-9]\d*)$/.test(rightSegment)) {
			const difference = Number(leftSegment) - Number(rightSegment);
			if (difference !== 0) {
				return difference;
			}
		}
		return leftSegment.localeCompare(rightSegment);
	}
	return 0;
};

const addMissingValue = (properties: Record<string, unknown>, path: ReadonlyArray<string>) => {
	let container: unknown = properties;
	for (const [index, segment] of path.entries()) {
		const final = index === path.length - 1;
		if (Array.isArray(container)) {
			if (!/^(0|[1-9]\d*)$/.test(segment)) {
				return false;
			}
			const itemIndex = Number(segment);
			if (!Number.isSafeInteger(itemIndex) || itemIndex > container.length) {
				return false;
			}
			if (final) {
				if (Object.hasOwn(container, itemIndex)) {
					return false;
				}
				container[itemIndex] = null;
				return true;
			}
			if (!Object.hasOwn(container, itemIndex)) {
				return false;
			}
			container = container[itemIndex];
			continue;
		}
		if (!isRecord(container)) {
			return false;
		}
		if (final) {
			if (Object.hasOwn(container, segment)) {
				return false;
			}
			container[segment] = null;
			return true;
		}
		if (!Object.hasOwn(container, segment)) {
			return false;
		}
		container = container[segment];
	}
	return false;
};

const addMissingSecretArrayItems = (
	definition: AppPropertyDefinition,
	value: unknown,
	path: ReadonlyArray<string>,
	configured: Set<string>,
	allowedMissingRequiredPaths: Array<ReadonlyArray<string>>,
) => {
	if (definition.type === "object" && isRecord(value)) {
		for (const [key, childDefinition] of Object.entries(definition.properties)) {
			addMissingSecretArrayItems(
				childDefinition,
				value[key],
				[...path, key],
				configured,
				allowedMissingRequiredPaths,
			);
		}
	} else if (definition.type === "array" && Array.isArray(value)) {
		if (definition.items.secret === true) {
			const minimum = definition.validation?.minItems ?? 0;
			for (let index = value.length; index < minimum; index += 1) {
				const itemPath = [...path, String(index)];
				value.push(null);
				configured.add(`/${itemPath.map(encodePointerSegment).join("/")}`);
				allowedMissingRequiredPaths.push(itemPath);
			}
			return;
		}
		for (const [index, item] of value.entries()) {
			addMissingSecretArrayItems(
				definition.items,
				item,
				[...path, String(index)],
				configured,
				allowedMissingRequiredPaths,
			);
		}
	}
};

const stripConfiguredSecrets = (
	definition: AppPropertyDefinition,
	value: unknown,
	path: string,
	configured: ReadonlySet<string>,
) => {
	if (definition.type === "object" && isRecord(value)) {
		for (const [key, childDefinition] of Object.entries(definition.properties)) {
			const childPath = `${path}/${encodePointerSegment(key)}`;
			if (configured.has(childPath)) {
				Reflect.deleteProperty(value, key);
			} else {
				stripConfiguredSecrets(childDefinition, value[key], childPath, configured);
			}
		}
	} else if (definition.type === "array" && Array.isArray(value)) {
		for (let index = value.length - 1; index >= 0; index -= 1) {
			const childPath = `${path}/${index}`;
			if (configured.has(childPath)) {
				value.splice(index, 1);
			} else {
				stripConfiguredSecrets(definition.items, value[index], childPath, configured);
			}
		}
	}
};

export const validateRestoredProperties = Effect.fn(function* (
	properties: Readonly<Record<string, unknown>>,
	propertiesSchema: AppSchema,
	configuredSecretPaths: ReadonlyArray<string>,
	allowMissingRequiredSecrets: boolean,
) {
	const configured = new Set<string>();
	const allowedMissingRequiredPaths: Array<ReadonlyArray<string>> = [];
	const candidate = structuredClone(properties) as Record<string, unknown>;
	for (const pointer of configuredSecretPaths) {
		const path = decodePointer(pointer);
		if (
			!path ||
			configured.has(pointer) ||
			definitionAtPointer(propertiesSchema, path)?.secret !== true
		) {
			return yield* new DbError({
				message: "Restored plugin configuration has invalid secret redactions",
			});
		}
		configured.add(pointer);
		allowedMissingRequiredPaths.push(path);
	}
	for (const path of allowedMissingRequiredPaths.sort(comparePointerPaths)) {
		if (!addMissingValue(candidate, path)) {
			return yield* new DbError({
				message: "Restored plugin configuration has invalid secret redactions",
			});
		}
	}
	if (allowMissingRequiredSecrets) {
		for (const [key, definition] of Object.entries(propertiesSchema.fields)) {
			addMissingSecretArrayItems(
				definition,
				candidate[key],
				[key],
				configured,
				allowedMissingRequiredPaths,
			);
		}
		allowedMissingRequiredPaths.push(
			...concretePluginConfigSecretPaths(propertiesSchema, properties),
		);
	}
	const redactedSchema = redactPluginConfig(propertiesSchema, {}).configSchema;
	const parsed = yield* parseAppSchemaProperties({
		properties: candidate,
		kind: "Plugin config",
		allowedMissingRequiredPaths,
		propertiesSchema: redactedSchema,
	}).pipe(
		Effect.mapError(
			() =>
				new DbError({
					message: "Plugin configuration does not match the selected package revision",
				}),
		),
	);
	for (const [key, definition] of Object.entries(redactedSchema.fields)) {
		const path = `/${encodePointerSegment(key)}`;
		if (configured.has(path)) {
			Reflect.deleteProperty(parsed, key);
		} else {
			stripConfiguredSecrets(definition, parsed[key], path, configured);
		}
	}
	const final = parseAppSchemaPropertiesSafe({
		properties: parsed,
		kind: "Plugin config",
		propertiesSchema: redactedSchema,
	});
	return { needsConfiguration: !final.success, properties: final.success ? final.data : parsed };
});

export class PluginConfigRevisions extends Context.Service<PluginConfigRevisions>()(
	"PluginConfigRevisions",
	{
		make: Effect.gen(function* () {
			const encryptionKey = yield* PluginConfigEncryptionKey;
			const lock = Effect.fn("PluginConfigRevisions.lock")(function* (pluginId: string) {
				const db = yield* Database;
				yield* mapDatabaseErrors(
					db.execute(sql`select pg_advisory_xact_lock(hashtext(${"plugin-config:" + pluginId}))`),
				);
			});
			const decrypt = (row: ConfigRow) =>
				encryptionKey.load.pipe(
					Effect.flatMap((encryption) => encryption.decrypt(row, attribution(row))),
					Effect.flatMap(Schema.decodeUnknownEffect(Properties)),
					Effect.mapError(
						() =>
							new DbError({
								message: `Plugin configuration ${row.id} is unavailable or failed authentication`,
							}),
					),
				);
			const read = Effect.fn("PluginConfigRevisions.read")(function* (input: {
				id: string;
				pluginRevisionId: string;
				ownerUserId: string | null;
			}) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select()
						.from(tables.pluginConfigRevision)
						.where(eq(tables.pluginConfigRevision.id, input.id))
						.limit(1),
				);
				if (
					!row ||
					row.pluginRevisionId !== input.pluginRevisionId ||
					row.ownerUserId !== input.ownerUserId
				) {
					return yield* new DbError({ message: "Invalid pinned plugin configuration ownership" });
				}
				return yield* decrypt(row);
			});
			const createRevision = Effect.fn(function* (
				input: CreateConfigRevisionInput,
				configuredSecretPaths?: ReadonlyArray<string>,
				allowMissingRequiredSecrets = false,
			) {
				const db = yield* Database;
				const encryption = yield* encryptionKey.load;
				const [revision] = yield* mapDatabaseErrors(
					db
						.select()
						.from(tables.pluginRevision)
						.where(eq(tables.pluginRevision.id, input.pluginRevisionId))
						.limit(1),
				);
				if (!revision) {
					return yield* new DbError({ message: "Plugin revision is unavailable" });
				}
				yield* lock(revision.pluginId);
				const [plugin] = yield* mapDatabaseErrors(
					db.select().from(tables.plugin).where(eq(tables.plugin.id, revision.pluginId)).limit(1),
				);
				if (
					!plugin ||
					(input.scope === "environment"
						? plugin.scope !== "system" ||
							input.ownerUserId !== null ||
							input.pluginInstallationId !== null
						: plugin.scope !== "user" ||
							input.ownerUserId !== plugin.ownerId ||
							input.pluginInstallationId === null)
				) {
					return yield* new DbError({ message: "Invalid configuration revision ownership" });
				}
				if (input.scope === "installation" && input.pluginInstallationId) {
					const [installation] = yield* mapDatabaseErrors(
						db
							.select()
							.from(tables.pluginInstallation)
							.where(eq(tables.pluginInstallation.id, input.pluginInstallationId))
							.limit(1),
					);
					if (
						!installation ||
						installation.userId !== input.ownerUserId ||
						installation.pluginId !== plugin.id ||
						installation.uninstalledAt !== null
					) {
						return yield* new DbError({ message: "Invalid configuration installation ownership" });
					}
				}
				const restored =
					configuredSecretPaths === undefined
						? {
								needsConfiguration: false,
								properties: yield* parseAppSchemaProperties({
									kind: "Plugin config",
									properties: input.properties,
									propertiesSchema: revision.manifest.configSchema,
								}).pipe(
									Effect.mapError(
										() =>
											new DbError({
												message:
													"Plugin configuration does not match the selected package revision",
											}),
									),
								),
							}
						: yield* validateRestoredProperties(
								input.properties,
								revision.manifest.configSchema,
								configuredSecretPaths,
								allowMissingRequiredSecrets,
							);
				const properties = restored.properties;
				const payloadFingerprint = yield* encryption
					.fingerprint(properties)
					.pipe(
						Effect.mapError(() => new DbError({ message: "Configuration fingerprint failed" })),
					);
				const rows = yield* mapDatabaseErrors(
					db
						.select()
						.from(tables.pluginConfigRevision)
						.where(
							and(
								eq(tables.pluginConfigRevision.pluginRevisionId, input.pluginRevisionId),
								isNotNull(tables.pluginConfigRevision.encryptedPayload),
							),
						),
				);
				for (const row of rows) {
					if (
						row.scope === input.scope &&
						row.ownerUserId === input.ownerUserId &&
						row.pluginInstallationId === input.pluginInstallationId &&
						encryption.hasKey(row.encryptionKeyId) &&
						row.payloadFingerprint === payloadFingerprint
					) {
						yield* decrypt(row);
						return row.id;
					}
				}
				const identity = {
					id: generateId(),
					scope: input.scope,
					payloadFingerprint,
					ownerUserId: input.ownerUserId,
					encryptionKeyId: encryption.activeKeyId,
					pluginRevisionId: input.pluginRevisionId,
				};
				const envelope = yield* encryption
					.encrypt(properties, attribution(identity))
					.pipe(Effect.mapError(() => new DbError({ message: "Configuration encryption failed" })));
				yield* mapDatabaseErrors(
					db
						.insert(tables.pluginConfigRevision)
						.values({ ...identity, ...envelope, pluginInstallationId: input.pluginInstallationId }),
				);
				return identity.id;
			});
			const create = Effect.fn("PluginConfigRevisions.create")((input: CreateConfigRevisionInput) =>
				createRevision(input),
			);
			const createForRestore = Effect.fn("PluginConfigRevisions.createForRestore")((
				input: CreateConfigRevisionInput & {
					configuredSecretPaths: ReadonlyArray<string>;
					allowMissingRequiredSecrets: boolean;
				},
			) => {
				const { configuredSecretPaths, allowMissingRequiredSecrets, ...revisionInput } = input;
				return createRevision(revisionInput, configuredSecretPaths, allowMissingRequiredSecrets);
			});
			const validateKeys = Effect.fn("PluginConfigRevisions.validateKeys")(function* () {
				yield* encryptionKey.load;
				return undefined;
			});
			const resolveEnvironment = Effect.fn("PluginConfigRevisions.resolveEnvironment")(
				function* (input: {
					pluginId: string;
					pluginRevisionId: string;
					pluginSlug: string;
					configSchema: AppSchema;
				}) {
					yield* lock(input.pluginId);
					yield* validateKeys();
					const loaded = yield* configFromAppSchema(input.configSchema, ([key]) =>
						pluginConfigEnvironmentKey(input.pluginSlug, key ?? ""),
					).pipe(
						Effect.mapError(
							() =>
								new DbError({
									message: `Environment configuration for plugin ${input.pluginSlug} is invalid`,
								}),
						),
					);
					const properties = Object.fromEntries(
						Object.entries(loaded).flatMap(([key, value]) => {
							if (!Option.isOption(value)) {
								return [[key, value]];
							}
							return Option.isSome(value) ? [[key, value.value]] : [];
						}),
					);
					return yield* create({
						properties,
						ownerUserId: null,
						scope: "environment",
						pluginInstallationId: null,
						pluginRevisionId: input.pluginRevisionId,
					});
				},
			);
			return { lock, read, create, decrypt, validateKeys, createForRestore, resolveEnvironment };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(PluginConfigEncryptionKey.layer),
	);
}
