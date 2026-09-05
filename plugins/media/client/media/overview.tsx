import { PluginLink } from "@ryot-app/client-sdk/plugin";
import { fieldSyncState } from "@ryot-app/client-ui-sdk/sync";
import clsx from "clsx";
import { useMemo, useRef, useState, type ReactNode } from "react";

import type { MediaOverviewRows } from "../../shared/media-recipes";
import type { MediaGalleryImage, MediaImageAsset } from "./image";
import { MediaImageGallery } from "./image-gallery";
import { galleryImages } from "./image-gallery-state";
import { imageAssetKey, ManagedAssetImage } from "./managed-assets";
import {
	mediaCharacterLabel,
	mediaCompanyAsset,
	mediaOverviewError,
	mediaPersonAsset,
	mediaRecommendationAsset,
	mediaRolesLabel,
	type MediaCompany,
	type MediaOverviewState,
	type MediaPerson,
	type MediaRecommendation,
} from "./overview-state";
import { MediaExternalLink, MediaLinkButton, MediaOverviewSection } from "./primitives";
import { mediaGalleryAssets, type MediaSummaryFields } from "./summary-state";
import { mediaSyncCounts } from "./sync-counts";
import {
	regionLabel,
	viewerRegion,
	watchProviderAsset,
	watchProviderGroups,
	watchProviderLink,
	type WatchProviderGroup,
} from "./watch-providers";

const CREDIT_COLUMN_CLASS = "min-w-0 flex-1 border-t-0 pt-0";

const COMPANY_COLUMN_CLASS = "w-72 shrink-0 border-t-0 pt-0";

export type MediaOverviewSubject = Pick<MediaSummaryFields, "name" | "images" | "watchProviders">;

export type MediaOverviewRelationsRender<Overview> = (input: {
	readonly compact: boolean;
	readonly divided: boolean;
	readonly overview: Overview;
}) => ReactNode;

export function MediaRail(props: { readonly compact: boolean; readonly children: ReactNode }) {
	return (
		<div className="overflow-x-auto">
			<div className={clsx("flex w-max", props.compact ? "gap-3" : "gap-4")}>{props.children}</div>
		</div>
	);
}

export function MediaImageGallerySection(props: {
	readonly name: string;
	readonly compact: boolean;
	readonly divided: boolean;
	readonly assets: readonly MediaImageAsset[];
	readonly images: readonly MediaGalleryImage[];
}) {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [galleryOpen, setGalleryOpen] = useState(false);
	if (props.assets.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection
			title="Images"
			divided={props.divided}
			compact={props.compact}
			action={
				<MediaLinkButton
					ref={triggerRef}
					label="View all images"
					onClick={() => setGalleryOpen(true)}
				/>
			}
		>
			<MediaRail compact={props.compact}>
				{props.assets.map((asset) => (
					<ManagedAssetImage
						state="ready"
						asset={asset}
						monogram={props.name}
						key={imageAssetKey(asset)}
						className={clsx("aspect-video", props.compact ? "w-64" : "w-96")}
					/>
				))}
			</MediaRail>
			{galleryOpen && (
				<MediaImageGallery
					name={props.name}
					images={props.images}
					triggerRef={triggerRef}
					compact={props.compact}
					onClose={() => setGalleryOpen(false)}
				/>
			)}
		</MediaOverviewSection>
	);
}

