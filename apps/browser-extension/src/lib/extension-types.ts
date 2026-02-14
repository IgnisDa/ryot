import type { MetadataLookupResponse } from "@ryot/contract/modules/metadata-lookup/schemas";

export type MetadataLookupData = MetadataLookupResponse;

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
