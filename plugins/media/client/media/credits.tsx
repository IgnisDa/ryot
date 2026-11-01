import { type PluginIdentityReference, PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery, type RyotQuery } from "@ryot-app/plugin-client-sdk/react";
import type { PreparedRecipe } from "@ryot-app/plugin-client-sdk/ryotql";
import { Select } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { fieldSyncState } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import { type ComponentProps, useState } from "react";

import type { MediaCreatorCredit } from "../../shared/creator-recipes";
import type { MediaCreditFilters } from "../../shared/media-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { type MediaCursorPage, mediaCursorPageError } from "./cursor-page-state";
import { MediaCursorPages } from "./cursor-pages";
import { MediaDetailModalButton } from "./detail-modal";
import { type MediaArtworkAspect, mediaAspectClass } from "./entity-presentation";
import { collectManagedAssetLocators, type MediaImagePurposes } from "./image";
import { MediaLibraryTitle } from "./library-title";
import { ManagedAssetImage } from "./managed-assets";
import { mediaCharacterLabel, mediaRolesLabel, type MediaUnlinkedCreator } from "./overview-state";
import { mediaPosterAsset } from "./summary-state";

export type MediaCreditFilterControls = {
	readonly guest: string;
	readonly uncredited: string;
	readonly kind: {
		readonly label: string;
		readonly choices: readonly {
			readonly label: string;
			readonly value: MediaCreditFilters["kind"];
		}[];
	};
};

export type MediaCreditsRecipe<Scope extends object = object> = (
	input: Scope & {
		readonly limit: number;
		readonly entityId: string;
		readonly after?: string | undefined;
		readonly reference: PluginIdentityReference;
		readonly filters?: undefined | MediaCreditFilters;
	},
) => PreparedRecipe<MediaCursorPage<MediaCreatorCredit>>;

type CreditPageInput<Scope extends object> = Scope & {
	readonly entityId: string;
	readonly after: null | string;
	readonly filters?: undefined | MediaCreditFilters;
};

export const createMediaCreditsQuery = <Scope extends object>(recipe: MediaCreditsRecipe<Scope>) =>
	createRyotQuery<CreditPageInput<Scope>, MediaCursorPage<MediaCreatorCredit>>(
		({ input, client }) =>
			client.data.query(
				recipe({
					...input,
					limit: 30,
					after: input.after ?? undefined,
					reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
				}),
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
	readonly filters?: undefined | MediaCreditFilterControls;
	readonly fit?: ComponentProps<typeof ManagedAssetImage>["fit"];
	readonly query: RyotQuery<CreditPageInput<NoInfer<Scope>>, MediaCursorPage<MediaCreatorCredit>>;
}) {
	const [filters, setFilters] = useState<MediaCreditFilters>({
		kind: "all",
		guest: "all",
		uncredited: "all",
	});
	const showUnlinked =
		props.filters === undefined ||
		(filters.kind === "all" && filters.guest !== "only" && filters.uncredited !== "only");
	return (
		<MediaDetailModalButton
			title={props.title}
			compact={props.compact}
			triggerLabel={props.label}
			closeLabel="Close credits"
			safeAreaTop={props.safeAreaTop}
		>
			<div className="flex flex-col gap-3">
				{props.filters === undefined ? null : (
					<div className="flex flex-wrap gap-3">
						<Select
							value={filters.kind}
							label={props.filters.kind.label}
							choices={props.filters.kind.choices}
							checkIcon={<AppIcon size={15} name="check" />}
							chevronIcon={<AppIcon size={15} name="chevron-down" />}
							onChange={(value) => {
								const choice = props.filters?.kind.choices.find((item) => item.value === value);
								if (choice !== undefined) {
									setFilters({ ...filters, kind: choice.value });
								}
							}}
						/>
						{(["guest", "uncredited"] satisfies readonly ("guest" | "uncredited")[]).map((key) => (
							<Select
								key={key}
								value={filters[key]}
								label={props.filters?.[key] ?? ""}
								checkIcon={<AppIcon size={15} name="check" />}
								chevronIcon={<AppIcon size={15} name="chevron-down" />}
								onChange={(value) => {
									if (value === "all" || value === "only" || value === "exclude") {
										setFilters({ ...filters, [key]: value });
									}
								}}
								choices={[
									{ value: "all", label: "Include all (including unknown)" },
									{ value: "only", label: "Only explicitly marked" },
									{ value: "exclude", label: "Exclude explicitly marked" },
								]}
							/>
						))}
					</div>
				)}
				{(showUnlinked ? props.unlinked : [])?.map((creator) => (
					<div className="py-3" key={`${creator.role}:${creator.name}`}>
						<p className="font-ui font-medium text-sm text-text">{creator.name}</p>
						<p className="font-ui text-xs text-text-muted">{creator.role}</p>
					</div>
				))}
				<MediaCursorPages
					query={props.query}
					getPageInput={(input, after) => ({ ...input, after })}
					input={{ ...props.input, ...(props.filters === undefined ? {} : { filters }) }}
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
