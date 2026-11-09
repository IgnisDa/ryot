import {
	PublicationBadRequest,
	PublicationsDisabled,
} from "@ryot-app/contract/modules/publications/schemas";
import { useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { Badge, Button, Field, Notice, TextField } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { PublicationSummary } from "@ryot-app/ryotql-recipes/publications";
import { Effect, Schema } from "effect";
import { type SubmitEvent, useState } from "react";

import { AuthenticatedApiError } from "#/api/authenticated";
import type { ServerOrigin } from "#/api/origin";
import { shareOrCopy, sharesNatively } from "#/modules/device/share";

import { createPublicationLinkMutation, publicationCommandMutation } from "./service";

export const publicationFailureText = (error: unknown) => {
	const cause = error instanceof AuthenticatedApiError ? error.cause : undefined;
	if (Schema.is(PublicationBadRequest)(cause)) {
		const { reason } = cause;
		if (reason.code === "required-field") {
			return `Enter a ${reason.field}.`;
		}
		if (reason.code === "scope-too-large") {
			return `This shares more than ${reason.limit.toLocaleString()} items, which is more than this server allows.`;
		}
		if (reason.code === "source-unavailable") {
			return "This collection or view can no longer be published.";
		}
		if (reason.code === "expiry-in-past") {
			return "Choose an expiry in the future.";
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
		return `Created ${new Date(link.createdAt).toLocaleDateString()}`;
	}
	const parts = [
		link.expiresAt === null
			? "Never expires"
			: `Expires ${new Date(link.expiresAt).toLocaleDateString()}`,
		...(link.lastExchangedAt === null
			? ["Not opened yet"]
			: [`Last opened ${new Date(link.lastExchangedAt).toLocaleDateString()}`]),
	];
	return parts.join(" · ");
};

const linkActionPresentation = (copied: boolean) => {
	if (sharesNatively) {
		return { icon: "share", label: "Share" };
	}
	return copied ? { icon: "check", label: "Copied" } : { icon: "copy", label: "Copy" };
};

export function CreatedLink(props: { readonly url: string; readonly title: string }) {
	const [copied, setCopied] = useState(false);
	const action = linkActionPresentation(copied);
	return (
		<Notice tone="success" title="Your link is ready">
			<p className="text-xs">
				Copy it now. It is shown only once, and anyone with it can view this page.
			</p>
			<div className="mt-2 flex flex-wrap items-center gap-2">
				<div className="min-w-0 flex-1">
					<TextField readOnly value={props.url} density="compact" aria-label="New link" />
				</div>
				<Button
					size="sm"
					variant="secondary"
					onClick={() =>
						void Effect.runPromise(
							shareOrCopy({ url: props.url, title: props.title }).pipe(
								Effect.match({
									onFailure: () => undefined,
									onSuccess: (outcome) => setCopied(outcome === "copied"),
								}),
							),
						)
					}
				>
					<AppIcon size={16} name={action.icon} />
					{action.label}
				</Button>
			</div>
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
	const [now] = useState(() => Date.now());
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
				<ul className="grid divide-y divide-border rounded-lg border border-border">
					{links.map((link) => (
						<li key={link.id} className="flex items-center gap-3 px-3 py-2.5">
							<AppIcon
								size={16}
								name="link"
								className={isActive(link, now) ? "text-text-muted" : "text-text-subtle"}
							/>
							<div className="grid min-w-0 flex-1">
								<span className="truncate text-sm font-medium text-text">{link.label}</span>
								<span className="truncate text-xs text-text-muted">{linkDetail(link, now)}</span>
							</div>
							{isActive(link, now) ? (
								<Button
									size="sm"
									variant="dangerGhost"
									disabled={props.disabled || command.isPending}
									onClick={() =>
										void Effect.runPromise(
											Effect.ignore(
												command.mutateEffect({
													action: "revokeLink",
													request: { payload: { linkId: link.id } },
												}),
											),
										)
									}
								>
									Revoke
								</Button>
							) : (
								<Badge variant={link.revokedAt === null ? "neutral" : "danger"}>
									{link.revokedAt === null ? "Expired" : "Revoked"}
								</Badge>
							)}
						</li>
					))}
				</ul>
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