export function MediaWatchProvidersSection(props: {
	readonly region: string;
	readonly compact: boolean;
	readonly divided: boolean;
	readonly link: string | undefined;
	readonly groups: readonly WatchProviderGroup[];
}) {
	if (props.groups.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection
			title="Where to watch"
			divided={props.divided}
			compact={props.compact}
			action={
				props.link === undefined ? null : (
					<MediaExternalLink href={props.link} label="View all options" />
				)
			}
		>
			<div className="flex flex-col gap-5">
				{props.groups.map((group) => (
					<div key={group.offer} className="flex flex-col gap-2.5">
						<p className="font-ui font-medium text-[12px] text-text-subtle">{group.label}</p>
						<MediaRail compact={props.compact}>
							{group.providers.map((provider) => (
								<div
									key={provider.name}
									className={clsx("flex flex-col gap-2", props.compact ? "w-20" : "w-24")}
								>
									<ManagedAssetImage
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
						</MediaRail>
					</div>
				))}
				<p className="font-ui text-[11px] leading-3.75 text-text-subtle">
					{`Availability in ${regionLabel(props.region)}, from JustWatch.`}
				</p>
			</div>
		</MediaOverviewSection>
	);
}

export function MediaPeopleSection(props: {
	readonly compact: boolean;
	readonly divided: boolean;
	readonly onViewAll: () => void;
	readonly people: readonly MediaPerson[];
}) {
	if (props.people.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection
			title="Cast & crew"
			divided={props.divided}
			compact={props.compact}
			sync={mediaSyncCounts(props.people, mediaPersonAsset)}
			className={props.compact ? undefined : CREDIT_COLUMN_CLASS}
			action={<MediaLinkButton label="View all people" onClick={props.onViewAll} />}
		>
			<MediaRail compact={props.compact}>
				{props.people.map((person) => {
					const roles = mediaRolesLabel(person.roles);
					const character = mediaCharacterLabel(person.character);
					return (
						<PluginLink
							key={person.id}
							aria-label={`Open ${person.name}`}
							to={{ kind: "entity", entityId: person.id }}
							className={clsx(
								"flex flex-col gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-accent",
								props.compact ? "w-24" : "w-28",
							)}
						>
							<ManagedAssetImage
								shape="circle"
								monogram={person.name}
								asset={mediaPersonAsset(person)}
								className="aspect-square w-full"
								state={fieldSyncState(mediaPersonAsset(person), person)}
							/>
							<div className="flex flex-col gap-1">
								<p className="line-clamp-2 text-center font-ui font-medium text-[13px] leading-4.5 text-text">
									{person.name}
								</p>
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
							</div>
						</PluginLink>
					);
				})}
			</MediaRail>
		</MediaOverviewSection>
	);
}

export function MediaCompaniesSection(props: {
	readonly compact: boolean;
	readonly divided: boolean;
	readonly companies: readonly MediaCompany[];
}) {
	if (props.companies.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection
			divided={props.divided}
			compact={props.compact}
			title="Production companies"
			sync={mediaSyncCounts(props.companies, mediaCompanyAsset)}
			className={props.compact ? undefined : COMPANY_COLUMN_CLASS}
		>
			<div className="flex flex-col gap-3.5">
				{props.companies.map((company) => {
					const roles = mediaRolesLabel(company.roles);
					return (
						<PluginLink
							key={company.id}
							aria-label={`Open ${company.name}`}
							to={{ kind: "entity", entityId: company.id }}
							className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
						>
							<ManagedAssetImage
								monogram={company.name}
								className="h-9 w-9 shrink-0"
								asset={mediaCompanyAsset(company)}
								state={fieldSyncState(mediaCompanyAsset(company), company)}
							/>
							<div className="flex min-w-0 flex-1 flex-col">
								<p className="line-clamp-1 font-ui font-medium text-[13px] leading-4.5 text-text">
									{company.name}
								</p>
								{roles === undefined ? null : (
									<p className="line-clamp-1 font-ui text-[11px] leading-3.75 text-text-subtle">
										{roles}
									</p>
								)}
							</div>
						</PluginLink>
					);
				})}
			</div>
		</MediaOverviewSection>
	);
}

export function MediaRecommendationsSection(props: {
	readonly compact: boolean;
	readonly divided: boolean;
	readonly recommendations: readonly MediaRecommendation[];
}) {
	if (props.recommendations.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection
			title="More like this"
			divided={props.divided}
			compact={props.compact}
			sync={mediaSyncCounts(props.recommendations, mediaRecommendationAsset)}
		>
			<MediaRail compact={props.compact}>
				{props.recommendations.map((recommendation) => (
					<PluginLink
						key={recommendation.id}
						aria-label={`Open ${recommendation.name}`}
						to={{ kind: "entity", entityId: recommendation.id }}
						className={clsx(
							"flex flex-col gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-accent",
							props.compact ? "w-28" : "w-32",
						)}
					>
						<ManagedAssetImage
							className="aspect-2/3 w-full"
							monogram={recommendation.name}
							asset={mediaRecommendationAsset(recommendation)}
							state={fieldSyncState(mediaRecommendationAsset(recommendation), recommendation)}
						/>
						<p className="line-clamp-2 font-ui text-[12px] leading-4.25 text-text">
							{recommendation.name}
						</p>
					</PluginLink>
				))}
			</MediaRail>
		</MediaOverviewSection>
	);
}

function MediaOverviewNotice(props: {
	readonly title: string;
	readonly detail: string;
	readonly compact: boolean;
	readonly divided: boolean;
	readonly onRetry?: () => void;
}) {
	return (
		<MediaOverviewSection
			divided={props.divided}
			compact={props.compact}
			title="Cast, companies and recommendations"
		>
			<div className="flex flex-col items-start gap-2">
				<p className="font-ui text-[13px] text-text-muted">{props.title}</p>
				<p className="max-w-xl font-ui text-[13px] text-text-subtle">{props.detail}</p>
				{props.onRetry === undefined ? null : (
					<MediaLinkButton label="Try again" onClick={props.onRetry} />
				)}
			</div>
		</MediaOverviewSection>
	);
}

export function MediaOverviewRelations(props: {
	readonly compact: boolean;
	readonly divided: boolean;
	readonly trailing?: ReactNode;
	readonly onViewAllPeople: () => void;
	readonly overview: MediaOverviewRows;
}) {
	const { people, companies, recommendations } = props.overview;
	const hasCredits = people.items.length > 0 || companies.items.length > 0;
	return (
		<>
			<div
				className={clsx(
					"flex gap-7",
					props.compact ? "flex-col" : "flex-row gap-10",
					!props.compact && hasCredits && "pt-5",
					!props.compact && hasCredits && props.divided && "border-t border-border",
				)}
			>
				<MediaPeopleSection
					people={people.items}
					compact={props.compact}
					divided={props.divided}
					onViewAll={props.onViewAllPeople}
				/>
				<MediaCompaniesSection
					compact={props.compact}
					companies={companies.items}
					divided={props.divided || people.items.length > 0}
				/>
			</div>
			<MediaRecommendationsSection
				compact={props.compact}
				divided={props.divided || hasCredits}
				recommendations={recommendations.items}
			/>
			{props.trailing}
		</>
	);
}

function MediaOverviewBody<Overview>(props: {
	readonly compact: boolean;
	readonly divided: boolean;
	readonly refresh: () => void;
	readonly loadingDetail: string;
	readonly state: MediaOverviewState<Overview>;
	readonly relations: MediaOverviewRelationsRender<Overview>;
}) {
	const { state } = props;
	if (state.status === "loading") {
		return (
			<MediaOverviewNotice
				divided={props.divided}
				compact={props.compact}
				title="Loading details..."
				detail={props.loadingDetail}
			/>
		);
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		return (
			<MediaOverviewNotice
				divided={props.divided}
				compact={props.compact}
				onRetry={props.refresh}
				{...mediaOverviewError(state)}
			/>
		);
	}
	return props.relations({
		compact: props.compact,
		divided: props.divided,
		overview: state.overview,
	});
}

export function MediaOverview<Overview>(props: {
	readonly compact: boolean;
	readonly loadingDetail: string;
	readonly refreshStatus?: ReactNode;
	readonly refreshOverview: () => void;
	readonly media: MediaOverviewSubject;
	readonly isEmpty: (overview: Overview) => boolean;
	readonly overview: MediaOverviewState<Overview>;
	readonly relations: MediaOverviewRelationsRender<Overview>;
}) {
	const region = useMemo(viewerRegion, []);
	const gallery = mediaGalleryAssets(props.media);
	const relations = props.overview.status !== "ready" || !props.isEmpty(props.overview.overview);
	return (
		<div className={clsx("flex flex-col", props.compact ? "gap-7 pt-6" : "gap-9 pt-8")}>
			{props.refreshStatus}
			<MediaImageGallerySection
				divided={false}
				assets={gallery}
				name={props.media.name}
				compact={props.compact}
				images={galleryImages(props.media.images)}
			/>
			<MediaOverviewBody
				state={props.overview}
				compact={props.compact}
				relations={props.relations}
				divided={gallery.length > 0}
				refresh={props.refreshOverview}
				loadingDetail={props.loadingDetail}
			/>
			{region === undefined ? null : (
				<MediaWatchProvidersSection
					region={region}
					compact={props.compact}
					divided={gallery.length > 0 || relations}
					link={watchProviderLink(props.media, region)}
					groups={watchProviderGroups(props.media, region)}
				/>
			)}
		</div>
	);
}
