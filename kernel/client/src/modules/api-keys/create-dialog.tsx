import { API_KEY_NAME_MAX_LENGTH } from "@ryot-app/contract/modules/account/schemas";
import { useRyotMutation, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Dialog,
	Field,
	Notice,
	SegmentedControl,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { Effect } from "effect";
import { type RefObject, type SubmitEvent, useId, useRef, useState } from "react";

import { shareOrCopy, sharesNatively } from "#/modules/device/share";
import { formatDateLabel } from "#/modules/ui/run/run-status";

import { createApiKeyMutation } from "./service";

const DAY_MS = 86_400_000;

const expiryOptions = [
	{ days: 30, value: "30", label: "30 days" },
	{ days: 90, value: "90", label: "90 days" },
	{ days: 365, value: "365", label: "1 year" },
	{ days: null, value: "never", label: "Never" },
] as const;

type Expiry = (typeof expiryOptions)[number]["value"];

type Created = { readonly key: string; readonly name: string };

export function CreateApiKeyDialog(props: {
	readonly onClose: () => void;
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const formId = useId();
	const schedule = useRyotSchedule();
	const create = useRyotMutation(createApiKeyMutation);
	const nameRef = useRef<HTMLInputElement>(null);
	const [name, setName] = useState("");
	const [expiry, setExpiry] = useState<Expiry>("90");
	const [nameError, setNameError] = useState<string | undefined>();
	const [created, setCreated] = useState<null | Created>(null);
	const days = expiryOptions.find((option) => option.value === expiry)?.days ?? null;

	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		const trimmed = name.trim();
		if (trimmed === "") {
			setNameError("Enter a name for this key.");
			return;
		}
		setNameError(undefined);
		void Effect.runPromise(
			create
				.mutateEffect({ name: trimmed, expiresInDays: days })
				.pipe(
					Effect.match({
						onFailure: () => undefined,
						onSuccess: ({ key }) => setCreated({ key, name: trimmed }),
					}),
				),
		);
	};

	if (created !== null) {
		return (
			<Dialog
				closeLabel="Close"
				onClose={props.onClose}
				title="Save your API key"
				triggerRef={props.triggerRef}
				footer={<Button onClick={props.onClose}>Done</Button>}
				description="This is the only time the key is shown. Copy it now and store it somewhere safe, like a password manager."
			>
				<RevealedKey created={created} />
			</Dialog>
		);
	}

	return (
		<Dialog
			closeLabel="Close"
			title="Create API key"
			onClose={props.onClose}
			initialFocusRef={nameRef}
			triggerRef={props.triggerRef}
			onInterceptBack={() => create.isPending}
			description="Name the key after the script or app that will use it."
			footer={
				<>
					<Button variant="ghost" onClick={props.onClose} disabled={create.isPending}>
						Cancel
					</Button>
					<Button type="submit" form={formId} loading={create.isPending}>
						Create key
					</Button>
				</>
			}
		>
			<form noValidate id={formId} onSubmit={submit} className="grid gap-5">
				<Field label="Name" error={nameError}>
					{(control) => (
						<TextField
							{...control}
							value={name}
							ref={nameRef}
							autoComplete="off"
							maxLength={API_KEY_NAME_MAX_LENGTH}
							placeholder="For example, Home server"
							onChange={(event) => setName(event.target.value)}
						/>
					)}
				</Field>
				<div className="grid gap-1.5">
					<span aria-hidden="true" className="text-label font-medium text-text">
						Expiration
					</span>
					<SegmentedControl
						fill
						value={expiry}
						label="Expiration"
						onChange={setExpiry}
						options={expiryOptions.map((option) => ({
							value: option.value,
							label: option.label,
							content: option.label,
						}))}
					/>
					<p className="text-xs text-text-muted">
						{days === null
							? "The key works until you revoke it."
							: `The key stops working on ${formatDateLabel(new Date(schedule.now() + days * DAY_MS).toISOString())}.`}
					</p>
				</div>
				{create.error !== null ? (
					<Notice tone="danger">The key could not be created. Try again.</Notice>
				) : null}
			</form>
		</Dialog>
	);
}

function RevealedKey(props: { readonly created: Created }) {
	const [copied, setCopied] = useState(false);
	const [failed, setFailed] = useState(false);
	const copy = () =>
		void Effect.runPromise(
			shareOrCopy({ text: props.created.key }).pipe(
				Effect.match({
					onFailure: () => setFailed(!sharesNatively),
					onSuccess: (outcome) => {
						setFailed(false);
						setCopied(outcome === "copied");
					},
				}),
			),
		);
	let action = { icon: "copy", label: "Copy" };
	if (sharesNatively) {
		action = { icon: "share", label: "Share" };
	} else if (copied) {
		action = { icon: "check", label: "Copied" };
	}

	return (
		<div className="grid gap-4">
			<div className="overflow-hidden rounded-lg border border-border bg-surface">
				<div className="flex items-center gap-2 border-b border-border px-3 py-2">
					<AppIcon size={16} name="key-round" className="shrink-0 text-accent-text" />
					<span className="min-w-0 flex-1 truncate text-label font-medium text-text">
						{props.created.name}
					</span>
					<Button size="sm" onClick={copy} variant="secondary">
						<AppIcon size={16} name={action.icon} />
						{action.label}
					</Button>
				</div>
				<code
					aria-label="New API key"
					className="block px-3 py-3 font-mono text-sm break-all text-text select-all"
				>
					{props.created.key}
				</code>
			</div>
			{failed ? (
				<p role="alert" className="text-xs text-danger">
					Could not copy the key. Select it and copy it manually.
				</p>
			) : null}
			<div className="grid gap-1.5">
				<span className="text-label font-medium text-text">Using the key</span>
				<p className="text-xs text-text-muted">Send it in a header with each request:</p>
				<code className="rounded-md bg-surface-2 px-3 py-2 font-mono text-xs text-text">
					X-Api-Key: &lt;your key&gt;
				</code>
			</div>
			<Notice tone="warning" icon={<AppIcon size={16} name="lock" />}>
				Anyone with this key can read and change your data. If it leaks, revoke it and create a new
				one.
			</Notice>
		</div>
	);
}
