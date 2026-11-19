import { Schema } from "effect";

export const DownloadUrlResponse = Schema.Struct({ url: Schema.NonEmptyString });
