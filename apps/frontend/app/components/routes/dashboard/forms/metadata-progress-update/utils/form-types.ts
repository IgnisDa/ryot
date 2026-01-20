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
	metadataId: string;
	onSubmit: () => void;
}

export interface MetadataInProgressFormProps extends MetadataProgressFormProps {
	inProgress: NonNullable<InProgress>;
}

export interface MetadataNewProgressFormProps
	extends MetadataProgressFormProps {
	history: MetadataHistory;
}

export interface MediaFormProps {
	metadataId: string;
}

export interface BulkUpdateContext {
	watchTime: WatchTimes;
	history: MetadataHistory;
	metadata: MetadataDetails;
	currentDateFormatted: string;
	startDateFormatted: string | null;
	finishDateFormatted: string | null;
	metadataToUpdate: UpdateProgressData;
	updates: MetadataProgressUpdateInput[];
	common: MetadataProgressUpdateCommonInput;
}
