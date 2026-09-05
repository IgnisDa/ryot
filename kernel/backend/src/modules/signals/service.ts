import { notFound } from "@ryot-app/contract/errors";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Schema } from "effect";

import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";

import {
	SignalSchemasRepository,
	type BuiltinSignalSchemaInput,
} from "./signal-schemas-repository";

export class SignalSchemaContractDrift extends Schema.TaggedError<SignalSchemaContractDrift>()(
	"SignalSchemaContractDrift",
	{ message: Schema.String },
) {}

const signalSchemaSlugPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export class SignalSchemasService extends Context.Service<SignalSchemasService>()(
	"SignalSchemasService",
	{
		make: Effect.gen(function* () {
			const repository = yield* SignalSchemasRepository;
			const relationshipSchemasRepository = yield* RelationshipSchemasRepository;

			const getBuiltinBySlug = Effect.fn("SignalSchemasService.getBuiltinBySlug")(function* (
				slug: string,
			) {
				const signalSchema = yield* repository.findGlobalBySlug(slug);
				if (!signalSchema) {
					return yield* notFound("Signal schema not found");
				}
				return signalSchema;
			});

			const ensureBuiltin = Effect.fn("SignalSchemasService.ensureBuiltin")(function* (
				input: BuiltinSignalSchemaInput,
			) {
				if (!signalSchemaSlugPattern.test(input.slug)) {
					return yield* new SignalSchemaContractDrift({
						message: `Invalid built-in signal schema slug: ${input.slug}`,
					});
				}

				if (input.audiencePolicy.kind === "related_users") {
					const relationshipSchema = yield* relationshipSchemasRepository.findById(
						input.audiencePolicy.relationshipSchemaSlug,
						null,
					);
					if (!relationshipSchema) {
						return yield* new SignalSchemaContractDrift({
							message: `Built-in signal schema ${input.slug} references an invalid relationship schema`,
						});
					}
				}

				const existing = yield* repository.findGlobalBySlug(input.slug);
				if (!existing) {
					return yield* repository.insertBuiltin(input);
				}

				const propertiesChanged =
					stableStringify(existing.propertiesSchema) !== stableStringify(input.propertiesSchema);
				const audienceChanged =
					stableStringify(existing.audiencePolicy) !== stableStringify(input.audiencePolicy);
				if (existing.slug !== input.slug || propertiesChanged || audienceChanged) {
					return yield* new SignalSchemaContractDrift({
						message: `Built-in signal schema contract drifted: ${input.slug}`,
					});
				}

				if (existing.name !== input.name || existing.catalogState !== input.catalogState) {
					return yield* repository.updateBuiltinDisplay({
						id: existing.id,
						name: input.name,
						catalogState: input.catalogState,
					});
				}

				return existing;
			});

			return { ensureBuiltin, getBuiltinBySlug };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
