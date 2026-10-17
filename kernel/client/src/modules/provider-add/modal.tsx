import type { ProviderLibraryMembership } from "@ryot-app/contract/modules/entity-providers/schemas";
import {
	definitionKey,
	type EntitySchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import type { EntityId, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import type { PickEntityOutcome } from "@ryot-app/plugin-client-contract";
import {
	renderSchemaAsset,
	useRyot,
	useSchemaAssetUpload,
} from "@ryot-app/plugin-client-sdk/react";
import { Modal } from "@ryot-app/plugin-ui-sdk";
import type { EntityPickerSchema } from "@ryot-app/ryotql-recipes/entity-picker";
import { useRouteContext } from "@tanstack/react-router";
import { Effect } from "effect";
import { type ComponentProps, useEffect, useEffectEvent, useRef, useState } from "react";

import { toGlobalHref } from "#/modules/plugins/catalog/location";
import { usePluginCatalog } from "#/modules/plugins/catalog/provider";
import { importProviderEntity } from "#/modules/provider-add/import-controller";
import { InlineEntityCreate } from "#/modules/provider-add/inline-create";
import { providerSearchOptionsQuery } from "#/modules/provider-add/options-query";
import {
	type ProviderEntityLinks,
	ProviderSearchPanel,
	type ProviderSummariesState,
} from "#/modules/provider-add/panel";
import { EntityPickPanel } from "#/modules/provider-add/pick-panel";
import { ProviderAddService } from "#/modules/provider-add/service";
import { useSchemaFileUpload } from "#/modules/ui/schema-form-upload";
import { ClientStorage } from "#/persistence/storage";

export const PROVIDER_ADD_TITLE = "Add from a provider";

type EntityPickerModalProps = {
	readonly onClose: () => void;
	readonly onCreate: (href: string) => void;
	readonly onComplete?: (outcome: PickEntityOutcome) => void;
	readonly initialQuery?: string | undefined;
	readonly schema: EntitySchemaReference;
	readonly library?: ProviderLibraryMembership | undefined;
};

type EntityPickerModalState = {
	readonly providers: ProviderSummariesState;
	readonly selectedProviderId: SandboxProviderId | undefined;
};

type EntityPickerView =
	{ readonly kind: "browse" } | { readonly kind: "create"; readonly name: string };

export function EntityPickerModal(props: EntityPickerModalProps) {
	const uploadAsset = useSchemaAssetUpload();
	const ryot = useRyot();
	const uploadFile = useSchemaFileUpload();
	const { scope, runtime } = useRouteContext({ from: "/_authenticated" });
	const entitySchemaSlug = props.schema.slug;
	const ownerPluginId =
		props.schema.owner.kind === "plugin" ? props.schema.owner.pluginId : undefined;
	const { catalog } = usePluginCatalog();
	const owner = catalog.find(
		(entry) => entry.pluginId === ownerPluginId && entry.health !== "incompatible",
	);
	const createRoute = owner?.clientEntities?.[entitySchemaSlug]?.createRoute;
	const schemaKey = definitionKey("entity", props.schema.owner, entitySchemaSlug);
	const providerService = runtime.runSync(ProviderAddService);
	const clientStorage = runtime.runSync(ClientStorage);
	const changed = useRef(false);
	const completed = useRef(false);
	const [view, setView] = useState<EntityPickerView>({ kind: "browse" });
	const [definition, setDefinition] = useState<EntityPickerSchema>(null);
	const [state, setState] = useState<EntityPickerModalState>({
		selectedProviderId: undefined,
		providers: { status: "loading" },
	});

	const loadProviderState = useEffectEvent(
		(schema: EntitySchemaReference, isActive: () => boolean) =>
			runtime.runPromise(
				Effect.gen(function* () {
					const [remembered, result, loadedDefinition] = yield* Effect.all(
						[
							clientStorage.getRememberedProvider(scope, schemaKey),
							providerService
								.loadProviders(ryot, schema)
								.pipe(
									Effect.match({
										onFailure: (): ProviderSummariesState => ({ status: "failed" }),
										onSuccess: (value): ProviderSummariesState => ({
											status: "ready",
											providers: value.items,
										}),
									}),
								),
							providerService
								.loadSchema(ryot, schema)
								.pipe(Effect.orElseSucceed((): EntityPickerSchema => null)),
						],
						{ concurrency: "unbounded" },
					);
					if (isActive()) {
						setState({ providers: result, selectedProviderId: remembered ?? undefined });
						setDefinition(loadedDefinition);
					}
				}),
			),
	);

	useEffect(
		() => () => {
			if (changed.current) {
				ryot.mutationCompleted.hint();
			}
		},
		[ryot],
	);

	useEffect(() => {
		let active = true;
		void loadProviderState(props.schema, () => active);
		return () => {
			active = false;
		};
	}, [props.schema]);

	const selectProvider = (providerId: SandboxProviderId) => {
		setState((current) => ({ ...current, selectedProviderId: providerId }));
		void runtime.runPromise(
			Effect.flatMap(ClientStorage, (storage) =>
				storage.setRememberedProvider(scope, schemaKey, providerId),
			),
		);
	};

	const search: ComponentProps<typeof ProviderSearchPanel>["search"] = (payload) =>
		providerService.search(scope, payload);
	const importEntity: ComponentProps<typeof ProviderSearchPanel>["importEntity"] = ({
		externalId,
		onProgress,
		providerId,
	}) =>
		importProviderEntity({
			onProgress,
			poll: (jobId) => providerService.pollImport(scope, jobId),
			start: providerService.startImport(scope, { externalId, providerId }),
		});
	const loadEntityLinks: ComponentProps<typeof ProviderSearchPanel>["loadEntityLinks"] = (input) =>
		ownerPluginId === undefined
			? Effect.succeed(new Map())
			: providerService
					.loadEntityLinks(ryot, {
						...input,
						reference: { kind: "local", pluginId: ownerPluginId },
					})
					.pipe(
						Effect.map(
							(links): ProviderEntityLinks =>
								new Map(links.map((link) => [link.externalId, link.entityId])),
						),
					);
	const complete = (outcome: PickEntityOutcome) => {
		if (props.onComplete === undefined || completed.current) {
			return false;
		}
		completed.current = true;
		props.onComplete(outcome);
		return true;
	};
	const select = (entityId: EntityId) => {
		changed.current = true;
		complete({ kind: "selected", entityIds: [entityId] });
	};
	const createThroughRoute = (query: string) => {
		if (owner === undefined || createRoute === undefined) {
			return;
		}
		const href = toGlobalHref(
			{
				path: createRoute,
				kind: "plugin-route",
				packageId: owner.packageId,
				search: query === "" ? "" : new URLSearchParams({ name: query }).toString(),
			},
			catalog,
		);
		if (href === undefined) {
			return;
		}
		complete({ kind: "create-requested" });
		props.onCreate(href);
	};
	const createInline = definition?.editor
		? (query: string) => setView({ name: query, kind: "create" })
		: undefined;
	const create =
		createRoute === undefined || props.library === undefined ? createInline : createThroughRoute;
	const close = () => {
		if (!complete({ kind: "cancelled" })) {
			props.onClose();
		}
	};

	const renderContent = () => {
		if (view.kind === "create" && definition !== null) {
			return (
				<InlineEntityCreate
					schema={props.schema}
					definition={definition}
					uploadFile={uploadFile}
					initialName={view.name}
					uploadAsset={uploadAsset}
					renderAsset={renderSchemaAsset}
					onBack={() => setView({ kind: "browse" })}
					create={(request) => providerService.createEntity(scope, request)}
					onCreated={(entityId) => {
						setView({ kind: "browse" });
						select(entityId);
					}}
				/>
			);
		}
		if (props.library === undefined) {
			return (
				<EntityPickPanel
					search={search}
					onClose={close}
					onSelect={select}
					onCreate={create}
					importEntity={importEntity}
					providers={state.providers}
					initialQuery={props.initialQuery}
					onSelectProvider={selectProvider}
					selectedProviderId={state.selectedProviderId}
					loadEntities={(input) =>
						providerService.loadEntities(ryot, { ...input, schema: props.schema })
					}
					loadMaterialized={(input) =>
						providerService.loadMaterialized(ryot, { ...input, schema: props.schema })
					}
				/>
			);
		}
		return (
			<ProviderSearchPanel
				search={search}
				onClose={close}
				onImported={select}
				onCreateCustom={create}
				uploadFile={uploadFile}
				uploadAsset={uploadAsset}
				providers={state.providers}
				importEntity={importEntity}
				renderAsset={renderSchemaAsset}
				onSelectProvider={selectProvider}
				initialQuery={props.initialQuery}
				loadEntityLinks={loadEntityLinks}
				entitySchemaSlug={entitySchemaSlug}
				selectedProviderId={state.selectedProviderId}
				searchOptionsQuery={providerSearchOptionsQuery}
				relationshipSlug={props.library.relationshipSlug}
				librarySchemaSlug={props.library.librarySchemaSlug}
			/>
		);
	};

	return (
		<Modal
			onClose={close}
			closeLabel="Close"
			containerClassName="md:items-center md:justify-center md:p-6"
			label={
				props.library === undefined ? `Choose ${definition?.name ?? "an item"}` : PROVIDER_ADD_TITLE
			}
			className="flex w-full flex-1 flex-col overflow-hidden bg-bg pt-[env(safe-area-inset-top)] md:max-h-[85%] md:max-w-2xl md:flex-initial md:rounded-xl md:border md:border-border md:bg-surface md:shadow-card md:pt-0"
		>
			{renderContent()}
		</Modal>
	);
}
