import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	formatError,
	renderSchemaAsset,
	useRyotMutation,
	useRyotQuery,
	useSchemaAssetUpload,
	validationIssuesOf,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, DestructiveConfirmation, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import {
	initialSchemaFormValues,
	SchemaForm,
	type SchemaFormValues,
	toSchemaFormPayload,
	useSchemaForm,
} from "@ryot-app/plugin-ui-sdk/schema-form";
import type { PluginUserSettingsPage } from "@ryot-app/ryotql-recipes/plugin-user-settings";
import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { Effect } from "effect";
import { type ReactNode, useRef, useState } from "react";

import { AuthService } from "#/modules/auth/service";
import { DemoProtectionMessage, useIsDemoSession } from "#/modules/demo-protection";
import {
	pluginUserSettingQuery,
	resetPluginUserSettingsMutation,
	savePluginUserSettingsMutation,
} from "#/modules/settings/plugin-preferences-service";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { schemaFormReorderFeedback } from "#/modules/ui/schema-form-feedback";
import { schemaFormIcons } from "#/modules/ui/schema-form-icons";
import { useSchemaFileUpload } from "#/modules/ui/schema-form-upload";
import { useFormSeed } from "#/modules/ui/use-form-seed";

type PluginUserSetting = PluginUserSettingsPage["items"][number];
type EditorStatus = "saved" | "reset" | "save-failed" | "reset-failed";

const initialPluginUserSettingsFormValues = (setting: PluginUserSetting): SchemaFormValues =>
	initialSchemaFormValues(setting.settingsSchema, undefined, setting.settings);

export const Route = createFileRoute("/_authenticated/settings/plugin-preferences/$installationId")(
	{ component: PluginUserSettingsRoute },
);

function PluginUserSettingsRoute() {
	const t = useT();
	const { installationId } = Route.useParams();
	const { server, runtime } = Route.useRouteContext();
	const isDemo = useIsDemoSession(runtime.runSync(AuthService).session(server));
	const setting = useRyotQuery(pluginUserSettingQuery, { installationId });
	let content = (
		<StatusMessage tone="pending">
			{t(kernelMessage("client.route.settings.plugin-preferences.loading"))}
		</StatusMessage>
	);
	if (setting.data !== undefined) {
		content = <PluginUserSettingsEditor disabled={isDemo} setting={setting.data} />;
	} else if (setting.isError) {
		content = (
			<StatusMessage tone="error">
				{t(kernelMessage("client.route.settings.plugin-preferences.load-failed"))}
			</StatusMessage>
		);
	} else if (!setting.isPending) {
		content = (
			<p role="status" className="text-sm text-text-muted">
				{t(kernelMessage("client.route.settings.plugin-preferences.not-found"))}
			</p>
		);
	}

	return (
		<SettingsFrame
			backFallbackHref="/settings/plugin-preferences"
			title={
				setting.data === undefined
					? t(kernelMessage("client.settings.section.plugin-preferences"))
					: t(setting.data.name)
			}
		>
			{content}
		</SettingsFrame>
	);
}

