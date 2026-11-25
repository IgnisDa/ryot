import type { LocalMessage } from "@ryot-app/plugin-client-sdk";
import { PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import {
	AssetArtWell,
	assetKey,
	collectManagedAssetLocators,
	ManagedAssetProvider,
	type Text,
	useFormatters,
	usePluginIdentity,
	usePluginUserSettings,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, Shelf } from "@ryot-app/plugin-ui-sdk";
import { fieldSyncState, isEnrichmentActive } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import { type ReactNode, useRef, useState } from "react";

import type { MediaOverviewRows } from "../../shared/media-recipes";
import { catalogMessage } from "../../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { useMediaCopy, useMediaMessages } from "../messages";
import type { MediaStatusCopy } from "./detail-screen";
import { useMediaEnrichment } from "./enrichment";
import type { MediaArtworkAspect } from "./entity-presentation";
import { MediaEntityRailSection } from "./entity-rail";
import { imageRendition } from "./image";
import { MediaEntityImageGallery } from "./image-gallery";
import { MediaLibraryTitle } from "./library-title";
import {
	mediaCharacterLabel,
	type MediaCompany,
	mediaCompanyAsset,
	type MediaCreditPerson,
	mediaCreditRolesLabel,
	mediaListLabel,
	mediaOverviewError,
	type MediaOverviewState,
	mediaPersonAsset,
	type MediaRecommendation,
	type MediaUnlinkedCreator,
	mediaUnlinkedCreatorKey,
	mediaUnlinkedCredits,
	mediaUnlinkedRoleLabel,
} from "./overview-state";
import {
	MediaExternalLink,
	MediaOverviewSection,
	mediaShelfIcons,
	MediaStatusMessage,
} from "./primitives";
import { mediaGalleryPreview, type MediaSummaryFields } from "./summary-state";
import { mediaSyncCounts } from "./sync-counts";
import {
	type MediaWatchProviders,
	regionLabel,
	viewerRegion,
	watchProviderAsset,
	type WatchProviderGroup,
	watchProviderGroups,
	watchProviderLink,
} from "./watch-providers";

const CREDIT_COLUMN_CLASS = "min-w-0 flex-1";

const COMPANY_COLUMN_CLASS = "w-72 shrink-0";

export type MediaCreditCopy = {
	readonly people: LocalMessage;
	readonly notice: LocalMessage;
	readonly companies: LocalMessage;
};

export type MediaOverviewSubject = Parameters<typeof mediaGalleryPreview>[0] &
	Pick<MediaSummaryFields, "id" | "name" | "imageCount" | "relatedPopulationStatus">;

export type MediaOverviewRelationsRender<Overview> = (input: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly overview: Overview;
	readonly safeAreaTop: number;
}) => ReactNode;

export function MediaWatchProvidersSection(props: {
	readonly region: string;
	readonly compact: boolean;
	readonly link: string | undefined;
	readonly groups: readonly WatchProviderGroup[];
}) {
	const formatters = useFormatters();
	const text = useMediaMessages();
	if (props.groups.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection
			title={text("overview.where-to-watch")}
			action={
				props.link === undefined ? null : (
					<MediaExternalLink href={props.link} label={text("overview.view-all-options")} />
				)
			}
		>
			<div className="flex flex-col gap-5">
				{props.groups.map((group) => (
					<div key={group.offer} className="flex flex-col gap-2.5">
						<p className="font-ui font-medium text-[12px] text-text-subtle">
							{text("watch.offer", { offer: group.offer })}
						</p>
						<Shelf
							compact={props.compact}
							icons={mediaShelfIcons}
							label={text("watch.offer", { offer: group.offer })}
						>
							{group.providers.map((provider) => (
								<div
									key={provider.name}
									className={clsx("flex flex-col gap-2", props.compact ? "w-20" : "w-24")}
								>
									<AssetArtWell
										state="ready"
										monogram={provider.name}
										className="aspect-square w-full"
										asset={watchProviderAsset(provider)}
									/>
									<p className="line-clamp-2 text-center font-ui text-[12px] leading-4.25 text-text">
										{provider.name}
									</p>
								</div>
							))}
						</Shelf>
					</div>
				))}
				<p className="font-ui text-[11px] leading-3.75 text-text-subtle">
					{text("overview.availability", { region: regionLabel(formatters, props.region) })}
				</p>
			</div>
		</MediaOverviewSection>
	);
}

