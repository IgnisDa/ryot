import { load, type CheerioAPI } from "@ryot/sandbox-sdk/cheerio";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import { XMLParser } from "@ryot/sandbox-sdk/fast-xml-parser";
import { strFromU8, type Unzipped, unzipSync } from "@ryot/sandbox-sdk/fflate";
import { parse, type ParseResult } from "@ryot/sandbox-sdk/papaparse";
import type { Innertube } from "@ryot/sandbox-sdk/youtubei";
import { YTNodes } from "@ryot/sandbox-sdk/youtubei";

const schema = Schema.Struct({ value: Schema.String });
const parsed: string = Schema.decodeUnknownSync(schema)({ value: "typed" }).value;
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
