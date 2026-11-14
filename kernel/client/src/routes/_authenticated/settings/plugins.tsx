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

const completedStatus: Record<PluginManagementAction["kind"], string> = {
	package: "Package updated.",
	state: "Installation updated.",
	uninstall: "Plugin uninstalled.",
	configure: "Configuration saved.",
	install: "Plugin installed. It finishes setting up in the background.",
};

const feedbackTarget = (action: PluginManagementAction) =>
	action.kind === "install" || action.kind === "uninstall"
		? undefined
		: action.installation.installationId;

function PluginManagement() {
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
						setFeedback({ installationId, tone: "success", message: completedStatus[action.kind] });
						query.refetch();
					}),
				),
				Effect.catch((error) =>
					Effect.sync(() => {
						if (!isArchiveOpen) {
							setFeedback({ tone: "error", installationId, message: error.detail });
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
					Loading installations…
				</p>
			);
		}
		if (query.status === "error") {
			return (
				<p role="alert" className="text-sm text-danger">
					{errorDetail(query.error)}
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
			title="Plugins"
			backFallbackHref="/settings"
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
					Refresh
				</Button>
			}
		>
			{content}
			{archive === undefined ? null : (
				<PluginArchiveWizard
					pending={mutation.isPending}
					installation={archive.installation}
					onClose={() => setArchive(undefined)}
					failureDetail={errorDetail(mutation.error)}
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
