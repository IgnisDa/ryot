import type { PluginIdentityReference } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery, type RyotQuery } from "@ryot-app/plugin-client-sdk/react";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";
import type { ReactNode } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import type { mediaEntityParameters } from "../../shared/query-parameters";
import { useMediaMessages } from "../messages";
import { type MediaCursorPage, mediaCursorPageError } from "./cursor-page-state";
import { MediaCursorPages } from "./cursor-pages";
import { MediaDetailModalButton } from "./detail-modal";

const HISTORY_PAGE_SIZE = 100;

export type MediaHistoryRecipe<Event> = (input: {
	readonly reference: PluginIdentityReference;
}) => Recipe<MediaCursorPage<Event>, typeof mediaEntityParameters.schema>;

type HistoryPageInput = { readonly entityId: string; readonly after: null | string };

export const createMediaHistoryQuery = <Event,>(
	recipe: MediaHistoryRecipe<Event>,
	visible: (events: readonly Event[]) => readonly string[],
) =>
	createRyotQuery<HistoryPageInput, MediaCursorPage<Event>>(
		({ input, client }) =>
			client.data.query(
				recipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
				{ entityId: input.entityId },
				{ pages: { history: { limit: HISTORY_PAGE_SIZE, after: input.after ?? undefined } } },
			),
		{
			entityWatch: ({ data, input }) => ({
				foreground: [input.entityId],
				visible: data === undefined ? [] : visible(data.items),
			}),
		},
	);

export function MediaHistoryButton<Event>(props: {
	readonly entityId: string;
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly query: RyotQuery<HistoryPageInput, MediaCursorPage<Event>>;
	readonly renderItems: (items: readonly Event[], compact: boolean) => ReactNode;
}) {
	const text = useMediaMessages();
	return (
		<MediaDetailModalButton
			compact={props.compact}
			title={text("history.title")}
			safeAreaTop={props.safeAreaTop}
			closeLabel={text("history.close")}
			triggerLabel={text("history.view")}
		>
			<div role="list" className="flex flex-col gap-5" aria-label={text("history.title")}>
				<MediaCursorPages
					assets={() => []}
					query={props.query}
					input={{ entityId: props.entityId }}
					getPageInput={(input, after) => ({ ...input, after })}
					renderItems={(items) => props.renderItems(items, props.compact)}
					copy={{
						empty: text("history.empty"),
						error: (state) => mediaCursorPageError(text, { state, kind: "activities" }),
						loading: { title: text("activity.loading"), detail: text("history.loading-detail") },
					}}
				/>
			</div>
		</MediaDetailModalButton>
	);
}
