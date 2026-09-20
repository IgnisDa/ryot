import {
	SignalAudiencePolicy,
	type SignalCatalogState,
} from "@ryot-app/contract/modules/automations/schemas";
import type { SignalSchemaReference } from "@ryot-app/contract/modules/plugins/references";
import { SignalSchemaSlug, type UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Schema } from "effect";

import { DefinitionRepository } from "#modules/definition-registry/repository";
import type { SignalSchemaDefinition } from "#modules/definition-registry/snapshot";

export type SignalSchemaScope = Pick<
	SignalSchemaDefinition,
	"catalogState" | "name" | "pluginId" | "propertiesSchema" | "slug"
> & { id: SignalSchemaSlug; userId: UserId | null; audiencePolicy: SignalAudiencePolicy };

export type BuiltinSignalSchemaInput = Pick<
	SignalSchemaScope,
	"audiencePolicy" | "catalogState" | "name" | "propertiesSchema" | "slug"
>;

const toScope = (definition: SignalSchemaDefinition): SignalSchemaScope => ({
	...definition,
	userId: null,
	id: SignalSchemaSlug.make(definition.slug),
	audiencePolicy: Schema.decodeSync(SignalAudiencePolicy)(definition.audiencePolicy),
});

const toNullableScope = (definition: SignalSchemaDefinition | null) =>
	definition ? toScope(definition) : null;

export class SignalSchemasRepository extends Context.Service<SignalSchemasRepository>()(
	"SignalSchemasRepository",
	{
		make: Effect.gen(function* () {
			const definitions = yield* DefinitionRepository;
			const findGlobalByReference = (reference: SignalSchemaReference) =>
				definitions.findGlobalSignalSchema(reference).pipe(Effect.map(toNullableScope));
			const findVisibleByReference = (input: {
				reference: SignalSchemaReference;
				userId: UserId | null;
			}) =>
				input.userId === null
					? findGlobalByReference(input.reference)
					: definitions
							.findUserSignalSchema(input.userId, input.reference)
							.pipe(Effect.map(toNullableScope));
			const findKernelBySlug = (slug: string) =>
				findGlobalByReference({ owner: { kind: "kernel" }, slug: SignalSchemaSlug.make(slug) });
			const findActiveKernelBySlug = (slug: string) =>
				findKernelBySlug(slug).pipe(
					Effect.map((value) => (value?.catalogState === "active" ? value : null)),
				);
			const listActiveBuiltins = definitions
				.listGlobalSignalSchemas()
				.pipe(
					Effect.map((signals) =>
						signals.flatMap((signal) =>
							signal.pluginId === null && signal.catalogState === "active" ? [toScope(signal)] : [],
						),
					),
				);
			const insertBuiltin = Effect.fn(function* (input: BuiltinSignalSchemaInput) {
				return (
					(yield* findKernelBySlug(input.slug)) ?? {
						...input,
						userId: null,
						pluginId: null,
						id: SignalSchemaSlug.make(input.slug),
					}
				);
			});
			const updateBuiltinDisplay = (input: {
				id: SignalSchemaSlug;
				name: string;
				catalogState: SignalCatalogState;
			}) => findKernelBySlug(input.id);
			return {
				insertBuiltin,
				findKernelBySlug,
				listActiveBuiltins,
				updateBuiltinDisplay,
				findGlobalByReference,
				findVisibleByReference,
				findActiveKernelBySlug,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
