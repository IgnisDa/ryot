import {
	PublicationBadRequest,
	PublicationsDisabled,
} from "@ryot-app/contract/modules/publications/schemas";
import { useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import {
	Badge,
	Button,
	DestructiveConfirmation,
	Field,
	Notice,
	Row,
	RowGroup,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { PublicationSummary } from "@ryot-app/ryotql-recipes/publications";
import { Effect, Schema } from "effect";
import { type SubmitEvent, useRef, useState } from "react";

import { AuthenticatedApiError } from "#/api/authenticated";
import type { ServerOrigin } from "#/api/origin";
import { formatDateLabel, formatRelativeTime } from "#/modules/ui/run/run-status";
import { ShareLinkField } from "#/modules/ui/share-link-field";
import { RELATIVE_TIME_REFRESH_MS, useNowMs } from "#/modules/ui/use-now-ms";

import { createPublicationLinkMutation, publicationCommandMutation } from "./service";

export const publicationFailureText = (error: unknown) => {
	const cause = error instanceof AuthenticatedApiError ? error.cause : undefined;
	if (Schema.is(PublicationBadRequest)(cause)) {
		const { reason } = cause;
		if (reason.code === "required-field") {
			return `Enter a ${reason.field}.`;
		}
		if (reason.code === "snapshot-too-large") {
			return `The snapshot exceeds the server limit of ${reason.limitBytes.toLocaleString()} bytes.`;
		}
		if (reason.code === "source-unavailable") {
			return "This collection or view can no longer be published.";
		}
		if (reason.code === "expiry-in-past") {
			return "Choose an expiry in the future.";
		}
		if (reason.code === "page-unavailable") {
			return "This page is not published or is unavailable.";
		}
		if (reason.code === "dependency-unavailable") {
			return "A page dependency is unavailable.";
		}
		if (reason.code === "bindings-invalid") {
			return reason.issues.map((issue) => issue.message).join("; ");
		}
		return "This publication was revoked.";
	}
	if (Schema.is(PublicationsDisabled)(cause)) {
		return "Sharing is turned off on this server.";
	}
	return "The change could not be saved. Try again.";
};

export const publicationShareUrl = (
	serverUrl: ServerOrigin,
	publicationId: string,
	fragment: string,
) => `${serverUrl}/share/${encodeURIComponent(publicationId)}${fragment}`;

type Link = PublicationSummary["links"]["items"][number];

const isActive = (link: Link, now: number) =>
	link.revokedAt === null && (link.expiresAt === null || Date.parse(link.expiresAt) > now);

const linkDetail = (link: Link, now: number) => {
	if (!isActive(link, now)) {
		return `Created ${formatDateLabel(link.createdAt)}`;
	}
	const parts = [
		link.expiresAt === null ? "Never expires" : `Expires ${formatDateLabel(link.expiresAt)}`,
		link.lastExchangedAt === null
			? "Not opened yet"
			: `Last opened ${formatRelativeTime(link.lastExchangedAt, now)}`,
	];
	return parts.join(" · ");
};

export function CreatedLink(props: { readonly url: string; readonly title: string }) {
	return (
		<Notice tone="success" title="Your link is ready">
			<p className="mb-2 text-xs">
				Copy it now. It is shown only once, and anyone with it can view this page.
			</p>
			<ShareLinkField url={props.url} label="New link" title={props.title} />
		</Notice>
	);
}

export function PublicationLinks(props: {
	readonly disabled: boolean;
	readonly serverUrl: ServerOrigin;
	readonly publication: PublicationSummary;
}) {
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
						onFailure: (failure) => setError(publicationFailureText(failure)),
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
		<section aria-label="Links" className="grid gap-3">
			{created === null ? null : <CreatedLink url={created} title={props.publication.title} />}
			{links.length === 0 ? (
				<p className="text-sm text-text-muted">
					No links yet. Create one to share this page with people.
				</p>
			) : (
				<RowGroup>
					{links.map((link) => (
						<Row
							key={link.id}
							title={link.label}
							description={linkDetail(link, now)}
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
										Revoke
									</Button>
								) : (
									<Badge variant={link.revokedAt === null ? "neutral" : "danger"}>
										{link.revokedAt === null ? "Expired" : "Revoked"}
									</Badge>
								)
							}
						/>
					))}
				</RowGroup>
			)}
			{revoking === null ? null : (
				<DestructiveConfirmation
					title="Revoke this link?"
					actionLabel="Revoke link"
					pendingLabel="Revoking..."
					triggerRef={revokeTrigger}
					pending={command.isPending}
					onClose={() => {
						command.reset();
						setRevoking(null);
					}}
					errorMessage={command.error === null ? undefined : publicationFailureText(command.error)}
					detail={`Anyone using "${revoking.label}" can no longer open this page. Other links keep working.`}
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
						New link
					</Button>
				</div>
			)}
			{active && adding && (
				<form onSubmit={submit} className="flex flex-wrap items-end gap-2">
					<Field label="Who is it for?">
						{(control) => (
							<TextField
								{...control}
								value={label}
								maxLength={80}
								density="compact"
								placeholder="For example, Family"
								onChange={(event) => setLabel(event.target.value)}
							/>
						)}
					</Field>
					<Field optional label="Expires on">
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
						Create link
					</Button>
					<Button size="sm" type="button" variant="ghost" onClick={() => setAdding(false)}>
						Cancel
					</Button>
				</form>
			)}
			{error === null ? null : <Notice tone="danger">{error}</Notice>}
		</section>
	);
}
