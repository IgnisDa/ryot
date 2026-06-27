import { CLIENT_PLUGIN_COMPILER_LIMITS } from "@ryot-app/client-plugin-compiler/limits";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	pluginClientFileExtension,
	isPluginClientTextSource,
} from "@ryot-app/client-plugin-contract";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	ClientRendererBadRequest,
	ClientRendererDefinition,
	ClientRendererNotFound,
} from "@ryot-app/contract/modules/client-pages/schemas";
import { isPluginSharedSource } from "@ryot-app/contract/modules/plugins/shared-file-policy";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import { Context, Effect, Encoding, Layer, Result, Schema } from "effect";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import {
	formatPropertyIssues,
	parseAppSchemaProperties,
	validateAppSchemaDefinition,
} from "#lib/property-schema/property-schema-runtime";
import { slugify } from "#lib/shared/slug";
import { trimToNull } from "#lib/shared/validation";
import { ClientPluginCompiler } from "#modules/plugins/client-plugin-compiler";
import { PluginRepository } from "#modules/plugins/repository";

import { ClientPagesRepository } from "./repository";

const notFound = () => new ClientRendererNotFound({ reason: { code: "renderer-not-found" } });
const invalid = (message: string) =>
	new ClientRendererBadRequest({ reason: { code: "definition-invalid", message } });

