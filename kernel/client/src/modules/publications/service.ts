import type { ContractRequest } from "@ryot-app/contract/client";
import type { SavedViewReference } from "@ryot-app/contract/modules/plugins/references";
import type { PublicationStatusResponse } from "@ryot-app/contract/modules/publications/schemas";
import type { EntitySourceReference } from "@ryot-app/contract/modules/ryotql/entity-source";
import { PublicationId } from "@ryot-app/contract/schema/brands";
import {
	createRyotHostMutation,
	createRyotHostQuery,
	createRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { pageRecipe, pagesRecipe } from "@ryot-app/ryotql-recipes/pages";
import {
	publicationSourceArguments,
	publicationsRecipe,
	type PublicationsResult,
	type PublicationSummary,
	sourcePublicationsRecipe,
} from "@ryot-app/ryotql-recipes/publications";
import {
	type SavedViewRecord,
	savedViewRecordRecipe,
	savedViewReferenceArguments,
} from "@ryot-app/ryotql-recipes/saved-view-records";
import { Effect, Schema } from "effect";

import type { AuthenticatedApiError } from "#/api/authenticated";
import { PublicationsApi } from "#/api/publications";
import { KernelHostServices } from "#/host-services";

export const PUBLICATIONS_PAGE_SIZE = 20;

class PublicationsLoadError extends Schema.TaggedError<
	PublicationsLoadError,
	{ readonly brand: unique symbol }
>()("PublicationsLoadError", { cause: Schema.Unknown }) {}

export const publicationsQuery = createRyotQuery<
	{ readonly limit: number; readonly after?: string | undefined },
	PublicationsResult,
	PublicationsLoadError
>(
	({ input, client }) =>
		client.data
			.query(
				publicationsRecipe,
				{},
				{ pages: { publications: { limit: input.limit, after: input.after } } },
			)
			.pipe(Effect.mapError((cause) => new PublicationsLoadError({ cause }))),
	{ cancelOnUnmount: true },
);

export const sourcePublicationsQuery = createRyotQuery<
	EntitySourceReference,
	readonly PublicationSummary[],
	PublicationsLoadError
>(
	({ input, client }) =>
		client.data
			.query(sourcePublicationsRecipe, publicationSourceArguments(input), {})
			.pipe(Effect.mapError((cause) => new PublicationsLoadError({ cause }))),
	{ cancelOnUnmount: true },
);

export const COLLECTION_PUBLICATION_ICON = "library";

export const publicationSavedViewQuery = createRyotQuery<
	SavedViewReference,
	null | SavedViewRecord,
	PublicationsLoadError
>(({ input, client }) =>
	client.data
		.query(savedViewRecordRecipe, savedViewReferenceArguments(input))
		.pipe(
			Effect.mapBoth({
				onSuccess: (view) => view ?? null,
				onFailure: (cause) => new PublicationsLoadError({ cause }),
			}),
		),
);

export const publicationStatusQuery = createRyotHostQuery<
	string,
	PublicationStatusResponse,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, hostServices }) =>
		hostServices.runtime
			.runSync(PublicationsApi)
			.status(hostServices.scope, { payload: { publicationId: PublicationId.make(input) } }),
	{ cancelOnUnmount: true, hostServices: KernelHostServices },
);

export const publicationPagesQuery = createRyotQuery(pagesRecipe);
export const publicationPageQuery = createRyotQuery(pageRecipe);

export type PublicationCommand =
	| { readonly action: "delete"; readonly request: ContractRequest<"publications", "delete"> }
	| { readonly action: "revoke"; readonly request: ContractRequest<"publications", "revoke"> }
	| { readonly action: "republish"; readonly request: ContractRequest<"publications", "republish"> }
	| {
			readonly action: "revokeLink";
			readonly request: ContractRequest<"publications", "revokeLink">;
	  };

export const publicationCommandMutation = createRyotHostMutation<
	PublicationCommand,
	unknown,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) => {
		const api = hostServices.runtime.runSync(PublicationsApi);
		let command: Effect.Effect<unknown, AuthenticatedApiError>;
		switch (input.action) {
			case "delete":
				command = api.delete(hostServices.scope, input.request);
				break;
			case "revoke":
				command = api.revoke(hostServices.scope, input.request);
				break;
			case "republish":
				command = api.republish(hostServices.scope, input.request);
				break;
			case "revokeLink":
				command = api.revokeLink(hostServices.scope, input.request);
				break;
		}
		return command.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint)));
	},
	{ hostServices: KernelHostServices },
);

export const createPublicationMutation = createRyotHostMutation<
	ContractRequest<"publications", "create">["payload"],
	{ readonly revision: number; readonly publicationId: string },
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(PublicationsApi)
			.create(hostServices.scope, { payload: input })
			.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
	{ hostServices: KernelHostServices },
);

export const createPublicationLinkMutation = createRyotHostMutation<
	ContractRequest<"publications", "createLink">["payload"],
	{ readonly linkId: string; readonly secret: string },
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(PublicationsApi)
			.createLink(hostServices.scope, { payload: input })
			.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
	{ hostServices: KernelHostServices },
);

export const previewPublicationMutation = createRyotHostMutation<
	ContractRequest<"publications", "preview">["payload"],
	{ readonly expiresAt: string; readonly sessionToken: string },
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, hostServices }) =>
		hostServices.runtime.runSync(PublicationsApi).preview(hostServices.scope, { payload: input }),
	{ hostServices: KernelHostServices },
);
