import {
	renderSchemaAsset,
	useRyotMutation,
	useRyotQuery,
	useSchemaAssetUpload,
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
import { type ReactNode, useEffect, useRef, useState } from "react";

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
type EditorStatus = "saved" | "save-failed" | "reset" | "reset-failed";

const initialPluginUserSettingsFormValues = (setting: PluginUserSetting): SchemaFormValues =>
	initialSchemaFormValues(setting.settingsSchema, undefined, setting.settings);

export const Route = createFileRoute("/_authenticated/settings/plugin-preferences/$installationId")(
	{ component: PluginUserSettingsRoute },
);

function PluginUserSettingsRoute() {
	const { installationId } = Route.useParams();
	const { server, runtime } = Route.useRouteContext();
	const isDemo = useIsDemoSession(runtime.runSync(AuthService).session(server));
	const setting = useRyotQuery(pluginUserSettingQuery, { installationId });
	let content = <StatusMessage tone="pending">Loading plugin preferences...</StatusMessage>;
	if (setting.data !== undefined) {
		content = <PluginUserSettingsEditor disabled={isDemo} setting={setting.data} />;
	} else if (setting.isError) {
		content = (
			<StatusMessage tone="error">
				Could not load plugin preferences. Check the server and try again.
			</StatusMessage>
		);
	} else if (!setting.isPending) {
		content = (
			<p role="status" className="text-sm text-text-muted">
				Plugin preferences not found.
			</p>
		);
	}

	return (
		<SettingsFrame
			backFallbackHref="/settings/plugin-preferences"
			title={setting.data?.name ?? "Plugin preferences"}
		>
			{content}
		</SettingsFrame>
	);
}

function PluginUserSettingsEditor(props: {
	readonly setting: PluginUserSetting;
	readonly disabled: boolean;
}) {
	const { backInterceptors } = Route.useRouteContext();
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

	useEffect(() => {
		if (blocker.status !== "blocked") {
			return undefined;
		}
		return backInterceptors.register(() => {
			blocker.reset();
			return true;
		});
	}, [backInterceptors, blocker]);

	const pending = save.isPending || reset.isPending;
	let statusMessage: ReactNode;
	if (status === "saved") {
		statusMessage = <StatusMessage tone="success">Plugin settings saved.</StatusMessage>;
	} else if (status === "save-failed") {
		statusMessage = (
			<StatusMessage tone="error">Could not save plugin settings. Try again.</StatusMessage>
		);
	} else if (status === "reset") {
		statusMessage = (
			<StatusMessage tone="success">Plugin settings reset to defaults.</StatusMessage>
		);
	} else if (status === "reset-failed") {
		statusMessage = (
			<StatusMessage tone="error">Could not reset plugin settings. Try again.</StatusMessage>
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
										{reset.isPending ? "Resetting..." : "Reset to defaults"}
									</Button>
									<Button
										type="submit"
										variant="primary"
										className="min-w-32"
										ref={confirmationTrigger}
										disabled={props.disabled || pending || !isDirty}
									>
										{save.isPending ? "Saving..." : "Save changes"}
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
					pendingLabel="Discarding..."
					actionLabel="Discard changes"
					title="Discard unsaved changes?"
					triggerRef={confirmationTrigger}
					detail="Your changes will be lost if you leave this page."
				/>
			)}
		</>
	);
}
