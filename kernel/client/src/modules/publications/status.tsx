import type { PublicationId } from "@ryot-app/contract/schema/brands";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import { publicationStatusQuery } from "./service";

export function PublicationStatusLine(props: { readonly publicationId: PublicationId }) {
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
