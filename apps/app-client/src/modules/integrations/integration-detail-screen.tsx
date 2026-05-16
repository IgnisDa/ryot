import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { IntegrationId } from "@ryot/contract/schema/brands";
import { Exit } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { router } from "expo-router";
import { useEffect, useEffectEvent, useState } from "react";
import { Text, View } from "react-native";

import { temporaryFileUploadOperation } from "@/api/files/upload";
import { requestFailureMessage } from "@/api/request-failure";
import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { ChildScreenFrame } from "@/modules/navigation/child-screen-frame";
import type { HeaderOverflowItem } from "@/modules/navigation/header/header-overflow-menu";
import { copyTextToClipboard } from "@/modules/ui/clipboard";
import { DestructiveActionSheet } from "@/modules/ui/destructive-action-sheet";
import { isTerminalRunStatus } from "@/modules/ui/run/run-status";
import { RUN_LIST_POLL_MS, useRunPolling } from "@/modules/ui/run/use-run-polling";
import { useSchemaForm } from "@/modules/ui/schema-form/schema-form";
import type { SchemaFormValues } from "@/modules/ui/schema-form/schema-form-state";

import {
	INTEGRATION_RUNS_PAGE_SIZE,
	deleteIntegrationAtom,
	integrationDetailAtom,
	integrationProvidersAtom,
	integrationReactivityKeys,
	integrationRunsAtom,
	updateIntegrationAtom,
} from "./atoms";
import { integrationSaveFailure } from "./create-failure";
import { IntegrationDetailView } from "./integration-detail-view";
import { updateIntegrationBody, storedIntegrationFormValues } from "./integration-payload";
import { integrationDeleteConfirmation, integrationTitle } from "./integration-presentation";
import { findOwnedIntegrationProvider, integrationLotLabel } from "./provider-selection";
import {
	mapIntegrationDetail,
	mapIntegrationProviderList,
	mapIntegrationProviderNames,
	mapIntegrationRunList,
} from "./state";

const returnToList = () => {
	if (router.canGoBack()) {
		router.back();
		return;
	}
	router.replace("/settings/integrations");
};

export function IntegrationDetailScreen(props: { integrationId: string }) {
	const scope = useApiScope();
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [isConfirming, setIsConfirming] = useState(false);
	const [saveCause, setSaveCause] = useState<unknown>();
	const [deleteFailure, setDeleteFailure] = useState<unknown>();
	const [saveDetail, setSaveDetail] = useState<string | undefined>();
	const detail = integrationDetailAtom({ scope, id: props.integrationId });
	const result = useAtomValue(detail);
	const refresh = useAtomRefresh(detail);
	const providers = useAtomValue(integrationProvidersAtom(scope));
	const runsAtom = integrationRunsAtom({
		scope,
		limit: INTEGRATION_RUNS_PAGE_SIZE,
		integrationId: props.integrationId,
	});
	const runsResult = useAtomValue(runsAtom);
	const refreshRuns = useAtomRefresh(runsAtom);
	const updateIntegration = useAtomSet(updateIntegrationAtom(scope), { mode: "promiseExit" });
	const deleteIntegration = useAtomSet(deleteIntegrationAtom(scope), { mode: "promiseExit" });
	const state = mapIntegrationDetail(result);
	const integration = state.status === "ready" ? state.integration : undefined;
	const listed = mapIntegrationProviderList(providers);
	const provider = findOwnedIntegrationProvider(
		listed.status === "ready" ? listed.providers : [],
		integration,
	);
	const runsState = mapIntegrationRunList(runsResult);
	const runs = runsState.status === "ready" ? runsState.runs : [];
	const uploadFile = temporaryFileUploadOperation(scope);
	const providerNames = mapIntegrationProviderNames(providers);

	useInternalRequestFailureLogging(
		"integration detail query failed",
		AsyncResult.isFailure(result) ? result.cause : undefined,
	);
	useInternalRequestFailureLogging("integration update failed", saveCause);
	useInternalRequestFailureLogging("integration delete failed", deleteFailure);
	useRunPolling({
		refresh: refreshRuns,
		intervalMs: RUN_LIST_POLL_MS,
		enabled: runs.some((run) => !isTerminalRunStatus(run.status)),
	});

	const save = useEffectEvent(async (values: SchemaFormValues) => {
		if (provider === undefined) {
			return;
		}
		setSaving(true);
		setSaveDetail(undefined);
		setSaveCause(undefined);
		const exit = await updateIntegration({
			payload: updateIntegrationBody({ provider, values }),
			reactivityKeys: integrationReactivityKeys(scope),
			params: { integrationId: IntegrationId.make(props.integrationId) },
		});
		setSaving(false);
		if (Exit.isFailure(exit)) {
			setSaveCause(exit.cause);
			setSaveDetail(integrationSaveFailure(requestFailureMessage(exit.cause)).detail);
		}
	});

	const form = useSchemaForm({
		mode: "edit",
		onSubmit: (values) => void save(values),
		schemas: [provider?.commonSchema, provider?.settingsSchema],
	});

	const seedForm = useEffectEvent(() => {
		form.reset(
			provider === undefined || integration === undefined
				? {}
				: storedIntegrationFormValues({ provider, integration }),
		);
	});

	useEffect(() => {
		seedForm();
	}, [integration?.id, provider?.slug, integration?.updatedAt]);

	async function confirmDelete() {
		if (deleting) {
			return;
		}
		setDeleting(true);
		setDeleteFailure(undefined);
		const exit = await deleteIntegration({
			reactivityKeys: integrationReactivityKeys(scope),
			params: { integrationId: IntegrationId.make(props.integrationId) },
		});
		setDeleting(false);
		if (Exit.isFailure(exit)) {
			setDeleteFailure(exit.cause);
			return;
		}
		setIsConfirming(false);
		returnToList();
	}

	const overflowItems: readonly HeaderOverflowItem[] | undefined =
		integration === undefined
			? undefined
			: [
					{
						isDestructive: true,
						label: "Delete integration",
						onPress: () => setIsConfirming(true),
					},
				];

	return (
		<ChildScreenFrame
			overflowItems={overflowItems}
			title={
				integration === undefined ? "Integration" : integrationTitle(integration, providerNames)
			}
			meta={
				integration === undefined ? undefined : (
					<Text className="font-ui text-xs text-text-subtle">
						{`${integrationLotLabel(integration.lot)} · ${integration.isDisabled ? "Paused" : "Active"}`}
					</Text>
				)
			}
			overlay={
				isConfirming && integration !== undefined ? (
					<DestructiveActionSheet
						snapPoints={[300]}
						pending={deleting}
						pendingLabel="Deleting..."
						actionLabel="Delete integration"
						title="Delete this integration?"
						detail={integrationDeleteConfirmation(integration, providerNames)}
						errorMessage={
							deleteFailure === undefined
								? undefined
								: "This integration could not be deleted. Try again."
						}
						onConfirm={() => void confirmDelete()}
						onClose={() => {
							setDeleteFailure(undefined);
							setIsConfirming(false);
						}}
					/>
				) : undefined
			}
		>
			<View className="w-full max-w-2xl self-center">
				<IntegrationDetailView
					runs={runs}
					form={form}
					state={state}
					saving={saving}
					onRetry={refresh}
					nowMs={Date.now()}
					provider={provider}
					saveDetail={saveDetail}
					uploadFile={uploadFile}
					onCopy={copyTextToClipboard}
					onSave={() => void form.handleSubmit()}
				/>
			</View>
		</ChildScreenFrame>
	);
}
