import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Schema } from "effect";

export const IngestionRecoveryCursor = Schema.Struct({ id: ImportRunId, createdAt: IsoUtcString });
export type IngestionRecoveryCursor = typeof IngestionRecoveryCursor.Type;
