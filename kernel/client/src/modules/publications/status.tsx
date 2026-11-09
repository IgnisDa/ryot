import { PublicationId } from "@ryot-app/contract/schema/brands";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Badge } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { PublicationSummary } from "@ryot-app/ryotql-recipes/publications";

import { publicationStatusQuery } from "./service";

export function PublicationHeader(props: {
	readonly heading: "h2" | "h3";
	readonly publication: PublicationSummary;
}) {
	const { publication } = props;
	const Heading = props.heading;
	const active = publication.revokedAt === null;
	return (
		<div className="flex items-start gap-3">
			<span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-text-muted">
				<AppIcon size={20} name={publication.icon} />
			</span>
			<div className="grid min-w-0 flex-1 gap-0.5">
				<div className="flex flex-wrap items-center gap-2">
					<Heading className="truncate text-base font-semibold text-text">
						{publication.title}
					</Heading>
					{!active && <Badge variant="danger">Revoked</Badge>}
				</div>
				{active ? (
					<PublicationStatusLine publicationId={PublicationId.make(publication.id)} />
				) : (
					<span className="text-xs text-text-muted">No one can open it anymore.</span>
				)}
			</div>
		</div>
	);
}

function PublicationStatusLine(props: { readonly publicationId: PublicationId }) {
	const status = useRyotQuery(publicationStatusQuery, props.publicationId);
	if (status.data === undefined) {
		return (
			<span className="text-xs text-text-muted">
				{status.isError ? "Status unavailable" : "Checking..."}
			</span>
		);
	}
	if (status.data.status === "ready") {
		const count = status.data.itemCount;
		return (
			<span className="text-xs text-text-muted">
				{count === 1 ? "1 item" : `${count.toLocaleString()} items`}
			</span>
		);
	}
	return (
		<span className="text-xs font-medium text-danger">
			{status.data.status === "too-large"
				? `Needs attention: shares more than ${status.data.limit.toLocaleString()} items`
				: "Needs attention: its collection or view no longer exists"}
		</span>
	);
}
