import { API_KEY_NAME_MAX_LENGTH } from "@ryot-app/contract/modules/account/schemas";
import type { WriteAccess } from "@ryot-app/contract/oauth";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotMutation, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	CopyField,
	Dialog,
	Field,
	Notice,
	SegmentedControl,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { Effect } from "effect";
import { type RefObject, type SubmitEvent, useId, useRef, useState } from "react";

import { useShareAction } from "#/modules/device/share";

import { createApiKeyMutation } from "./service";
import { WriteAccessField } from "./write-access";

const DAY_MS = 86_400_000;

const expiryOptions = [
	{ days: 30, value: "30", label: kernelMessage("client.access.expiry.days", { count: 30 }) },
	{ days: 90, value: "90", label: kernelMessage("client.access.expiry.days", { count: 90 }) },
	{ days: 365, value: "365", label: kernelMessage("client.access.expiry.years", { count: 1 }) },
	{ days: null, value: "never", label: kernelMessage("client.access.expiry.never") },
] as const;

type Expiry = (typeof expiryOptions)[number]["value"];

type Created = { readonly key: string; readonly name: string };

export function CreateApiKeyDialog(props: {
	readonly onClose: () => void;
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const t = useT();
	const formId = useId();
	const schedule = useRyotSchedule();
	const create = useRyotMutation(createApiKeyMutation);
	const nameRef = useRef<HTMLInputElement>(null);
	const [name, setName] = useState("");
	const [expiry, setExpiry] = useState<Expiry>("90");
	const [writeAccess, setWriteAccess] = useState<WriteAccess>("confirm");
	const [nameError, setNameError] = useState<string | undefined>();
	const [created, setCreated] = useState<null | Created>(null);
	const days = expiryOptions.find((option) => option.value === expiry)?.days ?? null;

	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		const trimmed = name.trim();
		if (trimmed === "") {
			setNameError(t(kernelMessage("client.access.create.name-required")));
			return;
		}
		setNameError(undefined);
		void Effect.runPromise(
			create
				.mutateEffect({ writeAccess, name: trimmed, expiresInDays: days })
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
				onClose={props.onClose}
				triggerRef={props.triggerRef}
				closeLabel={t(kernelMessage("common.action.close"))}
				title={t(kernelMessage("client.access.create.saved-title"))}
				description={t(kernelMessage("client.access.create.saved-description"))}
				footer={<Button onClick={props.onClose}>{t(kernelMessage("common.action.done"))}</Button>}
			>
				<RevealedKey created={created} />
			</Dialog>
		);
	}

	return (
		<Dialog
			onClose={props.onClose}
			initialFocusRef={nameRef}
			triggerRef={props.triggerRef}
			dismissible={!create.isPending}
			closeLabel={t(kernelMessage("common.action.close"))}
			title={t(kernelMessage("client.access.create.title"))}
			description={t(kernelMessage("client.access.create.description"))}
			footer={
				<>
					<Button variant="ghost" onClick={props.onClose} disabled={create.isPending}>
						{t(kernelMessage("common.action.cancel"))}
					</Button>
					<Button type="submit" form={formId} loading={create.isPending}>
						{t(kernelMessage("client.access.create.submit"))}
					</Button>
				</>
			}
		>
			<form noValidate id={formId} onSubmit={submit} className="grid gap-5">
				<Field error={nameError} label={t(kernelMessage("client.access.create.name-label"))}>
					{(control) => (
						<TextField
							{...control}
							value={name}
							ref={nameRef}
							autoComplete="off"
							maxLength={API_KEY_NAME_MAX_LENGTH}
							onChange={(event) => setName(event.target.value)}
							placeholder={t(kernelMessage("client.access.create.name-placeholder"))}
						/>
					)}
				</Field>
				<WriteAccessField
					value={writeAccess}
					onChange={setWriteAccess}
					disabled={create.isPending}
				/>
				<div className="grid gap-1.5">
					<span aria-hidden="true" className="text-label font-medium text-text">
						{t(kernelMessage("client.access.create.expiration"))}
					</span>
					<SegmentedControl
						fill
						value={expiry}
						onChange={setExpiry}
						label={t(kernelMessage("client.access.create.expiration"))}
						options={expiryOptions.map((option) => ({
							value: option.value,
							label: t(option.label),
							content: t(option.label),
						}))}
					/>
					<p className="text-xs text-text-muted">
						{t(
							days === null
								? kernelMessage("client.access.create.expiry-never-hint")
								: kernelMessage("client.access.create.expiry-date-hint", {
										date: new Date(schedule.now() + days * DAY_MS),
									}),
						)}
					</p>
				</div>
				{create.error !== null ? (
					<Notice tone="danger">{t(kernelMessage("client.access.create.failed"))}</Notice>
				) : null}
			</form>
		</Dialog>
	);
}

function RevealedKey(props: { readonly created: Created }) {
	const t = useT();
	const shareAction = useShareAction();
	return (
		<div className="grid gap-4">
			<CopyField
				multiline
				value={props.created.key}
				label={props.created.name}
				action={shareAction({ text: props.created.key })}
			/>
			<div className="grid gap-1.5">
				<span className="text-label font-medium text-text">
					{t(kernelMessage("client.access.create.usage-title"))}
				</span>
				<p className="text-xs text-text-muted">
					{t(kernelMessage("client.access.create.usage-detail"))}
				</p>
				<code className="rounded-md bg-surface-2 px-3 py-2 font-mono text-xs text-text">
					{t(kernelMessage("client.access.create.usage-header"))}
				</code>
			</div>
			<Notice tone="warning" icon={<AppIcon size={16} name="lock" />}>
				{t(kernelMessage("client.access.create.leak-warning"))}
			</Notice>
		</div>
	);
}
