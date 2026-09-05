import { useRyot } from "@ryot-app/client-sdk/react";
import { Modal } from "@ryot-app/client-ui-sdk";
import type { SchemaFileUpload } from "@ryot-app/client-ui-sdk/schema-form";
import type { EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { useRouteContext } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useEffectEvent, useState, type ComponentProps } from "react";

import { importProviderEntity } from "#/modules/provider-add/import-controller";
import {
	type ProviderAddOutcome,
	type ProviderEntityLinks,
	ProviderSearchPanel,
	type ProviderSummariesState,
	resolveLibraryMembership,
} from "#/modules/provider-add/panel";
import { ProviderAddService } from "#/modules/provider-add/service";
import { ClientStorage } from "#/persistence/storage";

export const PROVIDER_ADD_TITLE = "Add from a provider";

const UPLOAD_FAILURE_MESSAGE = "Could not upload this file. Try again.";

type ProviderAddModalProps = {
	readonly onClose: () => void;
	readonly onImported: () => void;
	readonly initialQuery?: string | undefined;
	readonly ownerPluginId?: string | undefined;
	readonly entitySchemaSlug: EntitySchemaSlug;
};

type ProviderAddModalState = {
	readonly providers: ProviderSummariesState;
	readonly selectedProviderId: SandboxProviderId | undefined;
};

export function ProviderAddModal(props: ProviderAddModalProps) {
	const ryot = useRyot();
	const { scope, runtime } = useRouteContext({ from: "/_authenticated" });
	const { entitySchemaSlug } = props;
	const libraryMembership = resolveLibraryMembership(props.ownerPluginId, entitySchemaSlug);
	const [state, setState] = useState<ProviderAddModalState>({
		selectedProviderId: undefined,
		providers: { status: "loading" },
	});

	const runOutcome = <A,>(effect: Effect.Effect<A, unknown, ProviderAddService>) =>
		runtime.runPromise(
			effect.pipe(
				Effect.match({
					onFailure: (cause): ProviderAddOutcome<A> => ({ cause }),
					onSuccess: (value): ProviderAddOutcome<A> => ({ value }),
				}),
			),
		);

	const loadProviderState = useEffectEvent(async (isActive: () => boolean) => {
		const [remembered, result] = await Promise.all([
			runtime.runPromise(
				Effect.flatMap(ClientStorage, (storage) =>
					storage.getRememberedProvider(scope, entitySchemaSlug),
				).pipe(Effect.catch(() => Effect.succeed(null))),
			),
			runOutcome(
				Effect.flatMap(ProviderAddService, (service) =>
					service.loadProviders(ryot, entitySchemaSlug, props.ownerPluginId),
				),
			),
		]);
		if (!isActive()) {
			return;
		}
		setState({
			selectedProviderId: remembered ?? undefined,
			providers:
				"value" in result
					? { status: "ready", providers: result.value.items }
					: { status: "failed" },
		});
	});

	useEffect(() => {
		let active = true;
		void loadProviderState(() => active);
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

	const uploadFile: SchemaFileUpload = async (request) => {
		try {
			const uploaded = await ryot.uploads.uploadTemporary(request);
			return { kind: "uploaded", token: uploaded.token };
		} catch {
			return { kind: "failed", message: UPLOAD_FAILURE_MESSAGE };
		}
	};
	const search: ComponentProps<typeof ProviderSearchPanel>["search"] = (payload) =>
		runOutcome(Effect.flatMap(ProviderAddService, (service) => service.search(scope, payload)));
	const loadSearchOptions: ComponentProps<typeof ProviderSearchPanel>["loadSearchOptions"] = (
		providerId,
	) =>
		runOutcome(
			Effect.flatMap(ProviderAddService, (service) => service.loadSearchOptions(scope, providerId)),
		);
	const importEntity: ComponentProps<typeof ProviderSearchPanel>["importEntity"] = ({
		externalId,
		onProgress,
		providerId,
	}) =>
		runtime.runPromise(
			Effect.flatMap(ProviderAddService, (service) =>
				importProviderEntity({
					onProgress,
					poll: (jobId) => service.pollImport(scope, jobId),
					start: service.startImport(scope, { externalId, providerId }),
				}),
			),
		);
	const loadEntityLinks: ComponentProps<typeof ProviderSearchPanel>["loadEntityLinks"] = (input) =>
		runOutcome(
			Effect.flatMap(ProviderAddService, (service) => service.loadEntityLinks(ryot, input)).pipe(
				Effect.map(
					(links): ProviderEntityLinks =>
						new Map(links.map((link) => [link.externalId, link.entityId])),
				),
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
						onImported={props.onImported}
						onSelectProvider={selectProvider}
						initialQuery={props.initialQuery}
						loadEntityLinks={loadEntityLinks}
						entitySchemaSlug={entitySchemaSlug}
						loadSearchOptions={loadSearchOptions}
						selectedProviderId={state.selectedProviderId}
						relationshipSlug={libraryMembership.relationshipSlug}
						librarySchemaSlug={libraryMembership.librarySchemaSlug}
					/>
				</div>
			</div>
		</Modal>
	);
}
