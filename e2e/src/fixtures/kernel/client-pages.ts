import type { ContractRequest, ContractSuccess } from "@ryot-app/contract/client";
import { Encoding } from "effect";

import type { Client } from "./auth";

type CreateSavedViewRequest = ContractRequest<"savedViews", "create">;
type PrepareClientPageRequest = ContractRequest<"clientPages", "prepare">;
type CreateRendererRequest = ContractRequest<"clientPages", "createRenderer">;
type PublishRendererRequest = ContractRequest<"clientPages", "publishRenderer">;
type CreateClientPageSessionRequest = ContractRequest<"clientPages", "createSession">;
type ReplaceRendererDraftRequest = ContractRequest<"clientPages", "replaceRendererDraft">;

type CreateRendererPayload = CreateRendererRequest["payload"];
type RendererId = ContractSuccess<"clientPages", "getRenderer">["id"];
export type ClientRendererDefinition = CreateRendererRequest["payload"]["draftDefinition"];
type RendererSavedViewPayload = Extract<CreateSavedViewRequest["payload"], { renderer: unknown }>;
type CustomRendererId = Extract<
	RendererSavedViewPayload["renderer"],
	{ kind: "custom" }
>["rendererId"];

export const clientRendererSource = `
import { usePageContext } from "@ryot-app/client-sdk/plugin";

export default function Page() {
  const { settings } = usePageContext();
  return (
    <section>
      <h1>Task 01 composed page</h1>
      <p>Renderer setting: {String(settings.label ?? "")}</p>
    </section>
  );
}
`;

export const clientRendererSettingsSchema = {
	unknownKeys: "strict",
	fields: {
		label: { type: "string", label: "Label", description: "Text displayed by the renderer" },
	},
} satisfies ClientRendererDefinition["settingsSchema"];

export const encodeClientRendererSource = (source: string) =>
	Encoding.encodeBase64(new TextEncoder().encode(source));

export const buildClientRendererDefinition = (
	overrides: Partial<ClientRendererDefinition> = {},
): ClientRendererDefinition => ({
	pluginDependencies: [],
	entry: "client/page.tsx",
	automaticEntityPresentations: false,
	settingsSchema: clientRendererSettingsSchema,
	files: [{ path: "client/page.tsx", content: encodeClientRendererSource(clientRendererSource) }],
	...overrides,
});

export const createClientRenderer = (
	client: Client,
	overrides: Partial<CreateRendererPayload> = {},
) =>
	client.call((contract) =>
		contract.clientPages.createRenderer({
			payload: {
				slug: `renderer-${crypto.randomUUID()}`,
				name: `Renderer ${crypto.randomUUID()}`,
				draftDefinition: buildClientRendererDefinition(),
				...overrides,
			},
		}),
	);

export const listClientRenderers = (client: Client) =>
	client.call((contract) => contract.clientPages.listRenderers());

export const getClientRenderer = (client: Client, rendererId: RendererId) =>
	client.call((contract) => contract.clientPages.getRenderer({ params: { rendererId } }));

export const replaceClientRendererDraft = (
	client: Client,
	rendererId: ReplaceRendererDraftRequest["params"]["rendererId"],
	payload: ReplaceRendererDraftRequest["payload"],
) =>
	client.call((contract) =>
		contract.clientPages.replaceRendererDraft({ params: { rendererId }, payload }),
	);

export const publishClientRenderer = (
	client: Client,
	rendererId: PublishRendererRequest["params"]["rendererId"],
	expectedDraftRevision: PublishRendererRequest["payload"]["expectedDraftRevision"],
) =>
	client.call((contract) =>
		contract.clientPages.publishRenderer({
			params: { rendererId },
			payload: { expectedDraftRevision },
		}),
	);

export const deleteClientRenderer = (client: Client, rendererId: RendererId) =>
	client.call((contract) => contract.clientPages.deleteRenderer({ params: { rendererId } }));

export const prepareClientPage = (
	client: Client,
	savedViewId: PrepareClientPageRequest["payload"]["target"]["savedViewId"],
) =>
	client.call((contract) =>
		contract.clientPages.prepare({ payload: { target: { kind: "saved-view", savedViewId } } }),
	);

export const createClientPageSession = (
	client: Client,
	identity: CreateClientPageSessionRequest["payload"]["identity"],
) => client.call((contract) => contract.clientPages.createSession({ payload: { identity } }));

export const renewClientPageSession = (client: Client, sessionId: string) =>
	client.call((contract) => contract.clientPages.renewSession({ params: { sessionId } }));

export const revokeClientPageSession = (client: Client, sessionId: string) =>
	client.call((contract) => contract.clientPages.revokeSession({ params: { sessionId } }));

export const buildRendererSavedViewPayload = (
	rendererId: CustomRendererId,
	settings: RendererSavedViewPayload["settings"],
	overrides: Partial<Omit<RendererSavedViewPayload, "renderer" | "settings">> = {},
): RendererSavedViewPayload => ({
	settings,
	dataSources: null,
	icon: "layout-dashboard",
	renderer: { kind: "custom", rendererId },
	name: `Renderer view ${crypto.randomUUID()}`,
	...overrides,
});

export const createRendererSavedView = (
	client: Client,
	rendererId: Parameters<typeof buildRendererSavedViewPayload>[0],
	settings: RendererSavedViewPayload["settings"],
	overrides: Parameters<typeof buildRendererSavedViewPayload>[2] = {},
) =>
	client.call((contract) =>
		contract.savedViews.create({
			payload: buildRendererSavedViewPayload(rendererId, settings, overrides),
		}),
	);
