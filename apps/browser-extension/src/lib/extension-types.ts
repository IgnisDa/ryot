import type { MetadataLookupQuery } from "@ryot/generated/graphql/backend/graphql";

export type MetadataLookupData =
	MetadataLookupQuery["metadataLookup"]["response"];

export interface RawMediaData {
	title: string;
	progress: number;
}

export interface ProgressDataWithMetadata {
	rawData: RawMediaData;
	metadata: MetadataLookupData;
}

export interface FormState {
	error?: string;
	status: "idle" | "submitting" | "submitted";
}

export enum ExtensionStatus {
	Idle = "idle",
	VideoDetected = "video_detected",
	LookupInProgress = "lookup_in_progress",
	TrackingActive = "tracking_active",
	LookupFailed = "lookup_failed",
}
