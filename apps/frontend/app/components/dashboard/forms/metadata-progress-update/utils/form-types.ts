import type {
	MetadataDetailsQuery,
	MetadataProgressUpdateCommonInput,
	MetadataProgressUpdateInput,
} from "@ryot/generated/graphql/backend/graphql";
import type { UpdateProgressData } from "~/lib/state/media";
import type { History, InProgress, WatchTimes } from "../../../types";

export interface MetadataProgressFormProps {
	onSubmit: () => void;
	metadataToUpdate: UpdateProgressData;
	metadataDetails: MetadataDetailsQuery["metadataDetails"];
}

export interface MetadataInProgressFormProps extends MetadataProgressFormProps {
	inProgress: NonNullable<InProgress>;
}

export interface MetadataNewProgressFormProps
	extends MetadataProgressFormProps {
	history: History;
}

export interface MediaFormProps {
	metadataToUpdate: UpdateProgressData;
	setMetadataToUpdate: (data: UpdateProgressData) => void;
	metadataDetails: MetadataDetailsQuery["metadataDetails"];
}

export interface BulkUpdateContext {
	history: History;
	watchTime: WatchTimes;
	currentDateFormatted: string;
	startDateFormatted: string | null;
	finishDateFormatted: string | null;
	metadataToUpdate: UpdateProgressData;
	updates: MetadataProgressUpdateInput[];
	common: MetadataProgressUpdateCommonInput;
	metadataDetails: MetadataDetailsQuery["metadataDetails"];
}