function MediaRegionWatchProvidersSection(props: {
	readonly compact: boolean;
	readonly media: MediaWatchProviders;
}) {
	const settings = usePluginUserSettings(usePluginIdentity(PLUGIN_PACKAGE_ID).pluginId);
	if (settings.data === undefined) {
		return null;
	}
	const region = viewerRegion(settings.data);
	if (region === undefined) {
		return null;
	}
	return (
		<MediaWatchProvidersSection
			region={region}
			compact={props.compact}
			link={watchProviderLink(props.media, region)}
			groups={watchProviderGroups(props.media, region)}
		/>
	);
}

function MediaImageGallerySection(props: {
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly media: MediaOverviewSubject;
}) {
	const text = useMediaMessages();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [galleryOpen, setGalleryOpen] = useState(false);
	const { media, compact } = props;
	const preview = mediaGalleryPreview(media);
	if (media.imageCount === 0) {
		return null;
	}
	return (
		<MediaOverviewSection
			title={text("property.images")}
			action={
				<Button variant="link" ref={triggerRef} onClick={() => setGalleryOpen(true)}>
					{text("overview.view-all-images")}
				</Button>
			}
		>
			<ManagedAssetProvider assets={collectManagedAssetLocators(preview)}>
				{preview.length > 0 && (
					<Shelf compact={compact} icons={mediaShelfIcons} label={text("property.images")}>
						{preview.map((asset) => (
							<AssetArtWell
								monogram={media.name}
								key={assetKey(asset)}
								asset={imageRendition(asset, "thumbnail")}
								className={clsx("aspect-video", compact ? "w-64" : "w-96")}
							/>
						))}
					</Shelf>
				)}
				{galleryOpen && (
					<MediaEntityImageGallery
						name={media.name}
						compact={compact}
						entityId={media.id}
						triggerRef={triggerRef}
						safeAreaTop={props.safeAreaTop}
						onClose={() => setGalleryOpen(false)}
					/>
				)}
			</ManagedAssetProvider>
		</MediaOverviewSection>
	);
}

export const mediaWatchProvidersTrailing =
	<Summary,>(select: (summary: Summary) => MediaWatchProviders) =>
	(input: { readonly summary: Summary; readonly compact: boolean }) => (
		<MediaRegionWatchProvidersSection compact={input.compact} media={select(input.summary)} />
	);

export function MediaRecommendationsSection(props: {
	readonly compact: boolean;
	readonly aspect: MediaArtworkAspect;
	readonly recommendations: readonly MediaRecommendation[];
}) {
	return (
		<MediaEntityRailSection
			compact={props.compact}
			aspect={() => props.aspect}
			items={props.recommendations}
			title={catalogMessage("overview.more-like-this")}
		/>
	);
}

export function MediaOverviewRelations(props: {
	readonly compact: boolean;
	readonly trailing?: ReactNode;
	readonly copy: MediaCreditCopy;
	readonly peopleAction: ReactNode;
	readonly aspect: MediaArtworkAspect;
	readonly companiesAction?: ReactNode;
	readonly overview: MediaOverviewRows;
	readonly unlinked?: undefined | readonly MediaUnlinkedCreator[];
}) {
	const { people, companies, recommendations } = props.overview;
	return (
		<>
			<MediaCreditColumns
				copy={props.copy}
				people={people.items}
				compact={props.compact}
				unlinked={props.unlinked}
				companies={companies.items}
				peopleAction={props.peopleAction}
				companiesAction={props.companiesAction}
			/>
			<MediaRecommendationsSection
				aspect={props.aspect}
				compact={props.compact}
				recommendations={recommendations.items}
			/>
			{props.trailing}
		</>
	);
}

