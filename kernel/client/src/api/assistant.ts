import type { ContractRequest } from "@ryot-app/contract/client";
import { Context, Effect, Layer } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

export class AssistantApi extends Context.Service<AssistantApi>()(
	"@ryot-app/kernel-client/api/assistant/AssistantApi",
	{
		make: Effect.gen(function* () {
			const api = yield* AuthenticatedApi;
			return {
				submit: (scope: ApiScope, request: ContractRequest<"assistant", "submit">) =>
					api.run(scope, (client) => client.assistant.submit(request)),
				decide: (scope: ApiScope, request: ContractRequest<"assistant", "decide">) =>
					api.run(scope, (client) => client.assistant.decide(request)),
				answer: (scope: ApiScope, request: ContractRequest<"assistant", "answer">) =>
					api.run(scope, (client) => client.assistant.answer(request)),
				savePage: (scope: ApiScope, request: ContractRequest<"assistant", "savePage">) =>
					api.run(scope, (client) => client.assistant.savePage(request)),
				interrupt: (scope: ApiScope, request: ContractRequest<"assistant", "interrupt">) =>
					api.run(scope, (client) => client.assistant.interrupt(request)),
				deleteProvider: (
					scope: ApiScope,
					request: ContractRequest<"assistant", "deleteProvider">,
				) => api.run(scope, (client) => client.assistant.deleteProvider(request)),
				providerMetadata: (
					scope: ApiScope,
					request: ContractRequest<"assistant", "providerMetadata">,
				) => api.run(scope, (client) => client.assistant.providerMetadata(request)),
				configureProvider: (
					scope: ApiScope,
					request: ContractRequest<"assistant", "configureProvider">,
				) => api.run(scope, (client) => client.assistant.configureProvider(request)),
				renameConversation: (
					scope: ApiScope,
					request: ContractRequest<"assistant", "renameConversation">,
				) => api.run(scope, (client) => client.assistant.renameConversation(request)),
				deleteConversation: (
					scope: ApiScope,
					request: ContractRequest<"assistant", "deleteConversation">,
				) => api.run(scope, (client) => client.assistant.deleteConversation(request)),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
