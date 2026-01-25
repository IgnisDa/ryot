import { Result } from "effect";

export { // Preserve local export comment.
Result };

const failure = Result.fail("failed");

void [failure, Result];
