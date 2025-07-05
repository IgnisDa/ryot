import type {
	MetadataDetailsQuery,
	MetadataProgressUpdateCommonInput,
	MetadataProgressUpdateInput,
} from "@ryot/generated/graphql/backend/graphql";
import type {
	InProgress,
	MetadataHistory,
	WatchTimes,
} from "~/components/pages/dashboard/types";
import type { UpdateProgressData } from "~/lib/state/media";

export interface MetadataProgressFormProps {
	onSubmit: () => void;
	metadataDetails: MetadataDetailsQuery["metadataDetails"];
}

export interface MetadataInProgressFormProps extends MetadataProgressFormProps {
	inProgress: NonNullable<InProgress>;
}

export interface MetadataNewProgressFormProps
	extends MetadataProgressFormProps {
	history: MetadataHistory;
}

export interface MediaFormProps {
	metadataDetails: MetadataDetailsQuery["metadataDetails"];
}

export interface BulkUpdateContext {
	history: MetadataHistory;
	watchTime: WatchTimes;
	currentDateFormatted: string;
	startDateFormatted: string | null;
	finishDateFormatted: string | null;
	metadataToUpdate: UpdateProgressData;
	updates: MetadataProgressUpdateInput[];
	common: MetadataProgressUpdateCommonInput;
	metadataDetails: MetadataDetailsQuery["metadataDetails"];
}
