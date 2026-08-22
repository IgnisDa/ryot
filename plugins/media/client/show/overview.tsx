import { PluginLink } from "@ryot-app/client-sdk/plugin";
import clsx from "clsx";
import type { ReactNode } from "react";

import { imageAssetKey, ManagedAssetImage } from "./managed-assets";
import type { ShowImageAsset } from "./media-image";
import {
	showCharacterLabel,
	showCompanyAsset,
	showOverviewError,
	showOverviewIsEmpty,
	showPersonAsset,
	showRecommendationAsset,
	showRolesLabel,
	type ShowCompany,
	type ShowOverview as ShowOverviewData,
	type ShowOverviewState,
	type ShowPerson,
	type ShowRecommendation,
} from "./overview-state";
import { ShowLinkButton, ShowOverviewSection } from "./primitives";
import { showGalleryAssets, type ShowSummary } from "./summary-state";

const CREDIT_COLUMN_CLASS = "min-w-0 flex-1 border-t-0 pt-0";

const COMPANY_COLUMN_CLASS = "w-72 shrink-0 border-t-0 pt-0";

function ShowRail(props: { readonly compact: boolean; readonly children: ReactNode }) {
	return (
		<div className="overflow-x-auto">
			<div className={clsx("flex w-max", props.compact ? "gap-3" : "gap-4")}>{props.children}</div>
		</div>
	);
}

export function ShowImageGallery(props: {
	readonly compact: boolean;
	readonly divided: boolean;
	readonly assets: readonly ShowImageAsset[];
}) {
	if (props.assets.length === 0) {
		return null;
	}
	return (
		<ShowOverviewSection
			title="Images"
			divided={props.divided}
			compact={props.compact}
			action={
				<ShowLinkButton
					label="View all images"
					onClick={() => console.log("TODO: open image gallery")}
				/>
			}
		>
			<ShowRail compact={props.compact}>
				{props.assets.map((asset) => (
					<ManagedAssetImage
						asset={asset}
						key={imageAssetKey(asset)}
						className={clsx("aspect-video", props.compact ? "w-64" : "w-96")}
					/>
				))}
			</ShowRail>
		</ShowOverviewSection>
	);
}

export function ShowPeopleSection(props: {
	readonly compact: boolean;
	readonly divided: boolean;
	readonly people: readonly ShowPerson[];
}) {
	if (props.people.length === 0) {
		return null;
	}
	return (
		<ShowOverviewSection
			title="Cast & crew"
			divided={props.divided}
			compact={props.compact}
			className={props.compact ? undefined : CREDIT_COLUMN_CLASS}
			action={
				<ShowLinkButton
					label="View all people"
					onClick={() => console.log("TODO: open all show credits")}
				/>
			}
		>
			<ShowRail compact={props.compact}>
				{props.people.map((person) => {
					const roles = showRolesLabel(person.roles);
					const character = showCharacterLabel(person.character);
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
								asset={showPersonAsset(person)}
								className="aspect-square w-full"
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
			</ShowRail>
		</ShowOverviewSection>
	);
}

export function ShowCompaniesSection(props: {
	readonly compact: boolean;
	readonly divided: boolean;
	readonly companies: readonly ShowCompany[];
}) {
	if (props.companies.length === 0) {
		return null;
	}
	return (
		<ShowOverviewSection
			divided={props.divided}
			compact={props.compact}
			title="Production companies"
			className={props.compact ? undefined : COMPANY_COLUMN_CLASS}
		>
			<div className="flex flex-col gap-3.5">
				{props.companies.map((company) => {
					const roles = showRolesLabel(company.roles);
					return (
						<PluginLink
							key={company.id}
							aria-label={`Open ${company.name}`}
							to={{ kind: "entity", entityId: company.id }}
							className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
						>
							<ManagedAssetImage className="h-9 w-9 shrink-0" asset={showCompanyAsset(company)} />
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
		</ShowOverviewSection>
	);
}

export function ShowRecommendationsSection(props: {
	readonly compact: boolean;
	readonly divided: boolean;
	readonly recommendations: readonly ShowRecommendation[];
}) {
	if (props.recommendations.length === 0) {
		return null;
	}
	return (
		<ShowOverviewSection title="More like this" divided={props.divided} compact={props.compact}>
			<ShowRail compact={props.compact}>
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
							asset={showRecommendationAsset(recommendation)}
						/>
						<p className="line-clamp-2 font-ui text-[12px] leading-4.25 text-text">
							{recommendation.name}
						</p>
					</PluginLink>
				))}
			</ShowRail>
		</ShowOverviewSection>
	);
}

function ShowOverviewNotice(props: {
	readonly title: string;
	readonly detail: string;
	readonly compact: boolean;
	readonly divided: boolean;
	readonly onRetry?: () => void;
}) {
	return (
		<ShowOverviewSection
			divided={props.divided}
			compact={props.compact}
			title="Cast, companies and recommendations"
		>
			<div className="flex flex-col items-start gap-2">
				<p className="font-ui text-[13px] text-text-muted">{props.title}</p>
				<p className="max-w-xl font-ui text-[13px] text-text-subtle">{props.detail}</p>
				{props.onRetry === undefined ? null : (
					<ShowLinkButton label="Try again" onClick={props.onRetry} />
				)}
			</div>
		</ShowOverviewSection>
	);
}

function ShowOverviewRelations(props: {
	readonly compact: boolean;
	readonly divided: boolean;
	readonly overview: ShowOverviewData;
}) {
	if (showOverviewIsEmpty(props.overview)) {
		return null;
	}
	const { companies, people, recommendations } = props.overview;
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
				<ShowPeopleSection people={people.items} compact={props.compact} divided={props.divided} />
				<ShowCompaniesSection
					compact={props.compact}
					companies={companies.items}
					divided={props.divided || people.items.length > 0}
				/>
			</div>
			<ShowRecommendationsSection
				compact={props.compact}
				divided={props.divided || hasCredits}
				recommendations={recommendations.items}
			/>
		</>
	);
}

function ShowOverviewBody(props: {
	readonly compact: boolean;
	readonly divided: boolean;
	readonly refresh: () => void;
	readonly state: ShowOverviewState;
}) {
	const { state } = props;
	if (state.status === "loading") {
		return (
			<ShowOverviewNotice
				divided={props.divided}
				compact={props.compact}
				title="Loading details..."
				detail="Fetching the cast, companies and recommendations for this show."
			/>
		);
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		return (
			<ShowOverviewNotice
				divided={props.divided}
				compact={props.compact}
				onRetry={props.refresh}
				{...showOverviewError(state)}
			/>
		);
	}
	return (
		<ShowOverviewRelations
			compact={props.compact}
			divided={props.divided}
			overview={state.overview}
		/>
	);
}

export function ShowOverview(props: {
	readonly compact: boolean;
	readonly show: ShowSummary;
	readonly refreshOverview: () => void;
	readonly overview: ShowOverviewState;
}) {
	const gallery = showGalleryAssets(props.show);
	return (
		<div className={clsx("flex flex-col", props.compact ? "gap-7 pt-6" : "gap-9 pt-8")}>
			<ShowImageGallery divided={false} assets={gallery} compact={props.compact} />
			<ShowOverviewBody
				state={props.overview}
				compact={props.compact}
				divided={gallery.length > 0}
				refresh={props.refreshOverview}
			/>
		</div>
	);
}
