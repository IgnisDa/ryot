import { createRyotQuery, type RyotQuery } from "@ryot-app/plugin-client-sdk/react";
import type { PreparedRecipe } from "@ryot-app/plugin-client-sdk/ryotql";
import type { ReactNode } from "react";

import type { MediaHistoryInput } from "../../shared/media-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { type MediaCursorPage, mediaCursorPageError } from "./cursor-page-state";
import { MediaCursorPages } from "./cursor-pages";
import { MediaDetailModalButton } from "./detail-modal";

type HistoryPageInput = { readonly entityId: string; readonly after: string | null };

export type MediaHistoryRecipe<Event> = (
	input: MediaHistoryInput,
) => PreparedRecipe<MediaCursorPage<Event>>;

export const createMediaHistoryQuery = <Event,>(
	recipe: MediaHistoryRecipe<Event>,
	visible: (events: readonly Event[]) => readonly string[],
) =>
	createRyotQuery<HistoryPageInput, MediaCursorPage<Event>>(
		({ input, client }) =>
			client.data.query(
				recipe({
					limit: 60,
					entityId: input.entityId,
					before: input.after ?? undefined,
					reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
				}),
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
	readonly renderPage: (items: readonly Event[]) => ReactNode;
}) {
	return (
		<MediaDetailModalButton
			compact={props.compact}
			safeAreaTop={props.safeAreaTop}
			title="Complete activity history"
			closeLabel="Close activity history"
			triggerLabel="View complete history"
		>
			<div role="list" className="flex flex-col gap-5" aria-label="Complete activity history">
				<MediaCursorPages
					assets={() => []}
					query={props.query}
					renderPage={props.renderPage}
					input={{ entityId: props.entityId }}
					getPageInput={(input, after) => ({ ...input, after })}
					copy={{
						empty: "No activity found.",
						error: (state) => mediaCursorPageError({ state, noun: "activities" }),
						loading: {
							title: "Loading activity...",
							detail: "Fetching the complete activity history.",
						},
					}}
				/>
			</div>
		</MediaDetailModalButton>
	);
}
