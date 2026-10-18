import type { MetadataLookupResult } from "@ryot-app/media-plugin/contracts/operations";

export enum ExtensionStatus {
	Idle = "idle",
	LookupFailed = "lookup_failed",
	VideoDetected = "video_detected",
	TrackingActive = "tracking_active",
	LookupInProgress = "lookup_in_progress",
}

export interface RawMediaData {
	title: string;
	progress: number;
}

export interface FormState {
	error?: string;
	status: "idle" | "submitted" | "submitting";
}

export interface ProgressDataWithMetadata {
	rawData: RawMediaData;
	metadata: MetadataLookupResult;
}
