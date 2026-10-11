import type { ProviderLibraryMembership } from "@ryot-app/contract/modules/entity-providers/schemas";
import {
	definitionKey,
	type EntitySchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import type { EntityId, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import type { ProviderSearchScreenOutcome } from "@ryot-app/plugin-client-contract";
import { useRyot } from "@ryot-app/plugin-client-sdk/react";
import { Modal } from "@ryot-app/plugin-ui-sdk";
import { useRouteContext } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useEffectEvent, useRef, useState, type ComponentProps } from "react";

import { importProviderEntity } from "#/modules/provider-add/import-controller";
import {
	type ProviderAddOutcome,
	type ProviderEntityLinks,
	ProviderSearchPanel,
	type ProviderSummariesState,
} from "#/modules/provider-add/panel";
import { ProviderAddService, type ProviderSearchSummary } from "#/modules/provider-add/service";
import { useSchemaFileUpload } from "#/modules/ui/schema-form-upload";
import { ClientStorage } from "#/persistence/storage";

export const PROVIDER_ADD_TITLE = "Add from a provider";

type ProviderAddModalProps = {
	readonly onClose: () => void;
	readonly onComplete?: (outcome: ProviderSearchScreenOutcome) => void;
	readonly initialQuery?: string | undefined;
	readonly schema: EntitySchemaReference;
	readonly library: ProviderLibraryMembership;
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
	const entitySchemaSlug = props.schema.slug;
	const ownerPluginId =
		props.schema.owner.kind === "plugin" ? props.schema.owner.pluginId : undefined;
	const schemaKey = definitionKey("entity", props.schema.owner, entitySchemaSlug);
	const providerService = runtime.runSync(ProviderAddService);
	const clientStorage = runtime.runSync(ClientStorage);
	const imported = useRef(false);
	const completed = useRef(false);
	const [state, setState] = useState<ProviderAddModalState>({
		selectedProviderId: undefined,
		providers: { status: "loading" },
	});

	const loadProviderState = useEffectEvent(
		(schema: EntitySchemaReference, isActive: () => boolean) =>
			runtime.runPromise(
				Effect.gen(function* () {
					const [remembered, result] = yield* Effect.all(
						[
							clientStorage.getRememberedProvider(scope, schemaKey),
							providerService
								.loadProviders(ryot, schema)
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
	const complete = (outcome: ProviderSearchScreenOutcome) => {
		if (props.onComplete === undefined || completed.current) {
			return false;
		}
		completed.current = true;
		props.onComplete(outcome);
		return true;
	};
	const close = () => {
		if (!complete({ kind: "cancelled" })) {
			props.onClose();
		}
	};

	return (
		<Modal
			onClose={close}
			closeLabel="Close"
			label={PROVIDER_ADD_TITLE}
			containerClassName="md:items-center md:justify-center md:p-6"
			className="flex w-full flex-1 flex-col overflow-hidden bg-bg pt-[env(safe-area-inset-top)] md:max-h-[85%] md:max-w-2xl md:flex-initial md:rounded-xl md:border md:border-border md:bg-surface md:shadow-card md:pt-0"
		>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="p-4">
					<ProviderSearchPanel
						search={search}
						onClose={close}
						uploadFile={uploadFile}
						providers={state.providers}
						importEntity={importEntity}
						onSelectProvider={selectProvider}
						initialQuery={props.initialQuery}
						loadEntityLinks={loadEntityLinks}
						entitySchemaSlug={entitySchemaSlug}
						loadSearchOptions={loadSearchOptions}
						selectedProviderId={state.selectedProviderId}
						relationshipSlug={props.library.relationshipSlug}
						librarySchemaSlug={props.library.librarySchemaSlug}
						onImported={(entityId: EntityId) => {
							imported.current = true;
							complete({ kind: "added", entityIds: [entityId] });
						}}
					/>
				</div>
			</div>
		</Modal>
	);
}
