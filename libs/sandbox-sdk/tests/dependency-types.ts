import { load, type CheerioAPI } from "@ryot/sandbox-sdk/cheerio";
import { dayjs, type Dayjs } from "@ryot/sandbox-sdk/dayjs";
import customParseFormat from "@ryot/sandbox-sdk/dayjs/custom-parse-format";
import type { Innertube } from "@ryot/sandbox-sdk/youtubei";
import { YTNodes } from "@ryot/sandbox-sdk/youtubei";
import * as z from "@ryot/sandbox-sdk/zod";

const schema = z.object({ value: z.string() });
const parsed: string = schema.parse({ value: "typed" }).value;

const date: Dayjs = dayjs("2026-07-18", "YYYY-MM-DD", true);
const document: CheerioAPI = load("<main>typed</main>");
const videoNode = YTNodes.Video;
type CreatedInnertube = Awaited<ReturnType<typeof Innertube.create>>;
declare const client: CreatedInnertube;
const typedClient: Innertube = client;

void parsed;
void date;
void document;
void videoNode;
void typedClient;
void customParseFormat;
