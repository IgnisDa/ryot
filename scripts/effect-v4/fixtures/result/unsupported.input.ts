import { Either } from "effect";

const supported = Either.left("failed");
const unsupported = Either.map(supported, String);

void unsupported;
