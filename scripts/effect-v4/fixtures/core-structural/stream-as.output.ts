import { Stream, Stream as Streams } from "effect";

declare const source: Stream.Stream<number>;
const PING = new Uint8Array();

const direct = source.pipe(Stream.map(() => PING));
const aliased = source.pipe(Streams.map(() => PING));

void [direct, aliased];
