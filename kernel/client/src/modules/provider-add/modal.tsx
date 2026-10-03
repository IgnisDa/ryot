import { useRyot } from "@ryot-app/client-sdk/react";
import { Modal } from "@ryot-app/client-ui-sdk";
import type { EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { useRouteContext } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useEffectEvent, useRef, useState, type ComponentProps } from "react";

import { importProviderEntity } from "#/modules/provider-add/import-controller";
import {
	type ProviderAddOutcome,
	type ProviderEntityLinks,
	ProviderSearchPanel,
	type ProviderSummariesState,
	resolveLibraryMembership,
} from "#/modules/provider-add/panel";
import { ProviderAddService, type ProviderSearchSummary } from "#/modules/provider-add/service";
import { useSchemaFileUpload } from "#/modules/ui/schema-form-upload";
import { ClientStorage } from "#/persistence/storage";

export const PROVIDER_ADD_TITLE = "Add from a provider";

type ProviderAddModalProps = {
	readonly onClose: () => void;
	readonly initialQuery?: string | undefined;
	readonly ownerPluginId?: string | undefined;
	readonly entitySchemaSlug: EntitySchemaSlug;
};

type ProviderAddModalState = {
	readonly providers: ProviderSummariesState;
	readonly selectedProviderId: SandboxProviderId | undefined;
};

const loadedProviderState = (
	remembered: SandboxProviderId | null,
	result: ProviderAddOutcome<{ readonly items: readonly ProviderSearchSummary[] }>,
): ProviderAddModalState => ({
	selectedProviderId: remembered ?? undefined,
	providers:
		"value" in result ? { status: "ready", providers: result.value.items } : { status: "failed" },
});

export function ProviderAddModal(props: ProviderAddModalProps) {
	const ryot = useRyot();
	const uploadFile = useSchemaFileUpload();
	const { scope, runtime } = useRouteContext({ from: "/_authenticated" });
	const { entitySchemaSlug } = props;
	const providerService = runtime.runSync(ProviderAddService);
	const clientStorage = runtime.runSync(ClientStorage);
	const libraryMembership = resolveLibraryMembership(props.ownerPluginId, entitySchemaSlug);
	const imported = useRef(false);
	const [state, setState] = useState<ProviderAddModalState>({
		selectedProviderId: undefined,
		providers: { status: "loading" },
	});

	const loadProviderState = useEffectEvent(
		(schemaSlug: EntitySchemaSlug, ownerPluginId: string | undefined, isActive: () => boolean) =>
			runtime.runPromise(
				Effect.gen(function* () {
					const [remembered, result] = yield* Effect.all(
						[
							clientStorage.getRememberedProvider(scope, schemaSlug),
							providerService
								.loadProviders(ryot, schemaSlug, ownerPluginId)
								.pipe(
									Effect.match({
										onFailure: (
											cause,
										): ProviderAddOutcome<{
											readonly items: readonly ProviderSearchSummary[];
										}> => ({ cause }),
										onSuccess: (
											value,
										): ProviderAddOutcome<{
											readonly items: readonly ProviderSearchSummary[];
										}> => ({ value }),
									}),
								),
						],
						{ concurrency: "unbounded" },
					);
					if (isActive()) {
						setState(loadedProviderState(remembered, result));
					}
				}),
			),
	);

	useEffect(
		() => () => {
			if (imported.current) {
				ryot.mutationCompleted.hint();
			}
		},
		[ryot],
	);

	useEffect(() => {
		let active = true;
		void loadProviderState(entitySchemaSlug, props.ownerPluginId, () => active);
		return () => {
			active = false;
		};
	}, [entitySchemaSlug, props.ownerPluginId]);

	const selectProvider = (providerId: SandboxProviderId) => {
		setState((current) => ({ ...current, selectedProviderId: providerId }));
		void runtime.runPromise(
			Effect.flatMap(ClientStorage, (storage) =>
				storage.setRememberedProvider(scope, entitySchemaSlug, providerId),
			),
		);
	};

	const search: ComponentProps<typeof ProviderSearchPanel>["search"] = (payload) =>
		providerService.search(scope, payload);
	const loadSearchOptions: ComponentProps<typeof ProviderSearchPanel>["loadSearchOptions"] = (
		providerId,
	) => providerService.loadSearchOptions(scope, providerId);
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
		providerService
			.loadEntityLinks(ryot, input)
			.pipe(
				Effect.map(
					(links): ProviderEntityLinks =>
						new Map(links.map((link) => [link.externalId, link.entityId])),
				),
			);

	return (
		<Modal
			closeLabel="Close"
			onClose={props.onClose}
			label={PROVIDER_ADD_TITLE}
			containerClassName="md:items-center md:justify-center md:p-6"
			className="flex w-full flex-1 flex-col overflow-hidden bg-bg pt-[env(safe-area-inset-top)] md:max-h-[85%] md:max-w-2xl md:flex-initial md:rounded-xl md:border md:border-border md:bg-surface md:shadow-card md:pt-0"
		>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="p-4">
					<ProviderSearchPanel
						search={search}
						uploadFile={uploadFile}
						onClose={props.onClose}
						providers={state.providers}
						importEntity={importEntity}
						onSelectProvider={selectProvider}
						initialQuery={props.initialQuery}
						loadEntityLinks={loadEntityLinks}
						entitySchemaSlug={entitySchemaSlug}
						loadSearchOptions={loadSearchOptions}
						selectedProviderId={state.selectedProviderId}
						relationshipSlug={libraryMembership.relationshipSlug}
						librarySchemaSlug={libraryMembership.librarySchemaSlug}
						onImported={() => {
							imported.current = true;
						}}
					/>
				</div>
			</div>
		</Modal>
	);
}