function PluginUserSettingsEditor(props: {
	readonly disabled: boolean;
	readonly setting: PluginUserSetting;
}) {
	const t = useT();
	const uploadFile = useSchemaFileUpload();
	const uploadAsset = useSchemaAssetUpload();
	const save = useRyotMutation(savePluginUserSettingsMutation);
	const reset = useRyotMutation(resetPluginUserSettingsMutation);
	const [status, setStatus] = useState<EditorStatus>();
	const confirmationTrigger = useRef<HTMLButtonElement>(null);
	const saveSettings = (values: SchemaFormValues) =>
		Effect.runPromise(
			save
				.mutateEffect({
					installationId: props.setting.id,
					payload: toSchemaFormPayload(
						props.setting.settingsSchema,
						values,
						"edit",
						initialPluginUserSettingsFormValues(props.setting),
					),
				})
				.pipe(
					Effect.tap(() => Effect.sync(() => setStatus("saved"))),
					Effect.catchCause(() => Effect.sync(() => setStatus("save-failed"))),
					Effect.asVoid,
				),
		);

	const resetSettings = () =>
		Effect.runPromise(
			reset.mutateEffect(props.setting.id).pipe(
				Effect.tap(() => Effect.sync(() => setStatus("reset"))),
				Effect.catchCause(() => Effect.sync(() => setStatus("reset-failed"))),
				Effect.asVoid,
			),
		);
	const form = useSchemaForm({
		mode: "edit",
		schemas: [props.setting.settingsSchema],
		onSubmit: (values) => void saveSettings(values),
	});
	useFormSeed(form, `${props.setting.id}:${props.setting.updatedAt}`, () =>
		initialPluginUserSettingsFormValues(props.setting),
	);
	const blocker = useBlocker({ withResolver: true, shouldBlockFn: () => form.state.isDirty });

	const pending = save.isPending || reset.isPending;
	let statusMessage: ReactNode;
	if (status === "saved") {
		statusMessage = (
			<StatusMessage tone="success">
				{t(kernelMessage("client.route.settings.plugin-preferences.save-succeeded"))}
			</StatusMessage>
		);
	} else if (status === "save-failed") {
		statusMessage = (
			<StatusMessage tone="error">
				{formatError(
					t,
					save.error,
					kernelMessage("client.route.settings.plugin-preferences.save-failed"),
				)}
			</StatusMessage>
		);
	} else if (status === "reset") {
		statusMessage = (
			<StatusMessage tone="success">
				{t(kernelMessage("client.route.settings.plugin-preferences.reset-succeeded"))}
			</StatusMessage>
		);
	} else if (status === "reset-failed") {
		statusMessage = (
			<StatusMessage tone="error">
				{formatError(
					t,
					reset.error,
					kernelMessage("client.route.settings.plugin-preferences.reset-failed"),
				)}
			</StatusMessage>
		);
	}

	return (
		<>
			<div className="flex flex-col gap-4">
				{props.disabled && <DemoProtectionMessage />}
				<form
					noValidate
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<fieldset disabled={props.disabled || pending}>
						<SchemaForm
							mode="edit"
							form={form}
							icons={schemaFormIcons}
							uploadFile={uploadFile}
							uploadAsset={uploadAsset}
							renderAsset={renderSchemaAsset}
							onChange={() => setStatus(undefined)}
							onReorder={schemaFormReorderFeedback}
							schema={props.setting.settingsSchema}
							validationIssues={status === "save-failed" ? validationIssuesOf(save.error) : []}
						/>
					</fieldset>
					<div className="flex flex-col items-end gap-2">
						{statusMessage}
						<form.Subscribe selector={(state) => state.isDirty}>
							{(isDirty) => (
								<div className="flex flex-wrap justify-end gap-2">
									<Button
										type="button"
										variant="secondary"
										disabled={props.disabled || pending}
										onClick={() => void resetSettings()}
									>
										{reset.isPending
											? t(kernelMessage("client.route.settings.plugin-preferences.resetting"))
											: t(kernelMessage("client.route.settings.plugin-preferences.reset-action"))}
									</Button>
									<Button
										type="submit"
										variant="primary"
										className="min-w-32"
										ref={confirmationTrigger}
										disabled={props.disabled || pending || !isDirty}
									>
										{save.isPending
											? t(kernelMessage("common.status.saving"))
											: t(kernelMessage("common.action.save-changes"))}
									</Button>
								</div>
							)}
						</form.Subscribe>
					</div>
				</form>
			</div>
			{blocker.status === "blocked" && (
				<DestructiveConfirmation
					pending={false}
					onClose={blocker.reset}
					errorMessage={undefined}
					onConfirm={blocker.proceed}
					triggerRef={confirmationTrigger}
					title={t(kernelMessage("client.route.settings.plugin-preferences.discard-title"))}
					detail={t(kernelMessage("client.route.settings.plugin-preferences.discard-detail"))}
					pendingLabel={t(kernelMessage("client.route.settings.plugin-preferences.discarding"))}
					actionLabel={t(kernelMessage("client.route.settings.plugin-preferences.discard-action"))}
				/>
			)}
		</>
	);
}
