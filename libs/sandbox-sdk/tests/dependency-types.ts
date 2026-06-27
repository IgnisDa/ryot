import { load, type CheerioAPI } from "@ryot/sandbox-sdk/cheerio";
import { dayjs, type Dayjs } from "@ryot/sandbox-sdk/dayjs";
import customParseFormat from "@ryot/sandbox-sdk/dayjs/custom-parse-format";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import type { Innertube } from "@ryot/sandbox-sdk/youtubei";
import { YTNodes } from "@ryot/sandbox-sdk/youtubei";

const schema = Schema.Struct({ value: Schema.String });
const parsed: string = Schema.decodeUnknownSync(schema)({ value: "typed" }).value;
const effectValue: Effect.Effect<string> = Effect.succeed(parsed);

const date: Dayjs = dayjs("2026-07-18", "YYYY-MM-DD", true);
const document: CheerioAPI = load("<main>typed</main>");
const videoNode = YTNodes.Video;
type CreatedInnertube = Awaited<ReturnType<typeof Innertube.create>>;
declare const client: CreatedInnertube;
const typedClient: Innertube = client;

void parsed;
void effectValue;
void date;
void document;
void videoNode;
void typedClient;
void customParseFormat;
