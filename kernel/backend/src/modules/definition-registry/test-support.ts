import { Effect } from "effect";

import { kernelDefinitionSource } from "./kernel-source";
import { DefinitionRepository } from "./repository";
import type { DefinitionSource } from "./snapshot";

export const seedKernelDefinitions = Effect.fn(function* (
	source: DefinitionSource = kernelDefinitionSource(),
) {
	const definitions = yield* DefinitionRepository;
	yield* definitions.replaceKernelDefinitions(source);
});
