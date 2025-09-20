import type { UserCollectionsListQuery } from "@ryot/generated/graphql/backend/graphql";
import type { ComponentType } from "react";
import type { UserMetadataDetails } from "../media-item/types";

export enum WatchTimes {
	JustCompletedNow = "Just Completed Now",
	IDontRemember = "I don't remember",
	CustomDates = "Custom Dates",
	JustStartedIt = "Just Started It",
}

export interface LinksGroupProps {
	label: string;
	href?: string;
	opened: boolean;
	toggle: () => void;
	tourControlTarget?: string;
	setOpened: (v: boolean) => void;
	icon: ComponentType<{ size?: number | string }>;
	links?: Array<{ label: string; link: string; tourControlTarget?: string }>;
}

export type Collection =
	UserCollectionsListQuery["userCollectionsList"]["response"][number];

export type InProgress = UserMetadataDetails["inProgress"];
export type MetadataHistory = UserMetadataDetails["history"];
