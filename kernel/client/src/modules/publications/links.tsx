import {
	PublicationBadRequest,
	PublicationsDisabled,
} from "@ryot-app/contract/modules/publications/schemas";
import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Message } from "@ryot-app/i18n/message";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import {
	Badge,
	Button,
	CopyField,
	DestructiveConfirmation,
	entitlementRequiredMessage,
	Field,
	Notice,
	Row,
	RowGroup,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { formatDateLabel } from "@ryot-app/plugin-ui-sdk/datetime";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { PublicationSummary } from "@ryot-app/ryotql-recipes/publications";
import { Effect, Schema } from "effect";
import { type SubmitEvent, useRef, useState } from "react";

import { AuthenticatedApiError, isEntitlementRequiredError } from "#/api/authenticated";
import type { ServerOrigin } from "#/api/origin";
import { useShareAction } from "#/modules/device/share";
import { formatRelativeTime } from "#/modules/ui/run/run-status";
import { RELATIVE_TIME_REFRESH_MS, useNowMs } from "#/modules/ui/use-now-ms";

import { createPublicationLinkMutation, publicationCommandMutation } from "./service";

export const publicationFailureText = (
	t: (message: Message) => Text,
	formatters: Formatters,
	error: unknown,
) => {
	if (isEntitlementRequiredError(error)) {
		return t(entitlementRequiredMessage(error.cause.reason.entitlement));
	}
	const cause = error instanceof AuthenticatedApiError ? error.cause : undefined;
	if (Schema.is(PublicationBadRequest)(cause)) {
		const { reason } = cause;
		if (reason.code === "required-field") {
			return t(kernelMessage("client.publications.error.required-field", { field: reason.field }));
		}
		if (reason.code === "snapshot-too-large") {
			return t(
				kernelMessage("client.publications.error.snapshot-too-large", { limit: reason.limitBytes }),
			);
		}
		if (reason.code === "source-unavailable") {
			return t(kernelMessage("client.publications.error.source-unavailable"));
		}
		if (reason.code === "expiry-in-past") {
			return t(kernelMessage("client.publications.error.expiry-in-past"));
		}
		if (reason.code === "page-unavailable") {
			return t(kernelMessage("client.publications.error.page-unavailable"));
		}
		if (reason.code === "dependency-unavailable") {
			return t(kernelMessage("client.publications.error.dependency-unavailable"));
		}
		if (reason.code === "bindings-invalid") {
			return Text(
				formatters
					.list({ type: "unit", style: "long" })
					.format(reason.issues.map((issue) => issue.message)),
			);
		}
		return t(kernelMessage("client.publications.error.revoked"));
	}
	if (Schema.is(PublicationsDisabled)(cause)) {
		return t(kernelMessage("client.publications.error.disabled"));
	}
	return t(kernelMessage("client.publications.error.generic"));
};

export const publicationShareUrl = (
	serverUrl: ServerOrigin,
	publicationId: string,
	fragment: string,
) => `${serverUrl}/share/${encodeURIComponent(publicationId)}${fragment}`;

type Link = PublicationSummary["links"]["items"][number];

const isActive = (link: Link, now: number) =>
	link.revokedAt === null && (link.expiresAt === null || Date.parse(link.expiresAt) > now);

const linkDetail = (
	t: (message: Message) => Text,
	formatters: Formatters,
	link: Link,
	now: number,
) => {
	if (!isActive(link, now)) {
		return kernelMessage("client.publications.link.created", {
			date: formatDateLabel(formatters, link.createdAt),
		});
	}
	return kernelMessage("client.publications.link.detail", {
		expiry:
			link.expiresAt === null
				? kernelMessage("client.publications.link.never-expires")
				: kernelMessage("client.publications.link.expires", {
						date: formatDateLabel(formatters, link.expiresAt),
					}),
		opened:
			link.lastExchangedAt === null
				? kernelMessage("client.publications.link.not-opened")
				: kernelMessage("client.publications.link.last-opened", {
						relative: formatRelativeTime(formatters, t, link.lastExchangedAt, now),
					}),
	});
};

export function CreatedLink(props: { readonly url: string; readonly title: string }) {
	const t = useT();
	const shareAction = useShareAction();
	return (
		<Notice tone="success" title={t(kernelMessage("client.publications.link.ready"))}>
			<CopyField
				className="mt-2"
				value={props.url}
				label={t(kernelMessage("client.publications.link.new"))}
				action={shareAction({ url: props.url, title: props.title })}
				hint={t(kernelMessage("client.publications.link.copy-hint"))}
			/>
		</Notice>
	);
}

export function PublicationLinks(props: {
	readonly disabled: boolean;
	readonly serverUrl: ServerOrigin;
	readonly publication: PublicationSummary;
}) {
	const t = useT();
	const formatters = useFormatters();
	const create = useRyotMutation(createPublicationLinkMutation);
	const command = useRyotMutation(publicationCommandMutation);
	const [label, setLabel] = useState("");
	const [expiresOn, setExpiresOn] = useState("");
	const [adding, setAdding] = useState(false);
	const [created, setCreated] = useState<null | string>(null);
	const [error, setError] = useState<null | string>(null);
	const [revoking, setRevoking] = useState<null | Link>(null);
	const revokeTrigger = useRef<null | HTMLButtonElement>(null);
	const now = useNowMs(RELATIVE_TIME_REFRESH_MS);
	const active = props.publication.revokedAt === null;
	const links = props.publication.links.items;

	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError(null);
		void Effect.runPromise(
			create
				.mutateEffect({
					label,
					publicationId: props.publication.id,
					expiresAt: expiresOn === "" ? null : new Date(`${expiresOn}T23:59:59`).toISOString(),
				})
				.pipe(
					Effect.match({
						onFailure: (failure) => setError(publicationFailureText(t, formatters, failure)),
						onSuccess: ({ secret }) => {
							setLabel("");
							setExpiresOn("");
							setAdding(false);
							setCreated(publicationShareUrl(props.serverUrl, props.publication.id, `#${secret}`));
						},
					}),
				),
		);
	};

	return (
		<section
			className="grid gap-3"
			aria-label={t(kernelMessage("client.publications.link.section"))}
		>
			{created === null ? null : <CreatedLink url={created} title={props.publication.title} />}
			{links.length === 0 ? (
				<p className="text-sm text-text-muted">
					{t(kernelMessage("client.publications.link.empty"))}
				</p>
			) : (
				<RowGroup>
					{links.map((link) => (
						<Row
							key={link.id}
							title={link.label}
							description={t(linkDetail(t, formatters, link, now))}
							leading={
								<AppIcon
									size={16}
									name="link"
									className={isActive(link, now) ? "text-text-muted" : "text-text-subtle"}
								/>
							}
							trailing={
								isActive(link, now) ? (
									<Button
										size="sm"
										variant="dangerGhost"
										disabled={props.disabled}
										onClick={(event) => {
											revokeTrigger.current = event.currentTarget;
											setRevoking(link);
										}}
									>
										{t(kernelMessage("client.publications.link.revoke"))}
									</Button>
								) : (
									<Badge variant={link.revokedAt === null ? "neutral" : "danger"}>
										{t(
											link.revokedAt === null
												? kernelMessage("client.publications.link.expired")
												: kernelMessage("client.publications.status.revoked"),
										)}
									</Badge>
								)
							}
						/>
					))}
				</RowGroup>
			)}
			{revoking === null ? null : (
				<DestructiveConfirmation
					triggerRef={revokeTrigger}
					pending={command.isPending}
					title={t(kernelMessage("client.publications.link.revoke-title"))}
					pendingLabel={t(kernelMessage("client.publications.link.revoking"))}
					actionLabel={t(kernelMessage("client.publications.link.revoke-action"))}
					onClose={() => {
						command.reset();
						setRevoking(null);
					}}
					detail={t(
						kernelMessage("client.publications.link.revoke-detail", { label: revoking.label }),
					)}
					errorMessage={
						command.error === null
							? undefined
							: publicationFailureText(t, formatters, command.error)
					}
					onConfirm={() =>
						void Effect.runPromise(
							command
								.mutateEffect({
									action: "revokeLink",
									request: { payload: { linkId: revoking.id } },
								})
								.pipe(
									Effect.match({ onFailure: () => undefined, onSuccess: () => setRevoking(null) }),
								),
						)
					}
				/>
			)}
			{active && !adding && (
				<div>
					<Button
						size="sm"
						variant="secondary"
						disabled={props.disabled}
						onClick={() => setAdding(true)}
					>
						<AppIcon size={16} name="plus" />
						{t(kernelMessage("client.publications.link.new"))}
					</Button>
				</div>
			)}
			{active && adding && (
				<form onSubmit={submit} className="flex flex-wrap items-end gap-2">
					<Field label={t(kernelMessage("client.publications.link.audience"))}>
						{(control) => (
							<TextField
								{...control}
								value={label}
								maxLength={80}
								density="compact"
								onChange={(event) => setLabel(event.target.value)}
								placeholder={t(kernelMessage("client.publications.link.audience-placeholder"))}
							/>
						)}
					</Field>
					<Field optional label={t(kernelMessage("client.publications.link.expires-on"))}>
						{(control) => (
							<TextField
								{...control}
								type="date"
								density="compact"
								value={expiresOn}
								onChange={(event) => setExpiresOn(event.target.value)}
							/>
						)}
					</Field>
					<Button size="sm" type="submit" disabled={props.disabled || create.isPending}>
						{t(kernelMessage("client.publications.link.create"))}
					</Button>
					<Button size="sm" type="button" variant="ghost" onClick={() => setAdding(false)}>
						{t(kernelMessage("common.action.cancel"))}
					</Button>
				</form>
			)}
			{error === null ? null : <Notice tone="danger">{error}</Notice>}
		</section>
	);
}
