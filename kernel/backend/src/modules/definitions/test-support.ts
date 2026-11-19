import { kernelDefinitionSource } from "@ryot-app/definitions/kernel-definitions";
import type { DefinitionSource } from "@ryot-app/definitions/snapshot";
import { Effect } from "effect";

import { DefinitionRepository } from "./repository";

export const seedKernelDefinitions = Effect.fn(function* (
	source: DefinitionSource = kernelDefinitionSource(),
) {
	const definitions = yield* DefinitionRepository;
	yield* definitions.replaceKernelDefinitions(source);
});
