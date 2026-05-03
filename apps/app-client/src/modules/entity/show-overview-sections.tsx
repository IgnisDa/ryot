import type { AssetLocator } from "@ryot/contract/modules/uploads/schemas";
import { Link } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { getEntityHref } from "@/modules/navigation/navigation-data";
import { assetLocatorKey } from "@/modules/ui/managed-assets";

import { ShowAssetImage } from "./show-image";
import {
	showCharacterLabel,
	showCompanyAsset,
	showPersonAsset,
	showRecommendationAsset,
	showRolesLabel,
	type ShowCompany,
	type ShowPerson,
	type ShowRecommendation,
} from "./show-overview-state";
import { ShowLinkButton, ShowOverviewSection } from "./show-primitives";

type ManagedUrls = ReadonlyMap<string, string>;

const CREDIT_COLUMN_CLASS = "md:min-w-0 md:flex-1 md:border-t-0 md:pt-0";

const COMPANY_COLUMN_CLASS = "md:w-72 md:shrink-0 md:border-t-0 md:pt-0";

function ShowRail(props: { readonly children: ReactNode }) {
	return (
		<ScrollView horizontal showsHorizontalScrollIndicator={false}>
			<View className="flex-row gap-3 md:gap-4">{props.children}</View>
		</ScrollView>
	);
}

export function ShowImageGallery(props: {
	readonly divided: boolean;
	readonly managedUrls: ManagedUrls;
	readonly assets: readonly AssetLocator[];
}) {
	if (props.assets.length === 0) {
		return null;
	}
	return (
		<ShowOverviewSection
			title="Images"
			divided={props.divided}
			action={
				<ShowLinkButton
					label="View all images"
					onPress={() => console.log("TODO: open image gallery")}
				/>
			}
		>
			<ShowRail>
				{props.assets.map((asset) => (
					<ShowAssetImage
						asset={asset}
						key={assetLocatorKey(asset)}
						managedUrls={props.managedUrls}
						className="aspect-video w-64 sm:w-72 md:w-96"
					/>
				))}
			</ShowRail>
		</ShowOverviewSection>
	);
}

export function ShowPeopleSection(props: {
	readonly divided: boolean;
	readonly managedUrls: ManagedUrls;
	readonly people: readonly ShowPerson[];
}) {
	if (props.people.length === 0) {
		return null;
	}
	return (
		<ShowOverviewSection
			title="Cast & crew"
			divided={props.divided}
			className={CREDIT_COLUMN_CLASS}
			action={
				<ShowLinkButton
					label="View all people"
					onPress={() => console.log("TODO: open all show credits")}
				/>
			}
		>
			<ShowRail>
				{props.people.map((person) => {
					const roles = showRolesLabel(person.roles);
					const character = showCharacterLabel(person.character);
					return (
						<View key={person.id} className="w-24 gap-2.5 md:w-28">
							<ShowAssetImage
								shape="circle"
								className="aspect-square w-full"
								asset={showPersonAsset(person)}
								managedUrls={props.managedUrls}
							/>
							<View className="gap-1">
								<Text
									numberOfLines={2}
									className="text-center font-ui-medium text-[13px] leading-4.5 text-text"
								>
									{person.name}
								</Text>
								{roles === undefined ? null : (
									<Text
										numberOfLines={1}
										className="text-center font-ui text-[11px] leading-3.75 text-text-subtle"
									>
										{roles}
									</Text>
								)}
								{character === undefined ? null : (
									<Text
										numberOfLines={1}
										className="text-center font-ui text-[11px] leading-3.75 text-text-muted"
									>
										{character}
									</Text>
								)}
							</View>
						</View>
					);
				})}
			</ShowRail>
		</ShowOverviewSection>
	);
}

export function ShowCompaniesSection(props: {
	readonly divided: boolean;
	readonly managedUrls: ManagedUrls;
	readonly companies: readonly ShowCompany[];
}) {
	if (props.companies.length === 0) {
		return null;
	}
	return (
		<ShowOverviewSection
			divided={props.divided}
			title="Production companies"
			className={COMPANY_COLUMN_CLASS}
		>
			<View className="gap-3.5">
				{props.companies.map((company) => {
					const roles = showRolesLabel(company.roles);
					return (
						<View key={company.id} className="flex-row items-center gap-3">
							<ShowAssetImage
								className="h-9 w-9 shrink-0"
								asset={showCompanyAsset(company)}
								managedUrls={props.managedUrls}
							/>
							<View className="min-w-0 flex-1">
								<Text
									numberOfLines={1}
									className="font-ui-medium text-[13px] leading-4.5 text-text"
								>
									{company.name}
								</Text>
								{roles === undefined ? null : (
									<Text
										numberOfLines={1}
										className="font-ui text-[11px] leading-3.75 text-text-subtle"
									>
										{roles}
									</Text>
								)}
							</View>
						</View>
					);
				})}
			</View>
		</ShowOverviewSection>
	);
}

export function ShowRecommendationsSection(props: {
	readonly divided: boolean;
	readonly managedUrls: ManagedUrls;
	readonly recommendations: readonly ShowRecommendation[];
}) {
	if (props.recommendations.length === 0) {
		return null;
	}
	return (
		<ShowOverviewSection
			title="More like this"
			divided={props.divided}
			action={
				<ShowLinkButton label="View all" onPress={() => console.log("TODO: open related tab")} />
			}
		>
			<ShowRail>
				{props.recommendations.map((recommendation) => (
					<Link asChild key={recommendation.id} href={getEntityHref(recommendation.id)}>
						<Pressable
							accessibilityRole="link"
							accessibilityLabel={`Open ${recommendation.name}`}
							className="w-28 gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-accent md:w-32"
						>
							<ShowAssetImage
								className="aspect-2/3 w-full"
								managedUrls={props.managedUrls}
								asset={showRecommendationAsset(recommendation)}
							/>
							<Text numberOfLines={2} className="font-ui text-[12px] leading-4.25 text-text">
								{recommendation.name}
							</Text>
						</Pressable>
					</Link>
				))}
			</ShowRail>
		</ShowOverviewSection>
	);
}
