import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotMutation, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useState } from "react";

import { PluginArchiveWizard } from "#/modules/plugins/management/archive-wizard";
import {
	type PluginManagementFeedback,
	PluginManagementPanel,
} from "#/modules/plugins/management/panel";
import {
	errorDetail,
	type ManagedPluginInstallation,
	type PluginManagementAction,
	pluginManagementMutation,
	pluginManagementQuery,
} from "#/modules/plugins/management/service";
import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/plugins")({
	component: PluginManagement,
});

const completedStatus: Record<PluginManagementAction["kind"], Message> = {
	state: kernelMessage("client.route.settings.plugins.completed-state"),
	package: kernelMessage("client.route.settings.plugins.completed-package"),
	install: kernelMessage("client.route.settings.plugins.completed-install"),
	uninstall: kernelMessage("client.route.settings.plugins.completed-uninstall"),
	configure: kernelMessage("client.route.settings.plugins.completed-configure"),
};

const feedbackTarget = (action: PluginManagementAction) =>
	action.kind === "install" || action.kind === "uninstall"
		? undefined
		: action.installation.installationId;

function PluginManagement() {
	const t = useT();
	const { backInterceptors } = Route.useRouteContext();
	const query = useRyotQuery(pluginManagementQuery, undefined);
	const mutation = useRyotMutation(pluginManagementMutation);
	const [feedback, setFeedback] = useState<PluginManagementFeedback>();
	const [archive, setArchive] = useState<{ readonly installation?: ManagedPluginInstallation }>();
	const isArchiveOpen = archive !== undefined;

	useEffect(() => {
		if (!isArchiveOpen) {
			return undefined;
		}
		return backInterceptors.register(() => {
			setArchive(undefined);
			return true;
		});
	}, [backInterceptors, isArchiveOpen]);

	const run = (action: PluginManagementAction) => {
		setFeedback(undefined);
		const installationId = feedbackTarget(action);
		void Effect.runPromise(
			mutation.mutateEffect(action).pipe(
				Effect.tap(() =>
					Effect.sync(() => {
						setArchive(undefined);
						setFeedback({
							installationId,
							tone: "success",
							message: t(completedStatus[action.kind]),
						});
						query.refetch();
					}),
				),
				Effect.catch((error) =>
					Effect.sync(() => {
						if (!isArchiveOpen) {
							setFeedback({ tone: "error", installationId, message: t(error.detail) });
						}
					}),
				),
			),
		);
	};

	const openArchive = (installation?: ManagedPluginInstallation) => {
		mutation.reset();
		setFeedback(undefined);
		setArchive(installation === undefined ? {} : { installation });
	};

	const content = (() => {
		if (query.status === "pending") {
			return (
				<p role="status" className="text-sm text-text-muted">
					{t(kernelMessage("client.route.settings.plugins.loading"))}
				</p>
			);
		}
		if (query.status === "error") {
			return (
				<p role="alert" className="text-sm text-danger">
					{errorDetail(t, query.error)}
				</p>
			);
		}
		return (
			<PluginManagementPanel
				onAction={run}
				feedback={feedback}
				onOpenArchive={openArchive}
				pending={mutation.isPending}
				installations={query.data ?? []}
			/>
		);
	})();
	return (
		<SettingsFrame
			backFallbackHref="/settings"
			title={t(kernelMessage("client.settings.section.plugins"))}
			actions={
				<Button
					variant="secondary"
					className="flex min-h-9 items-center gap-1.5 px-3 py-1.5 text-sm"
					onClick={() => {
						setFeedback(undefined);
						query.refetch();
					}}
				>
					<AppIcon size={14} name="rotate-ccw" className="text-text" />
					{t(kernelMessage("common.action.refresh"))}
				</Button>
			}
		>
			{content}
			{archive === undefined ? null : (
				<PluginArchiveWizard
					pending={mutation.isPending}
					installation={archive.installation}
					onClose={() => setArchive(undefined)}
					failureDetail={errorDetail(t, mutation.error)}
					onSubmit={(submission) =>
						run(
							archive.installation === undefined
								? { ...submission, kind: "install" }
								: { ...submission, kind: "package", installation: archive.installation },
						)
					}
				/>
			)}
		</SettingsFrame>
	);
}
