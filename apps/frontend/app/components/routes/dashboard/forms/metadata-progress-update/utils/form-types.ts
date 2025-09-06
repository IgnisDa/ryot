import type {
	MetadataProgressUpdateCommonInput,
	MetadataProgressUpdateInput,
} from "@ryot/generated/graphql/backend/graphql";
import type {
	InProgress,
	MetadataHistory,
	WatchTimes,
} from "~/components/routes/dashboard/types";
import type { MetadataDetails } from "~/components/routes/media-item/types";
import type { UpdateProgressData } from "~/lib/state/media";

export interface MetadataProgressFormProps {
	onSubmit: () => void;
	metadataDetails: MetadataDetails;
}

export interface MetadataInProgressFormProps extends MetadataProgressFormProps {
	inProgress: NonNullable<InProgress>;
}

export interface MetadataNewProgressFormProps
	extends MetadataProgressFormProps {
	history: MetadataHistory;
}

export interface MediaFormProps {
	metadataDetails: MetadataDetails;
}

export interface BulkUpdateContext {
	history: MetadataHistory;
	watchTime: WatchTimes;
	currentDateFormatted: string;
	metadataDetails: MetadataDetails;
	startDateFormatted: string | null;
	finishDateFormatted: string | null;
	metadataToUpdate: UpdateProgressData;
	updates: MetadataProgressUpdateInput[];
	common: MetadataProgressUpdateCommonInput;
}
