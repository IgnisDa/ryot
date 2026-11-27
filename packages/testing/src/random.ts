import { SecureRandom } from "effect/crypto";

export const randomUuid = SecureRandom.SecureRandom.use((random) => random.uuidV4());
