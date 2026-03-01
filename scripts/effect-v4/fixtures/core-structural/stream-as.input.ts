import { Stream, Stream as Streams } from "effect";

declare const source: Stream.Stream<number>;
const PING = new Uint8Array();

const direct = source.pipe(Stream.as(PING));
const aliased = source.pipe(Streams.as(PING));

void [direct, aliased];
