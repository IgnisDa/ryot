import { ACCOUNT_NAME_MAX_LENGTH } from "@ryot-app/contract/modules/account/schemas";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { formatError } from "@ryot-app/plugin-client-sdk/react";
import { Button, Field, StatusMessage, TextField } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { Cause, Effect } from "effect";
import { useState } from "react";

import type { SettledAuthSession } from "#/modules/auth/service";
import { SettingsSection } from "#/modules/settings/settings-section";
import { Avatar } from "#/modules/shell/avatar";

type AccountProfileProps = {
	readonly isDemo: boolean;
	readonly isLoading: boolean;
	readonly onRetry: () => void;
	readonly isGenerating: boolean;
	readonly onGenerateAvatar: () => void;
	readonly generationError: null | Error;
	readonly identity: undefined | SettledAuthSession;
	readonly onRename: (name: string) => Effect.Effect<void, Error>;
};

export function AccountProfile(props: AccountProfileProps) {
	const t = useT();
	if (props.identity === undefined) {
		return (
			<SettingsSection
				title={t(kernelMessage("client.settings.account.profile.title"))}
				detail={t(kernelMessage("client.settings.account.profile.detail"))}
			>
				{props.isLoading ? (
					<StatusMessage tone="pending">
						{t(kernelMessage("client.settings.account.profile.loading"))}
					</StatusMessage>
				) : (
					<div className="flex flex-col items-start gap-3">
						<StatusMessage tone="error">
							{t(kernelMessage("client.settings.account.profile.load-failed"))}
						</StatusMessage>
						<Button type="button" variant="secondary" onClick={props.onRetry}>
							{t(kernelMessage("common.action.try-again"))}
						</Button>
					</div>
				)}
			</SettingsSection>
		);
	}

	if (props.identity.status !== "authenticated") {
		return null;
	}
	const user = props.identity.user;

	return (
		<SettingsSection
			title={t(kernelMessage("client.settings.account.profile.title"))}
			detail={t(kernelMessage("client.settings.account.profile.detail"))}
		>
			<div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center">
					<div className="flex min-w-0 items-center gap-3 sm:flex-1">
						<Avatar name={user.name} image={user.image} className="size-16 text-base" />
						<div className="min-w-0 flex-1">
							<p className="truncate text-base font-semibold text-text">{user.name}</p>
							<p className="truncate text-sm text-text-muted">{user.email}</p>
							<p className="truncate text-xs text-text-subtle">
								{t(kernelMessage("client.settings.account.profile.id", { id: user.id }))}
							</p>
						</div>
					</div>
					<Button
						type="button"
						variant="secondary"
						disabled={props.isGenerating}
						onClick={props.onGenerateAvatar}
						className="flex items-center justify-center gap-2 self-start sm:self-auto"
					>
						<AppIcon size={15} name="rotate-ccw" className="text-text-muted" />
						{t(
							props.isGenerating
								? kernelMessage("client.settings.account.profile.generating")
								: kernelMessage("client.settings.account.profile.new-avatar"),
						)}
					</Button>
				</div>
				{!props.isDemo && (
					<AccountNameForm key={user.id} name={user.name} onRename={props.onRename} />
				)}
				{props.generationError !== null && (
					<StatusMessage tone="error" className="text-xs">
						{formatError(
							t,
							props.generationError,
							kernelMessage("client.settings.account.profile.avatar-failed"),
						)}
					</StatusMessage>
				)}
			</div>
		</SettingsSection>
	);
}

function AccountNameForm(props: {
	readonly name: string;
	readonly onRename: AccountProfileProps["onRename"];
}) {
	const t = useT();
	const [draft, setDraft] = useState(props.name);
	const [status, setStatus] = useState<"idle" | "saved" | "saving" | { readonly error: unknown }>(
		"idle",
	);
	const name = draft.trim();
	const invalid = name.length === 0 || name.length > ACCOUNT_NAME_MAX_LENGTH;
	const saving = status === "saving";
	const failure = typeof status === "object" ? status : undefined;
	const canSave = !invalid && !saving && (name !== props.name || failure !== undefined);

	return (
		<form
			className="mt-2 border-t border-border pt-5"
			onSubmit={(event) => {
				event.preventDefault();
				if (!canSave) {
					return;
				}
				setStatus("saving");
				void Effect.runPromise(
					props.onRename(name).pipe(
						Effect.matchCause({
							onFailure: (cause) => setStatus({ error: Cause.squash(cause) }),
							onSuccess: () => {
								setDraft(name);
								setStatus("saved");
							},
						}),
					),
				);
			}}
		>
			<div className="flex max-w-lg items-end gap-3">
				<Field
					className="min-w-0 flex-1"
					label={t(kernelMessage("client.settings.account.profile.name"))}
				>
					{(control) => (
						<TextField
							{...control}
							required
							name="name"
							value={draft}
							disabled={saving}
							className="w-full"
							autoComplete="name"
							maxLength={ACCOUNT_NAME_MAX_LENGTH}
							onChange={(event) => {
								setDraft(event.target.value);
								setStatus("idle");
							}}
						/>
					)}
				</Field>
				<Button type="submit" disabled={!canSave} className="shrink-0">
					{t(kernelMessage(saving ? "common.status.saving" : "common.action.save"))}
				</Button>
			</div>
			<div aria-live="polite" className="mt-2 min-h-5 text-xs text-text-muted">
				{failure !== undefined && (
					<StatusMessage tone="error">
						{formatError(
							t,
							failure.error,
							kernelMessage("client.settings.account.profile.save-failed"),
						)}
					</StatusMessage>
				)}
				{status === "saved" && (
					<span className="inline-flex items-center gap-1.5 text-success">
						<AppIcon size={14} name="check" />{" "}
						{t(kernelMessage("client.settings.account.profile.saved"))}
					</span>
				)}
				{(status === "idle" || saving) &&
					t(kernelMessage("client.settings.account.profile.name-hint"))}
			</div>
		</form>
	);
}
