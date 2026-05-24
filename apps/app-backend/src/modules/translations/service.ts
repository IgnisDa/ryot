import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect } from "effect";

import { DbRunner } from "#lib/db";
import { isObjectRecord } from "#lib/predicates";
import type { SandboxScriptId } from "#lib/schema/brands";
import type { ListedEntity } from "#modules/entities/schemas";
import type {
	TranslationOverlayRequest,
	TranslationOverlayResult,
} from "#modules/entities/translation-overlay";
import { SandboxRepository } from "#modules/sandbox/repository";

import { resolveLanguage } from "./language-resolution";
import { mergeTranslationOverlay, type TranslationFields } from "./overlay-merge";
import { TranslationsRepository } from "./repository";
import { TranslateEntityWorkflow, translateEntityExecutionId } from "./workflows";

const asRecord = (value: unknown): Record<string, unknown> => (isObjectRecord(value) ? value : {});

const canonicalFields = (entity: ListedEntity): TranslationFields => {
	const description = asRecord(entity.properties).description;
	return {
		name: entity.name,
		image: entity.image,
		description: typeof description === "string" ? description : null,
	};
};

const withMergedFields = (entity: ListedEntity, fields: TranslationFields): ListedEntity => ({
	...entity,
	name: fields.name,
	image: fields.image,
	properties:
		fields.description !== null
			? { ...asRecord(entity.properties), description: fields.description }
			: entity.properties,
});

const canonical = (entity: ListedEntity): TranslationOverlayResult => ({
	entity,
	status: "none",
});

export class TranslationsService extends Effect.Service<TranslationsService>()(
	"TranslationsService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const engine = yield* WorkflowEngine;
			const repository = yield* TranslationsRepository;
			const sandboxRepository = yield* SandboxRepository;

			const requestFill = (input: {
				language: string;
				externalId: string;
				entity: ListedEntity;
				entitySchemaSlug: string;
				scriptId: SandboxScriptId;
			}) => {
				const executionId = translateEntityExecutionId({
					language: input.language,
					entityId: input.entity.id,
				});
				return engine
					.execute(TranslateEntityWorkflow, {
						executionId,
						discard: true,
						payload: {
							executionId,
							language: input.language,
							scriptId: input.scriptId,
							entityId: input.entity.id,
							externalId: input.externalId,
							properties: input.entity.properties,
							entitySchemaSlug: input.entitySchemaSlug,
						},
					})
					.pipe(
						Effect.asVoid,
						Effect.catchAllCause((cause) =>
							Effect.logWarning("Failed to enqueue translation fill", cause),
						),
					);
			};

			const resolveOverlayInner = Effect.fn("TranslationsService.resolveOverlay")(function* (
				input: TranslationOverlayRequest,
			) {
				const { entity, entitySchemaSlug } = input;
				if (entity.sandboxScriptId === null || entity.externalId === null) {
					return canonical(entity);
				}

				const providerInformation = yield* runWithDb(
					sandboxRepository.findProviderInformation(entity.sandboxScriptId),
				);
				if (!providerInformation?.canonicalLanguage) {
					return canonical(entity);
				}

				const preferences = yield* runWithDb(repository.findUserLanguagePreferences(input.user.id));
				const resolution = resolveLanguage({
					preferences,
					source: providerInformation.source,
					canonicalLanguage: providerInformation.canonicalLanguage,
				});
				if (resolution.kind === "canonical") {
					return canonical(entity);
				}

				const overlay = yield* runWithDb(
					repository.findOverlay({ entityId: entity.id, language: resolution.language }),
				);
				const merged = mergeTranslationOverlay({ overlay, canonical: canonicalFields(entity) });

				if (merged.status === "pending") {
					yield* requestFill({
						entity,
						entitySchemaSlug,
						language: resolution.language,
						externalId: entity.externalId,
						scriptId: entity.sandboxScriptId,
					});
					return { entity, status: merged.status };
				}

				if (merged.status === "ready") {
					return { status: merged.status, entity: withMergedFields(entity, merged.fields) };
				}

				return { entity, status: merged.status };
			});

			const resolveOverlay = (
				input: TranslationOverlayRequest,
			): Effect.Effect<TranslationOverlayResult> =>
				resolveOverlayInner(input).pipe(
					Effect.catchAll((error) =>
						Effect.logWarning("Translation overlay resolution failed", error).pipe(
							Effect.as(canonical(input.entity)),
						),
					),
				);

			return { resolveOverlay };
		}),
	},
) {}
