import { load, type CheerioAPI } from "@ryot-app/plugin-backend-sdk/cheerio";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { XMLParser } from "@ryot-app/plugin-backend-sdk/fast-xml-parser";
import { strFromU8, type Unzipped, unzipSync } from "@ryot-app/plugin-backend-sdk/fflate";
import { parse, type ParseResult } from "@ryot-app/plugin-backend-sdk/papaparse";
import type { Innertube } from "@ryot-app/plugin-backend-sdk/youtubei";
import { YTNodes } from "@ryot-app/plugin-backend-sdk/youtubei";

const schema = Schema.Struct({ value: Schema.String });
const parsed: string = Schema.decodeSync(schema)({ value: "typed" }).value;
const effectValue: Effect.Effect<string> = Effect.succeed(parsed);

const document: CheerioAPI = load("<main>typed</main>");
const videoNode = YTNodes.Video;
type CreatedInnertube = Awaited<ReturnType<typeof Innertube.create>>;
declare const client: CreatedInnertube;
const typedClient: Innertube = client;

const archive: Unzipped = unzipSync(new Uint8Array());
const decoded: string = strFromU8(new Uint8Array());
const xml: unknown = new XMLParser().parse("<main>typed</main>");
const rows: ParseResult<Record<string, string>> = parse<Record<string, string>>("a,b\n1,2", {
	header: true,
});

void xml;
void rows;
void parsed;
void archive;
void decoded;
void document;
void videoNode;
void effectValue;
void typedClient;
