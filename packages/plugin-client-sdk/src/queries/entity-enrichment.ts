import type { Effect } from "effect";

import type { RyotClient } from "../client/client";
import { createRyotMutation } from "./definitions";
import { useRyotMutation } from "./hooks";

const requestEntityEnrichmentMutation = createRyotMutation<
	Parameters<RyotClient["entities"]["requestEnrichment"]>[0],
	Effect.Success<ReturnType<RyotClient["entities"]["requestEnrichment"]>>
>(({ input, client }) => client.entities.requestEnrichment(input));

export const useRequestEntityEnrichment = () => useRyotMutation(requestEntityEnrichmentMutation);
