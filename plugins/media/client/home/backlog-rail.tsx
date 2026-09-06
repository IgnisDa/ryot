import type { RyotQueryResult } from "@ryot-app/client-sdk/react";

import { mediaAspectOf } from "../schema-aspects";
import { libraryEntries, type LibraryStateData } from "./continue-rail";
import { HomeRail } from "./home-rail";

export function BacklogRail(props: {
	readonly compact: boolean;
	readonly result: RyotQueryResult<LibraryStateData>;
}) {
	return (
		<HomeRail
			result={props.result}
			compact={props.compact}
			title="From your backlog"
			tiles={(data) =>
				libraryEntries(data).map(({ item }) => ({
					item,
					key: item.id,
					aspect: mediaAspectOf(item.schemaSlug),
				}))
			}
		/>
	);
}