export function MediaCreditColumns(props: {
	readonly compact: boolean;
	readonly copy: MediaCreditCopy;
	readonly peopleAction: ReactNode;
	readonly companiesAction?: ReactNode;
	readonly companies: readonly MediaCompany[];
	readonly people: readonly MediaCreditPerson[];
	readonly unlinked?: undefined | readonly MediaUnlinkedCreator[];
}) {
	const { local } = useMediaCopy();
	const unlinked = mediaUnlinkedCredits(props.unlinked ?? []);
	if (
		props.people.length +
			props.companies.length +
			unlinked.people.length +
			unlinked.companies.length ===
		0
	) {
		return null;
	}
	return (
		<div className={clsx("flex", props.compact ? "flex-col gap-8" : "flex-row gap-10")}>
			<MediaPeopleSection
				people={props.people}
				compact={props.compact}
				unlinked={unlinked.people}
				action={props.peopleAction}
				title={local(props.copy.people)}
			/>
			<MediaCompaniesSection
				compact={props.compact}
				companies={props.companies}
				unlinked={unlinked.companies}
				action={props.companiesAction}
				title={local(props.copy.companies)}
			/>
		</div>
	);
}

export function MediaOverview<Overview>(props: {
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly noticeTitle: LocalMessage;
	readonly refreshStatus?: ReactNode;
	readonly loadingDetail: LocalMessage;
	readonly refreshOverview: () => void;
	readonly media: MediaOverviewSubject;
	readonly empty?: undefined | MediaStatusCopy;
	readonly overview: MediaOverviewState<Overview>;
	readonly isEmpty: (overview: Overview) => boolean;
	readonly relations: MediaOverviewRelationsRender<Overview>;
	readonly trailing?: undefined | ((input: { readonly compact: boolean }) => ReactNode);
}) {
	const related = props.media.relatedPopulationStatus;
	const relations =
		isEnrichmentActive(related) ||
		related.state === "failed" ||
		props.overview.status !== "ready" ||
		!props.isEmpty(props.overview.overview);
	if (props.empty !== undefined && !relations && props.media.imageCount === 0) {
		return (
			<>
				{props.refreshStatus}
				<MediaStatusMessage title={props.empty.title} detail={props.empty.detail} />
			</>
		);
	}
	return (
		<div className="grid grid-cols-[minmax(0,1fr)] gap-8">
			{props.refreshStatus}
			<MediaImageGallerySection
				media={props.media}
				compact={props.compact}
				safeAreaTop={props.safeAreaTop}
			/>
			<MediaOverviewBody
				related={related}
				state={props.overview}
				compact={props.compact}
				entityId={props.media.id}
				relations={props.relations}
				safeAreaTop={props.safeAreaTop}
				noticeTitle={props.noticeTitle}
				refresh={props.refreshOverview}
				loadingDetail={props.loadingDetail}
			/>
			{props.trailing?.({ compact: props.compact })}
		</div>
	);
}

