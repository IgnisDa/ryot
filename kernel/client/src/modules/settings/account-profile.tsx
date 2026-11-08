import { ACCOUNT_NAME_MAX_LENGTH } from "@ryot-app/contract/modules/account/schemas";
import type { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Button, Field, StatusMessage, TextField } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { Effect } from "effect";
import { useState } from "react";

import type { SettledAuthSession } from "#/modules/auth/service";
import { SettingsSection } from "#/modules/settings/settings-section";
import { Avatar } from "#/modules/shell/avatar";

type AccountProfileProps = {
	readonly isDemo: boolean;
	readonly isLoading: boolean;
	readonly onRetry: () => void;
	readonly isGenerating: boolean;
	readonly generationFailed: boolean;
	readonly onGenerateAvatar: () => void;
	readonly identity: undefined | SettledAuthSession;
	readonly onRename: (name: string) => Effect.Effect<void, RyotClientError>;
};

export function AccountProfile(props: AccountProfileProps) {
	if (props.identity === undefined) {
		return (
			<SettingsSection title="Profile" detail="Your identity across this Ryot server.">
				{props.isLoading ? (
					<StatusMessage tone="pending">Loading your account...</StatusMessage>
				) : (
					<div className="flex flex-col items-start gap-3">
						<StatusMessage tone="error">Could not load your account.</StatusMessage>
						<Button type="button" variant="secondary" onClick={props.onRetry}>
							Try again
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
		<SettingsSection title="Profile" detail="Your identity across this Ryot server.">
			<div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center">
					<div className="flex min-w-0 items-center gap-3 sm:flex-1">
						<Avatar name={user.name} image={user.image} className="size-16 text-base" />
						<div className="min-w-0 flex-1">
							<p className="truncate text-base font-semibold text-text">{user.name}</p>
							<p className="truncate text-sm text-text-muted">{user.email}</p>
							<p className="truncate text-xs text-text-subtle">ID: {user.id}</p>
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
						{props.isGenerating ? "Generating..." : "New avatar"}
					</Button>
				</div>
				{!props.isDemo && (
					<AccountNameForm key={user.id} name={user.name} onRename={props.onRename} />
				)}
				{props.generationFailed && (
					<StatusMessage tone="error" className="text-xs">
						Could not generate a new avatar. Try again.
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
	const [draft, setDraft] = useState(props.name);
	const [status, setStatus] = useState<"idle" | "saved" | "error" | "saving">("idle");
	const name = draft.trim();
	const invalid = name.length === 0 || name.length > ACCOUNT_NAME_MAX_LENGTH;
	const saving = status === "saving";
	const canSave = !invalid && !saving && (name !== props.name || status === "error");

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
							onFailure: () => setStatus("error"),
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
				<Field label="Name" className="min-w-0 flex-1">
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
					{saving ? "Saving..." : "Save"}
				</Button>
			</div>
			<div aria-live="polite" className="mt-2 min-h-5 text-xs text-text-muted">
				{status === "error" && (
					<StatusMessage tone="error">Could not save your name. Try again.</StatusMessage>
				)}
				{status === "saved" && (
					<span className="inline-flex items-center gap-1.5 text-success">
						<AppIcon size={14} name="check" /> Name saved
					</span>
				)}
				{(status === "idle" || saving) && "How your name appears in Ryot."}
			</div>
		</form>
	);
}
