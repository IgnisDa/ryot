import type { PluginPackageId } from "@ryot-app/contract/schema/brands";

import { createRyotMutation } from "./definitions";
import { useRyotMutation } from "./hooks";

const retryEntityPopulationMutation = createRyotMutation<
	{ readonly entityId: string; readonly packageId: PluginPackageId },
	{ readonly retried: boolean }
>(({ input, client }) => client.entities.retryPopulation(input));

export const useRetryEntityPopulation = () => useRyotMutation(retryEntityPopulationMutation);