export function MediaOverviewBody<Overview>(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly safeAreaTop: number;
	readonly refresh: () => void;
	readonly noticeTitle: LocalMessage;
	readonly loadingDetail: LocalMessage;
	readonly state: MediaOverviewState<Overview>;
	readonly relations: MediaOverviewRelationsRender<Overview>;
	readonly related: MediaOverviewSubject["relatedPopulationStatus"];
}) {
	const { state } = props;
	const { text, local } = useMediaCopy();
	const noticeTitle = local(props.noticeTitle);
	const loadingDetail = local(props.loadingDetail);
	let notice: ReactNode = null;
	if (props.related.state === "failed") {
		notice = <MediaRelatedPopulationFailure entityId={props.entityId} noticeTitle={noticeTitle} />;
	} else if (isEnrichmentActive(props.related)) {
		notice = (
			<MediaOverviewNotice
				title={noticeTitle}
				detail={loadingDetail}
				status={text("summary.loading-title")}
			/>
		);
	}
	if (state.status === "loading") {
		return (
			notice ?? (
				<MediaOverviewNotice
					title={noticeTitle}
					detail={loadingDetail}
					status={
						props.related.state === "idle" && props.related.availability === "missing"
							? text("overview.not-loaded")
							: text("summary.loading-title")
					}
				/>
			)
		);
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		const error = mediaOverviewError(text, state, noticeTitle);
		return (
			<MediaOverviewNotice
				title={noticeTitle}
				status={error.title}
				detail={error.detail}
				onRetry={props.refresh}
			/>
		);
	}
	return (
		<>
			{notice}
			{props.relations({
				compact: props.compact,
				entityId: props.entityId,
				overview: state.overview,
				safeAreaTop: props.safeAreaTop,
			})}
		</>
	);
}

export function MediaCompaniesSection(props: {
	readonly title: Text;
	readonly compact: boolean;
	readonly action?: ReactNode;
	readonly companies: readonly MediaCompany[];
	readonly unlinked?: undefined | readonly MediaUnlinkedCreator[];
}) {
	const unlinked = props.unlinked ?? [];
	const text = useMediaMessages();
	const formatters = useFormatters();
	if (props.companies.length === 0 && unlinked.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection
			title={props.title}
			action={props.action}
			sync={mediaSyncCounts(props.companies, mediaCompanyAsset)}
			className={props.compact ? undefined : COMPANY_COLUMN_CLASS}
		>
			<div className="flex flex-col gap-3.5">
				{props.companies.map((company) => {
					const roles = mediaCreditRolesLabel({ text, formatters }, company);
					return (
						<PluginLink
							key={company.id}
							to={{ kind: "entity", entityId: company.id }}
							aria-label={text("common.open-named", { name: company.name })}
							aria-description={company.isInMediaLibrary ? text("library.in-library") : undefined}
							className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
						>
							<AssetArtWell
								fit="contain"
								monogram={company.name}
								className="h-9 w-9 shrink-0"
								asset={mediaCompanyAsset(company)}
								state={fieldSyncState(mediaCompanyAsset(company), company)}
							/>
							<div className="flex min-w-0 flex-1 flex-col">
								<MediaLibraryTitle
									name={company.name}
									isInMediaLibrary={company.isInMediaLibrary}
									className="line-clamp-1 font-ui font-medium text-[13px] leading-4.5"
								/>
								{roles === undefined ? null : (
									<p className="line-clamp-1 font-ui text-[11px] leading-3.75 text-text-subtle">
										{roles}
									</p>
								)}
							</div>
						</PluginLink>
					);
				})}
				{unlinked.map((creator) => (
					<div className="flex items-center gap-3" key={mediaUnlinkedCreatorKey(creator)}>
						<AssetArtWell
							state="ready"
							asset={undefined}
							monogram={creator.name}
							className="h-9 w-9 shrink-0"
						/>
						<div className="flex min-w-0 flex-1 flex-col">
							<p className="line-clamp-1 font-ui font-medium text-[13px] leading-4.5 text-text">
								{creator.name}
							</p>
							<p className="line-clamp-1 font-ui text-[11px] leading-3.75 text-text-subtle">
								{mediaUnlinkedRoleLabel(text, creator)}
							</p>
						</div>
					</div>
				))}
			</div>
		</MediaOverviewSection>
	);
}

