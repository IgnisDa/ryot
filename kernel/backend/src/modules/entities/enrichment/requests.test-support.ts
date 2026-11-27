import type { EnrichmentRequests } from "./requests";

export const enrichmentRequestRow = (
	input: Parameters<EnrichmentRequests["Service"]["ensure"]>[0],
) => ({
	...input,
	attempt: 0,
	sequence: 1,
	joinedTo: null,
	failureKind: null,
	completedAt: null,
	baseCheckedAt: null,
	createdAt: new Date(0),
	state: "queued" as const,
	retryOf: input.retryOf ?? null,
	inputHash: input.inputHash ?? null,
	requesterUserId: input.requester ?? null,
	populationPin: input.populationPin ?? null,
	populationMode: input.populationMode ?? null,
	sourceContentGeneration: input.sourceContentGeneration ?? null,
});
