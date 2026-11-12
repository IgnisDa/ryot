import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import { AssistantError } from "@ryot-app/contract/modules/assistant/schemas";
import type { PageDraftBuildIdentity } from "@ryot-app/contract/modules/pages/identity";
import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import {
	createRyotHostMutation,
	createRyotHostQuery,
	createRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	type AssistantConversationDetail,
	type AssistantConversationList,
	assistantConversationRecipe,
	assistantConversationsRecipe,
} from "@ryot-app/ryotql-recipes/assistant";
import { Effect, Schema } from "effect";

import { AssistantApi } from "#/api/assistant";
import { AuthenticatedApiError, isDemoOperationProtectedError } from "#/api/authenticated";
import { PagesApi } from "#/api/pages";
import { KernelHostServices } from "#/host-services";

export const conversationsQuery = createRyotQuery<
	{ readonly after?: string | undefined },
	AssistantConversationList
>(({ input, client }) =>
	client.data.query(
		assistantConversationsRecipe,
		{},
		{ pages: { conversations: { limit: 20, after: input.after } } },
	),
);
export const conversationQuery = createRyotQuery(assistantConversationRecipe);
export const messagesQuery = createRyotQuery<
	{ readonly conversationId: string; readonly after?: string | undefined },
	AssistantConversationDetail["messages"]
>(({ input, client }) =>
	client.data
		.query(
			assistantConversationRecipe,
			{ conversationId: input.conversationId },
			{ pages: { messages: { limit: 100, after: input.after } } },
		)
		.pipe(Effect.map((detail) => detail.messages)),
);
export const callsQuery = createRyotQuery<
	{ readonly conversationId: string; readonly after?: string | undefined },
	AssistantConversationDetail["calls"]
>(({ input, client }) =>
	client.data
		.query(
			assistantConversationRecipe,
			{ conversationId: input.conversationId },
			{ pages: { calls: { limit: 100, after: input.after } } },
		)
		.pipe(Effect.map((detail) => detail.calls)),
);
export const turnsQuery = createRyotQuery<
	{ readonly conversationId: string; readonly after?: string | undefined },
	AssistantConversationDetail["turns"]
>(({ input, client }) =>
	client.data
		.query(
			assistantConversationRecipe,
			{ conversationId: input.conversationId },
			{ pages: { turns: { limit: 100, after: input.after } } },
		)
		.pipe(Effect.map((detail) => detail.turns)),
);
export const providerQuery = createRyotHostQuery<
	Record<string, never>,
	ContractSuccess<"assistant", "providerMetadata">,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ hostServices }) =>
		hostServices.runtime.runSync(AssistantApi).providerMetadata(hostServices.scope, {}),
	{ hostServices: KernelHostServices },
);
export const createConversationMutation = createRyotHostMutation<
	ContractPayload<"assistant", "createConversation">,
	ContractSuccess<"assistant", "createConversation">,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(AssistantApi)
			.createConversation(hostServices.scope, { payload: input })
			.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
	{ hostServices: KernelHostServices },
);
export const deleteConversationMutation = createRyotHostMutation<
	ContractPayload<"assistant", "deleteConversation">,
	ContractSuccess<"assistant", "deleteConversation">,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(AssistantApi)
			.deleteConversation(hostServices.scope, { payload: input })
			.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
	{ hostServices: KernelHostServices },
);
export const submitMutation = createRyotHostMutation<
	ContractPayload<"assistant", "submit">,
	ContractSuccess<"assistant", "submit">,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(AssistantApi)
			.submit(hostServices.scope, { payload: input })
			.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
	{ hostServices: KernelHostServices },
);
export const decideMutation = createRyotHostMutation<
	ContractPayload<"assistant", "decide">,
	ContractSuccess<"assistant", "decide">,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(AssistantApi)
			.decide(hostServices.scope, { payload: input })
			.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
	{ hostServices: KernelHostServices },
);
export const configureProviderMutation = createRyotHostMutation<
	ContractPayload<"assistant", "configureProvider">,
	ContractSuccess<"assistant", "configureProvider">,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(AssistantApi)
			.configureProvider(hostServices.scope, { payload: input })
			.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
	{ hostServices: KernelHostServices },
);
export const deleteProviderMutation = createRyotHostMutation<
	undefined,
	ContractSuccess<"assistant", "deleteProvider">,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ client, hostServices }) =>
		hostServices.runtime
			.runSync(AssistantApi)
			.deleteProvider(hostServices.scope, {})
			.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
	{ hostServices: KernelHostServices },
);
export const savePageMutation = createRyotHostMutation<
	ContractPayload<"assistant", "savePage">,
	ContractSuccess<"assistant", "savePage">,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(AssistantApi)
			.savePage(hostServices.scope, { payload: input })
			.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
	{ hostServices: KernelHostServices },
);

export const assistantFailureText = (error: unknown): string => {
	if (isDemoOperationProtectedError(error)) {
		return "This change is unavailable in demo sessions.";
	}
	const reason =
		error instanceof AuthenticatedApiError && Schema.is(AssistantError)(error.cause)
			? error.cause.reason.code
			: null;
	if (reason === "provider-unavailable") {
		return "Set up a provider in Settings → Ryobot to start chatting.";
	}
	if (
		reason === "revision-stale" ||
		reason === "turn-not-active" ||
		reason === "decision-conflict"
	) {
		return "This request changed. Refresh the conversation before deciding.";
	}
	if (reason === "conversation-active") {
		return "Wait for Ryobot to finish or review its pending requests.";
	}
	if (reason === "conversation-not-found") {
		return "This conversation is no longer available.";
	}
	if (reason === "page-preview-not-found") {
		return "This preview has changed. Ask Ryobot for a new preview.";
	}
	return "Ryobot could not complete this request. Try again.";
};

export const previewQuery = createRyotHostQuery<
	PageDraftBuildIdentity,
	PreparedClientPage,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, hostServices }) =>
		hostServices.runtime
			.runSync(PagesApi)
			.prepare(hostServices.scope, { payload: { target: { kind: "page-preview", ...input } } }),
	{ cancelOnUnmount: true, hostServices: KernelHostServices },
);