export function MediaPeopleSection(props: {
	readonly title: Text;
	readonly compact: boolean;
	readonly action: ReactNode;
	readonly people: readonly MediaCreditPerson[];
	readonly unlinked?: undefined | readonly MediaUnlinkedCreator[];
}) {
	const unlinked = props.unlinked ?? [];
	const text = useMediaMessages();
	const formatters = useFormatters();
	if (props.people.length === 0 && unlinked.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection
			title={props.title}
			action={props.action}
			sync={mediaSyncCounts(props.people, mediaPersonAsset)}
			className={props.compact ? undefined : CREDIT_COLUMN_CLASS}
		>
			<Shelf label={props.title} compact={props.compact} icons={mediaShelfIcons}>
				{props.people.map((person) => {
					const roles = mediaCreditRolesLabel({ text, formatters }, person);
					const departments = mediaListLabel(formatters, person.departments ?? null);
					const character = mediaCharacterLabel(text, person.character ?? null);
					return (
						<PluginLink
							key={person.id}
							to={{ kind: "entity", entityId: person.id }}
							aria-label={text("common.open-named", { name: person.name })}
							aria-description={person.isInMediaLibrary ? text("library.in-library") : undefined}
							className={clsx(
								"flex flex-col gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-accent",
								props.compact ? "w-24" : "w-28",
							)}
						>
							<AssetArtWell
								shape="circle"
								monogram={person.name}
								asset={mediaPersonAsset(person)}
								className="aspect-square w-full"
								state={fieldSyncState(mediaPersonAsset(person), person)}
							/>
							<div className="flex flex-col gap-1">
								<MediaLibraryTitle
									name={person.name}
									isInMediaLibrary={person.isInMediaLibrary}
									className="line-clamp-2 text-center font-ui font-medium text-[13px] leading-4.5"
								/>
								{roles === undefined ? null : (
									<p className="line-clamp-1 text-center font-ui text-[11px] leading-3.75 text-text-subtle">
										{roles}
									</p>
								)}
								{character === undefined ? null : (
									<p className="line-clamp-1 text-center font-ui text-[11px] leading-3.75 text-text-muted">
										{character}
									</p>
								)}
								{departments === undefined ? null : (
									<p className="line-clamp-1 text-center font-ui text-[11px] text-text-muted">
										{departments}
									</p>
								)}
							</div>
						</PluginLink>
					);
				})}
				{unlinked.map((creator) => (
					<div
						key={mediaUnlinkedCreatorKey(creator)}
						className={clsx("flex flex-col gap-2.5", props.compact ? "w-24" : "w-28")}
					>
						<AssetArtWell
							state="ready"
							shape="circle"
							asset={undefined}
							monogram={creator.name}
							className="aspect-square w-full"
						/>
						<div className="flex flex-col gap-1">
							<p className="line-clamp-2 text-center font-ui font-medium text-[13px] leading-4.5 text-text">
								{creator.name}
							</p>
							<p className="line-clamp-1 text-center font-ui text-[11px] leading-3.75 text-text-subtle">
								{mediaUnlinkedRoleLabel(text, creator)}
							</p>
						</div>
					</div>
				))}
			</Shelf>
		</MediaOverviewSection>
	);
}

function MediaRelatedPopulationFailure(props: {
	readonly entityId: string;
	readonly noticeTitle: Text;
}) {
	const text = useMediaMessages();
	const retry = useMediaEnrichment(props.entityId, "population", "retry");
	return (
		<MediaOverviewNotice
			title={props.noticeTitle}
			status={text("overview.population-failed")}
			detail={text("overview.population-failed-detail", { subject: props.noticeTitle })}
			{...(retry.isPending ? {} : { onRetry: retry.submit })}
		/>
	);
}

function MediaOverviewNotice(props: {
	readonly title: Text;
	readonly detail: Text;
	readonly status: string;
	readonly onRetry?: () => void;
}) {
	const text = useMediaMessages();
	return (
		<MediaOverviewSection title={props.title}>
			<div className="flex flex-col items-start gap-2">
				<p className="font-ui text-[13px] text-text-muted">{props.status}</p>
				<p className="max-w-xl font-ui text-[13px] text-text-subtle">{props.detail}</p>
				{props.onRetry === undefined ? null : (
					<Button variant="link" onClick={props.onRetry}>
						{text("common.action.try-again")}
					</Button>
				)}
			</div>
		</MediaOverviewSection>
	);
}