const normalizeDefinition = (definition: ClientRendererDefinition) =>
	Effect.gen(function* () {
		if (definition.pluginDependencies.length > 0 || definition.automaticEntityPresentations) {
			return yield* invalid("Plugin dependencies and automatic presentations are added in Task 02");
		}
		const files = [...definition.files].sort((left, right) => left.path.localeCompare(right.path));
		if (new Set(files.map(({ path }) => path)).size !== files.length) {
			return yield* invalid("Renderer file paths must be unique");
		}
		let totalBytes = 0;
		const decoded: Record<string, Uint8Array> = {};
		for (const file of files) {
			const pathIssue = canonicalRelativePosixPathIssue(file.path);
			if (pathIssue || (!file.path.startsWith("client/") && !file.path.startsWith("shared/"))) {
				return yield* invalid(
					`Renderer file path '${file.path}' must be canonical under client/ or shared/`,
				);
			}
			if (
				(file.path.startsWith("client/") && pluginClientFileExtension(file.path) === undefined) ||
				(file.path.startsWith("shared/") && !isPluginSharedSource(file.path))
			) {
				return yield* invalid(`Renderer file '${file.path}' has an unsupported extension`);
			}
			const decodedContent = Encoding.decodeBase64(file.content);
			if (Result.isFailure(decodedContent)) {
				return yield* invalid(`Renderer file '${file.path}' has invalid base64 content`);
			}
			const bytes = decodedContent.success;
			decoded[file.path] = bytes;
			totalBytes += bytes.byteLength;
			if (
				!isPluginClientTextSource(file.path) &&
				bytes.byteLength > CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes
			) {
				return yield* invalid(`Renderer asset '${file.path}' is too large`);
			}
			if (isPluginClientTextSource(file.path) || file.path.startsWith("shared/")) {
				if (
					Result.isFailure(
						Result.try(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
					)
				) {
					return yield* invalid(`Renderer text source '${file.path}' is not valid UTF-8`);
				}
			}
		}
		if (totalBytes > CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes) {
			return yield* invalid("Renderer source exceeds the client source limit");
		}
		if (!Object.hasOwn(decoded, definition.entry)) {
			return yield* invalid(`Renderer entry '${definition.entry}' is missing`);
		}
		if (
			!definition.entry.startsWith("client/") ||
			(!definition.entry.endsWith(".ts") && !definition.entry.endsWith(".tsx"))
		) {
			return yield* invalid("Renderer entry must be a TypeScript module under client/");
		}
		const schemaIssues = validateAppSchemaDefinition(definition.settingsSchema);
		if (schemaIssues.length > 0) {
			return yield* invalid(formatPropertyIssues(schemaIssues));
		}
		yield* parseAppSchemaProperties({
			properties: {},
			kind: "Renderer settings",
			propertiesSchema: definition.settingsSchema,
		}).pipe(
			Effect.catchTag("PropertyValidationError", (error) =>
				error.issues.some(({ message }) => message.includes("Dynamic choices"))
					? Effect.fail(invalid(formatPropertyIssues(error.issues)))
					: Effect.void,
			),
		);
		return { definition: { ...definition, files }, decoded };
	});

export class ClientPagesService extends Context.Service<ClientPagesService>()(
	"ClientPagesService",
	{
		make: Effect.gen(function* () {
			const plugins = yield* PluginRepository;
			const compiler = yield* ClientPluginCompiler;
			const repository = yield* ClientPagesRepository;

			const requireRenderer = Effect.fn(function* (
				userId: CurrentUserValue["id"],
				rendererId: string,
			) {
				return (yield* repository.findRenderer(userId, rendererId)) ?? (yield* notFound());
			});

			const createRenderer = Effect.fn(function* (
				user: CurrentUserValue,
				input: {
					readonly slug: string;
					readonly name: string;
					readonly draftDefinition: ClientRendererDefinition;
				},
			) {
				const name = trimToNull(input.name);
				const slug = slugify(input.slug);
				if (!name || !slug) {
					return yield* invalid("Renderer name and slug are required");
				}
				const { definition } = yield* normalizeDefinition(input.draftDefinition);
				return (
					(yield* repository.createRenderer({
						name,
						slug,
						userId: user.id,
						draftDefinition: definition,
					})) ?? (yield* invalid("Renderer slug is already in use"))
				);
			});

			const replaceDraft = Effect.fn(function* (
				user: CurrentUserValue,
				rendererId: string,
				input: {
					readonly expectedDraftRevision: number;
					readonly draftDefinition: ClientRendererDefinition;
				},
			) {
				yield* requireRenderer(user.id, rendererId);
				const { definition } = yield* normalizeDefinition(input.draftDefinition);
				return (
					(yield* repository.replaceDraft({
						rendererId,
						definition,
						userId: user.id,
						expectedRevision: input.expectedDraftRevision,
					})) ?? (yield* new ClientRendererBadRequest({ reason: { code: "draft-revision-stale" } }))
				);
			});

			const publish = Effect.fn(function* (
				user: CurrentUserValue,
				rendererId: string,
				expectedDraftRevision: number,
			) {
				const renderer = yield* requireRenderer(user.id, rendererId);
				if (renderer.draftRevision !== expectedDraftRevision) {
					return yield* new ClientRendererBadRequest({ reason: { code: "draft-revision-stale" } });
				}
				const { definition, decoded } = yield* normalizeDefinition(renderer.draftDefinition);
				const publishedHash = sha256Hex(
					yield* Schema.encodeUnknownEffect(Schema.fromJsonString(ClientRendererDefinition))(
						definition,
					).pipe(Effect.orDie),
				);
				const artifact = yield* compiler
					.compile({
						files: decoded,
						name: renderer.name,
						application: "page",
						entry: definition.entry,
						apiVersion: CLIENT_API_VERSION,
					})
					.pipe(
						Effect.mapError(
							(error) =>
								new ClientRendererBadRequest({
									reason: {
										code: "build-failed",
										diagnostics: error.diagnostics.map(
											({ file, message }) => `${file}: ${message}`,
										),
									},
								}),
						),
					);
				const database = yield* Database;
				const buildId = yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							const current = yield* repository.lockRenderer(user.id, rendererId);
							if (!current || current.draftRevision !== expectedDraftRevision) {
								return yield* new ClientRendererBadRequest({
									reason: { code: "draft-revision-stale" },
								});
							}
							for (const dependent of yield* repository.listDependentSettings(
								user.id,
								rendererId,
							)) {
								yield* parseAppSchemaProperties({
									kind: "Saved view settings",
									properties: dependent.settings ?? {},
									propertiesSchema: definition.settingsSchema,
								}).pipe(
									Effect.mapError(
										(error) =>
											new ClientRendererBadRequest({
												reason: {
													code: "settings-incompatible",
													message: formatPropertyIssues(error.issues),
												},
											}),
									),
								);
							}
							yield* plugins.persistClientArtifact(artifact);
							return (
								(yield* repository.publish({
									rendererId,
									definition,
									publishedHash,
									userId: user.id,
									artifactHash: artifact.hash,
									revision: expectedDraftRevision,
								})) ??
								(yield* new ClientRendererBadRequest({ reason: { code: "draft-revision-stale" } }))
							);
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);
				return { buildId, publishedHash, publishedRevision: expectedDraftRevision };
			});

			const deleteRenderer = Effect.fn(function* (user: CurrentUserValue, rendererId: string) {
				const existing = yield* requireRenderer(user.id, rendererId);
				const database = yield* Database;
				return yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							yield* repository.lockRenderer(user.id, rendererId);
							if ((yield* repository.listDependentSettings(user.id, rendererId)).length > 0) {
								return yield* new ClientRendererBadRequest({ reason: { code: "renderer-in-use" } });
							}
							return (yield* repository.deleteRenderer(user.id, rendererId)) ?? existing;
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);
			});

			const prepare = Effect.fn(function* (
				user: Pick<CurrentUserValue, "id">,
				savedViewId: string,
			) {
				const prepared = yield* repository.findPreparedTarget(user.id, savedViewId);
				if (!prepared?.renderer.publishedHash || !prepared.renderer.publishedArtifactHash) {
					return yield* new ClientRendererBadRequest({ reason: { code: "renderer-unpublished" } });
				}
				return {
					identity: {
						buildId: prepared.buildId,
						savedViewId: prepared.viewId,
						rendererId: prepared.rendererId,
						viewRevision: prepared.view.revision,
						publishedHash: prepared.renderer.publishedHash,
						artifactHash: prepared.renderer.publishedArtifactHash,
						publishedRevision: prepared.renderer.publishedRevision,
					},
					context: {
						settings: prepared.view.settings ?? {},
						dataSources: prepared.view.dataSources,
						renderer: { kind: "custom" as const, id: prepared.rendererId },
						target: { kind: "saved-view" as const, savedViewId: prepared.viewId },
					},
					artifact: {
						format: CLIENT_ARTIFACT_FORMAT,
						apiVersion: CLIENT_API_VERSION,
						compilerVersion: CLIENT_COMPILER_VERSION,
						hash: prepared.renderer.publishedArtifactHash,
						bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
					},
				};
			});

			return {
				prepare,
				publish,
				replaceDraft,
				createRenderer,
				deleteRenderer,
				getRenderer: requireRenderer,
				listRenderers: (userId: CurrentUserValue["id"]) => repository.listRenderers(userId),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
