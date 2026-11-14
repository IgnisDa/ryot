import { type PluginIdentityReference, PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery, type RyotQuery } from "@ryot-app/plugin-client-sdk/react";
import type { AppSchema, Recipe } from "@ryot-app/plugin-client-sdk/ryotql";
import { fieldSyncState } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import type { ComponentProps } from "react";

import type { MediaCreatorCredit } from "../../shared/creator-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { type MediaCursorPage, mediaCursorPageError } from "./cursor-page-state";
import { MediaCursorPages } from "./cursor-pages";
import { MediaDetailModalButton } from "./detail-modal";
import type { MediaEntityRecipe } from "./detail-queries";
import { type MediaArtworkAspect, mediaAspectClass } from "./entity-presentation";
import { collectManagedAssetLocators, type MediaImagePurposes } from "./image";
import { MediaLibraryTitle } from "./library-title";
import { ManagedAssetImage } from "./managed-assets";
import { mediaCharacterLabel, mediaRolesLabel, type MediaUnlinkedCreator } from "./overview-state";
import { mediaPosterAsset } from "./summary-state";

export type MediaCreditsRecipe = MediaEntityRecipe<MediaCursorPage<MediaCreatorCredit>>;

type CreditPageInput<Scope extends object> = Scope & {
	readonly entityId: string;
	readonly after: null | string;
};

export const createMediaCreditsQuery = <Scope extends object, const Parameters extends AppSchema>(
	recipe: (input: {
		readonly reference: PluginIdentityReference;
	}) => Recipe<MediaCursorPage<MediaCreatorCredit>, Parameters>,
	arguments_: (
		input: CreditPageInput<Scope>,
	) => Recipe.Arguments<Recipe<MediaCursorPage<MediaCreatorCredit>, Parameters>>,
	queryName: string,
) =>
	createRyotQuery<CreditPageInput<Scope>, MediaCursorPage<MediaCreatorCredit>>(
		({ input, client }) =>
			client.data.query(
				recipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
				arguments_(input),
				{ pages: { [queryName]: { limit: 30, after: input.after ?? undefined } } },
			),
		{
			entityWatch: ({ data, input }) => ({
				foreground: [input.entityId],
				visible: data?.items.map(({ id }) => id) ?? [],
			}),
		},
	);

export function MediaCreditsButton<Scope extends object>(props: {
	readonly label: string;
	readonly title: string;
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly aspect: MediaArtworkAspect;
	readonly purpose: MediaImagePurposes[number];
	readonly unlinked?: readonly MediaUnlinkedCreator[];
	readonly input: Scope & { readonly entityId: string };
	readonly fit?: ComponentProps<typeof ManagedAssetImage>["fit"];
	readonly query: RyotQuery<CreditPageInput<NoInfer<Scope>>, MediaCursorPage<MediaCreatorCredit>>;
}) {
	return (
		<MediaDetailModalButton
			title={props.title}
			compact={props.compact}
			triggerLabel={props.label}
			closeLabel="Close credits"
			safeAreaTop={props.safeAreaTop}
		>
			<div className="flex flex-col gap-3">
				{props.unlinked?.map((creator) => (
					<div className="py-3" key={`${creator.role}:${creator.name}`}>
						<p className="font-ui font-medium text-sm text-text">{creator.name}</p>
						<p className="font-ui text-xs text-text-muted">{creator.role}</p>
					</div>
				))}
				<MediaCursorPages
					query={props.query}
					input={props.input}
					getPageInput={(input, after) => ({ ...input, after })}
					assets={(items) =>
						collectManagedAssetLocators(items.map((item) => mediaPosterAsset(item, props.purpose)))
					}
					copy={{
						empty: "No linked credits found.",
						error: (state) => mediaCursorPageError({ state, noun: "credits" }),
						loading: { title: "Loading credits...", detail: "Fetching the complete credit list." },
					}}
					renderItems={(items) => (
						<div className="divide-y divide-border">
							{items.map((credit) => (
								<CreditRow
									key={credit.id}
									credit={credit}
									fit={props.fit}
									aspect={props.aspect}
									purpose={props.purpose}
								/>
							))}
						</div>
					)}
				/>
			</div>
		</MediaDetailModalButton>
	);
}

function CreditRow(props: {
	readonly credit: MediaCreatorCredit;
	readonly aspect: MediaArtworkAspect;
	readonly purpose: MediaImagePurposes[number];
	readonly fit?: ComponentProps<typeof ManagedAssetImage>["fit"];
}) {
	const { credit } = props;
	const asset = mediaPosterAsset(credit, props.purpose);
	const lines = {
		roles: mediaRolesLabel(credit.roles),
		character: mediaCharacterLabel(credit.character ?? null),
		departments: mediaRolesLabel(credit.departments ?? null),
	};
	return (
		<PluginLink
			aria-label={`Open ${credit.name}`}
			to={{ kind: "entity", entityId: credit.id }}
			aria-description={credit.isInMediaLibrary ? "In your library" : undefined}
			className="flex items-center gap-3 rounded-lg py-3 focus-visible:outline-2 focus-visible:outline-accent"
		>
			<ManagedAssetImage
				asset={asset}
				fit={props.fit}
				monogram={credit.name}
				state={fieldSyncState(asset, credit)}
				className={clsx("w-12 shrink-0", mediaAspectClass(props.aspect))}
			/>
			<div className="flex min-w-0 flex-col gap-1">
				<MediaLibraryTitle
					name={credit.name}
					className="font-ui font-medium text-sm"
					isInMediaLibrary={credit.isInMediaLibrary}
				/>
				{Object.entries(lines).map(([key, line]) =>
					line === undefined ? null : (
						<p key={key} className="font-ui text-xs text-text-muted">
							{line}
						</p>
					),
				)}
			</div>
		</PluginLink>
	);
}
