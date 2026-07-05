import { Either, Result } from "effect";

export {
	// Preserve local export comment.
	Either,
	Result,
};

const failure = Either.left("failed");

void [failure, Result];
