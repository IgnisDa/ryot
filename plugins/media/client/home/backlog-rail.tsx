import type { RyotQueryResult } from "@ryot-app/plugin-client-sdk/react";

import { useMediaMessages } from "../messages";
import { mediaAspectOf } from "../schema-aspects";
import { libraryEntries, type LibraryStateData } from "./continue-rail";
import { HomeRail } from "./home-rail";

export function BacklogRail(props: {
	readonly compact: boolean;
	readonly result: RyotQueryResult<LibraryStateData>;
}) {
	const text = useMediaMessages();
	return (
		<HomeRail
			result={props.result}
			compact={props.compact}
			title={text("home.backlog.title")}
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
