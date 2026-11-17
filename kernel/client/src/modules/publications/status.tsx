import { PublicationId } from "@ryot-app/contract/schema/brands";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Badge } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { PublicationSummary } from "@ryot-app/ryotql-recipes/publications";

import { publicationStatusQuery } from "./service";

const attentionMessages = {
	"page-unavailable": kernelMessage("client.publications.status.attention.page-unavailable"),
	"bindings-invalid": kernelMessage("client.publications.status.attention.bindings-invalid"),
	"source-unavailable": kernelMessage("client.publications.status.attention.source-unavailable"),
	"snapshot-too-large": kernelMessage("client.publications.status.attention.snapshot-too-large"),
	"dependency-unavailable": kernelMessage(
		"client.publications.status.attention.dependency-unavailable",
	),
} as const;

export function PublicationHeader(props: {
	readonly heading: "h2" | "h3";
	readonly publication: PublicationSummary;
}) {
	const t = useT();
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
					<Badge variant="neutral">
						{t(
							publication.definition.mode === "snapshot"
								? kernelMessage("client.publications.mode.snapshot")
								: kernelMessage("client.publications.mode.live"),
						)}
					</Badge>
					{!active && (
						<Badge variant="danger">{t(kernelMessage("client.publications.status.revoked"))}</Badge>
					)}
				</div>
				{active ? (
					<PublicationStatusLine publicationId={PublicationId.make(publication.id)} />
				) : (
					<span className="text-xs text-text-muted">
						{t(kernelMessage("client.publications.status.revoked-detail"))}
					</span>
				)}
			</div>
		</div>
	);
}

function PublicationStatusLine(props: { readonly publicationId: PublicationId }) {
	const t = useT();
	const status = useRyotQuery(publicationStatusQuery, props.publicationId);
	if (status.data === undefined) {
		return (
			<span className="text-xs text-text-muted">
				{t(
					status.isError
						? kernelMessage("client.publications.status.unavailable")
						: kernelMessage("client.publications.status.checking"),
				)}
			</span>
		);
	}
	if (status.data.status === "ready") {
		const count = status.data.itemCount;
		if (count === undefined) {
			return (
				<span className="text-xs text-text-muted">
					{t(kernelMessage("client.publications.status.ready"))}
				</span>
			);
		}
		return (
			<span className="text-xs text-text-muted">
				{t(kernelMessage("sdk.browser.item-count", { count }))}
			</span>
		);
	}
	return (
		<span className="text-xs font-medium text-danger">
			{t(attentionMessages[status.data.reason.code])}
		</span>
	);
}
