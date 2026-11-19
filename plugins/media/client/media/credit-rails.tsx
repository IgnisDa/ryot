import type { LocalMessage } from "@ryot-app/plugin-client-sdk";
import { type Formatters, type RyotQuery, useFormatters } from "@ryot-app/plugin-client-sdk/react";

import type { MediaCreatorCredit } from "../../shared/creator-recipes";
import { type MediaText, useMediaMessages } from "../messages";
import { MediaCreditsButton } from "./credits";
import type { MediaCursorPage } from "./cursor-page-state";
import type { MediaArtworkAspect } from "./entity-presentation";
import { MediaEntityRailSection } from "./entity-rail";
import { collectManagedAssetLocators } from "./image";
import { mediaCharacterLabel, mediaCreditRolesLabel, mediaListLabel } from "./overview-state";
import { mediaPosterAsset } from "./summary-state";

export type MediaCreditSection<Slug extends string> = {
	readonly slug: Slug;
	readonly title: LocalMessage;
	readonly aspect: MediaArtworkAspect;
};

export type MediaCreditRailsOverview<Slug extends string> = {
	readonly [Key in Slug]: {
		readonly items: readonly MediaCreatorCredit[];
		readonly pageInfo: { readonly hasMore: boolean };
	};
};

export const mediaCreditItems = <Slug extends string>(overview: MediaCreditRailsOverview<Slug>) =>
	Object.values<MediaCreditRailsOverview<Slug>[Slug]>(overview).flatMap(({ items }) => items);

export const mediaCreditRailsAreEmpty = <Slug extends string>(
	overview: MediaCreditRailsOverview<Slug>,
) => mediaCreditItems(overview).length === 0;

export const mediaCreditRailsManagedAssets = <Slug extends string>(
	overview: MediaCreditRailsOverview<Slug>,
) => collectManagedAssetLocators(mediaCreditItems(overview).map((item) => mediaPosterAsset(item)));

const creditLines = (text: MediaText, formatters: Formatters) => (credit: MediaCreatorCredit) => [
	mediaCreditRolesLabel({ text, formatters }, credit),
	mediaCharacterLabel(text, credit.character ?? null),
	mediaListLabel(formatters, credit.departments ?? null),
];

export function MediaCreditRails<Slug extends string>(props: {
	readonly entityId: string;
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly overview: MediaCreditRailsOverview<Slug>;
	readonly sections: readonly MediaCreditSection<Slug>[];
	readonly creditsQuery: RyotQuery<
		{ readonly target: Slug; readonly entityId: string; readonly after: null | string },
		MediaCursorPage<MediaCreatorCredit>
	>;
}) {
	const text = useMediaMessages();
	const formatters = useFormatters();
	return props.sections.map((section) => {
		const credits = props.overview[section.slug];
		return (
			<MediaEntityRailSection
				key={section.slug}
				title={section.title}
				items={credits.items}
				compact={props.compact}
				aspect={() => section.aspect}
				lines={creditLines(text, formatters)}
				action={
					credits.pageInfo.hasMore ? (
						<MediaCreditsButton<{ readonly target: Slug }>
							kind="all"
							purpose="cover"
							title={section.title}
							compact={props.compact}
							aspect={section.aspect}
							query={props.creditsQuery}
							safeAreaTop={props.safeAreaTop}
							input={{ target: section.slug, entityId: props.entityId }}
						/>
					) : null
				}
			/>
		);
	});
}
