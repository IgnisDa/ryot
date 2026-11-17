import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import { PageAuthoringError } from "@ryot-app/contract/modules/pages/schemas";
import { formatDisplayText } from "@ryot-app/i18n/format";
import type { Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { createRyotHostMutation, createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	type PageList,
	pageRecipe,
	type PageRecord,
	pagesRecipe,
} from "@ryot-app/ryotql-recipes/pages";
import { Effect, Schema } from "effect";

import {
	AuthenticatedApiError,
	isDemoOperationProtectedError,
	isEntitlementRequiredError,
} from "#/api/authenticated";
import { PagesApi } from "#/api/pages";
import { SavedViewsApi } from "#/api/saved-views";
import { KernelHostServices } from "#/host-services";

export const pagesQuery = createRyotQuery<{ readonly after?: string | undefined }, PageList>(
	({ input, client }) =>
		client.data.query(pagesRecipe, {}, { pages: { pages: { limit: 20, after: input.after } } }),
);
export const pageQuery = createRyotQuery<
	{ readonly pageId: string; readonly reload: number },
	null | PageRecord
>(({ input, client }) =>
	client.data.query(pageRecipe, { pageId: input.pageId }).pipe(Effect.map((page) => page ?? null)),
);
export const createPageMutation = createRyotHostMutation<
	ContractPayload<"pageAuthoring", "create">,
	ContractSuccess<"pageAuthoring", "create">,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(PagesApi)
			.create(hostServices.scope, { payload: input })
			.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
	{ hostServices: KernelHostServices },
);

export type PageCommand =
	| { readonly action: "delete"; readonly payload: ContractPayload<"pageAuthoring", "delete"> }
	| {
			readonly action: "replaceDraft";
			readonly payload: ContractPayload<"pageAuthoring", "replaceDraft">;
	  }
	| {
			readonly action: "compile" | "publish";
			readonly payload: ContractPayload<"pageAuthoring", "compile">;
	  }
	| {
			readonly action: "setWriteAccess";
			readonly payload: ContractPayload<"pageAuthoring", "setWriteAccess">;
	  };

export const pageCommandMutation = createRyotHostMutation<
	PageCommand,
	unknown,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) => {
		const api = hostServices.runtime.runSync(PagesApi);
		let command: Effect.Effect<unknown, AuthenticatedApiError>;
		switch (input.action) {
			case "delete":
				command = api.delete(hostServices.scope, { payload: input.payload });
				break;
			case "compile":
				command = api.compile(hostServices.scope, { payload: input.payload });
				break;
			case "publish":
				command = api.publish(hostServices.scope, { payload: input.payload });
				break;
			case "replaceDraft":
				command = api.replaceDraft(hostServices.scope, { payload: input.payload });
				break;
			case "setWriteAccess":
				command = api.setWriteAccess(hostServices.scope, { payload: input.payload });
				break;
		}
		return command.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint)));
	},
	{ hostServices: KernelHostServices },
);

export const createPageViewMutation = createRyotHostMutation<
	ContractPayload<"savedViews", "create">,
	ContractSuccess<"savedViews", "create">,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(SavedViewsApi)
			.create(hostServices.scope, { payload: input })
			.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
	{ hostServices: KernelHostServices },
);

export const authoringReason = (error: unknown) =>
	error instanceof AuthenticatedApiError && Schema.is(PageAuthoringError)(error.cause)
		? error.cause.reason
		: null;

export const authoringFailureText = (t: (message: Message) => Text, error: unknown): Text => {
	if (isDemoOperationProtectedError(error)) {
		return t(kernelMessage("client.page-authoring.error.demo"));
	}
	if (isEntitlementRequiredError(error)) {
		return t(kernelMessage("client.page-authoring.error.pro-required"));
	}
	const reason = authoringReason(error);
	if (reason === null) {
		return t(kernelMessage("client.page-authoring.error.command-failed"));
	}
	switch (reason.code) {
		case "page-in-use":
			return t(kernelMessage("client.page-authoring.error.page-in-use"));
		case "build-failed":
			return t(kernelMessage("client.page-authoring.error.build-failed"));
		case "page-not-found":
			return t(kernelMessage("client.page-authoring.error.not-found"));
		case "definition-invalid":
			return formatDisplayText(t, reason.message);
		case "draft-revision-stale":
			return t(kernelMessage("client.page-authoring.error.draft-stale"));
		case "compiler-unavailable":
			return t(kernelMessage("client.page-authoring.error.compiler-unavailable"));
		case "dependency-unavailable":
			return t(kernelMessage("client.page-authoring.error.dependency-unavailable"));
		default:
			return t(kernelMessage("client.page-authoring.error.command-failed"));
	}
};
