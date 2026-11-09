import type { PublicationSource } from "@ryot-app/contract/modules/publications/schemas";
import { PublicationId } from "@ryot-app/contract/schema/brands";
import type {
	SharePublicationOutcome,
	SharePublicationRequest,
} from "@ryot-app/plugin-client-contract";
import { useRyotMutation, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Checkbox,
	Dialog,
	Field,
	Notice,
	StatusMessage,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { PublicationSummary } from "@ryot-app/ryotql-recipes/publications";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { Effect } from "effect";
import { type SubmitEvent, useState } from "react";

import type { ServerOrigin } from "#/api/origin";
import { AuthService } from "#/modules/auth/service";
import { useIsDemoSession } from "#/modules/demo-protection";
import { useHostScreenSession } from "#/modules/ui/host-screen-session";

import {
	CreatedLink,
	publicationFailureText,
	PublicationLinks,
	publicationShareUrl,
} from "./links";
import { usePublicationPreview } from "./preview";
import {
	createPublicationLinkMutation,
	createPublicationMutation,
	publicationSourceNameQuery,
	sourcePublicationsQuery,
} from "./service";
import { PublicationStatusLine } from "./status";

const FIRST_LINK_LABEL = "Shared link";

type CreatedShareLink = { readonly url: string; readonly title: string };

export function useShareScreen() {
	const { server, runtime } = useRouteContext({ from: "/_authenticated" });
	const disabled = useIsDemoSession(runtime.runSync(AuthService).session(server));
	const host = useHostScreenSession<SharePublicationRequest, SharePublicationOutcome>({
		kind: "closed",
	});
	const session = host.session;
	return {
		open: session !== null,
		onSharePublication: host.open,
		screen:
			session === null ? null : (
				<ShareSheet
					serverUrl={server}
					disabled={disabled}
					source={session.request.source}
					onClose={() => session.complete({ kind: "closed" })}
				/>
			),
	};
}

export function ShareSheet(props: {
	readonly disabled: boolean;
	readonly onClose: () => void;
	readonly serverUrl: ServerOrigin;
	readonly source: PublicationSource;
}) {
	const { disabled, serverUrl: server } = props;
	const publications = useRyotQuery(sourcePublicationsQuery, props.source);
	const [created, setCreated] = useState<null | CreatedShareLink>(null);
	const publication = publications.data?.at(0);
	let content;
	if (created !== null && publication === undefined) {
		content = null;
	} else if (publications.data === undefined) {
		content = publications.isError ? (
			<Notice tone="danger" action={<Button onClick={publications.refetch}>Retry</Button>}>
				Sharing details could not be loaded.
			</Notice>
		) : (
			<StatusMessage tone="pending">Loading sharing details...</StatusMessage>
		);
	} else if (publication === undefined) {
		content = (
			<PublishForm
				serverUrl={server}
				disabled={disabled}
				source={props.source}
				onCreated={setCreated}
			/>
		);
	} else {
		content = (
			<SharedPublication
				serverUrl={server}
				disabled={disabled}
				onClose={props.onClose}
				publication={publication}
			/>
		);
	}
	return (
		<Dialog
			size="md"
			title="Share"
			onClose={props.onClose}
			closeLabel="Close sharing"
			description="Anyone with a link can view a read-only page of these items without an account."
		>
			<div className="grid gap-4">
				{created === null ? null : <CreatedLink url={created.url} title={created.title} />}
				{content}
			</div>
		</Dialog>
	);
}

function PublishForm(props: {
	readonly disabled: boolean;
	readonly serverUrl: ServerOrigin;
	readonly source: PublicationSource;
	readonly onCreated: (link: CreatedShareLink) => void;
}) {
	const name = useRyotQuery(publicationSourceNameQuery, props.source);
	if (name.data === undefined) {
		return name.isError ? (
			<Notice tone="danger" action={<Button onClick={name.refetch}>Retry</Button>}>
				This could not be loaded.
			</Notice>
		) : (
			<StatusMessage tone="pending">Loading...</StatusMessage>
		);
	}
	return <PublishDetails {...props} defaults={name.data} />;
}

function SharedPublication(props: {
	readonly disabled: boolean;
	readonly onClose: () => void;
	readonly serverUrl: ServerOrigin;
	readonly publication: PublicationSummary;
}) {
	const navigate = useNavigate();
	const preview = usePublicationPreview();
	const { publication } = props;
	return (
		<>
			<div className="flex items-start gap-3">
				<span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-text-muted">
					<AppIcon size={20} name={publication.icon} />
				</span>
				<div className="grid min-w-0 flex-1 gap-0.5">
					<h3 className="truncate text-base font-semibold text-text">{publication.title}</h3>
					<PublicationStatusLine publicationId={PublicationId.make(publication.id)} />
				</div>
			</div>
			<PublicationLinks
				disabled={props.disabled}
				publication={publication}
				serverUrl={props.serverUrl}
			/>
			<div className="flex flex-wrap gap-2 border-t border-border pt-4">
				<Button
					size="sm"
					variant="secondary"
					disabled={preview.isPending}
					onClick={() => preview.open(publication.id)}
				>
					<AppIcon size={16} name="eye" />
					Preview as visitor
				</Button>
				<Button
					size="sm"
					variant="ghost"
					onClick={() => {
						props.onClose();
						void navigate({ to: "/settings/publications" });
					}}
				>
					Manage publications
				</Button>
			</div>
		</>
	);
}

function PublishDetails(props: {
	readonly disabled: boolean;
	readonly serverUrl: ServerOrigin;
	readonly source: PublicationSource;
	readonly onCreated: (link: CreatedShareLink) => void;
	readonly defaults: { readonly name: string; readonly icon: string };
}) {
	const publish = useRyotMutation(createPublicationMutation);
	const createLink = useRyotMutation(createPublicationLinkMutation);
	const [title, setTitle] = useState(props.defaults.name);
	const [showOwnerName, setShowOwnerName] = useState(false);
	const [error, setError] = useState<null | string>(null);

	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError(null);
		void Effect.runPromise(
			Effect.gen(function* () {
				const { publicationId } = yield* publish.mutateEffect({
					title,
					showOwnerName,
					description: null,
					source: props.source,
					icon: props.defaults.icon,
				});
				const { secret } = yield* createLink.mutateEffect({
					expiresAt: null,
					label: FIRST_LINK_LABEL,
					publicationId: PublicationId.make(publicationId),
				});
				return publicationShareUrl(props.serverUrl, publicationId, `#${secret}`);
			}).pipe(
				Effect.match({
					onSuccess: (url) => props.onCreated({ url, title }),
					onFailure: (failure) => setError(publicationFailureText(failure)),
				}),
			),
		);
	};

	return (
		<form onSubmit={submit} className="grid gap-4">
			<Field label="Title">
				{(control) => (
					<TextField
						{...control}
						value={title}
						maxLength={120}
						onChange={(event) => setTitle(event.target.value)}
					/>
				)}
			</Field>
			<Checkbox
				checked={showOwnerName}
				label="Show my name to visitors"
				onChange={(event) => setShowOwnerName(event.target.checked)}
			/>
			<p className="text-xs text-text-muted">
				Visitors see these items as they change, but not your activity, ratings, or other
				collections.
			</p>
			{error === null ? null : <Notice tone="danger">{error}</Notice>}
			<div>
				<Button
					type="submit"
					disabled={props.disabled || publish.isPending || createLink.isPending}
				>
					<AppIcon size={16} name="link" />
					Publish and create link
				</Button>
			</div>
		</form>
	);
}
