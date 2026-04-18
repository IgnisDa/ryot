import { describe, expect, it } from "bun:test";

import { importEntityRefKey, type ImportMediaEntityGroup } from "../jobs";
import { writeMediaEntityGroups } from "./write";

type WriteDeps = NonNullable<Parameters<typeof writeMediaEntityGroups>[1]>;

const notCalled = (name: string) => (): never => {
  throw new Error(`unexpected call: ${name}`);
};

const createGroup = (): ImportMediaEntityGroup => ({
  collectionMemberships: [],
  entityRef: {
    kind: "resolved",
    externalId: "tmdb_1",
    sourceLabel: "Movie One",
    scriptSlug: "movie.tmdb",
    entitySchemaSlug: "movie",
  },
  events: [
    {
      eventSchemaSlug: "progress",
      properties: { progressPercent: 50 },
      occurredAt: "2024-01-01T00:00:00.000Z",
    },
  ],
});

const writeSingleEventFailure = async (failure: {
  message: string;
  error: "validation" | "before_trigger";
}): Promise<Array<{ stage?: string; message: string }>> => {
  const recorded: Array<{ stage?: string; message: string }> = [];
  const group = createGroup();

  const deps: WriteDeps = {
    addToCollection: notCalled("addToCollection"),
    ensureEntityInLibrary: notCalled("ensureEntityInLibrary"),
    getOrCreateCollection: notCalled("getOrCreateCollection"),
    upsertUserRelationship: notCalled("upsertUserRelationship"),
    getEntityIdForUserBySchemaId: notCalled("getEntityIdForUserBySchemaId"),
    getUserRelationshipProperties: notCalled("getUserRelationshipProperties"),
    getBuiltinRelationshipSchemaBySlug: notCalled(
      "getBuiltinRelationshipSchemaBySlug",
    ),
    getBuiltinEntitySchemaBySlug: () =>
      Promise.resolve({ id: "es_movie", propertiesSchema: { fields: {} } }),
    getBuiltinEventSchemaBySlug: () =>
      Promise.resolve({
        name: "Progress",
        id: "ev_progress",
        propertiesSchema: { fields: {} },
      }),
    createImportRunFailure: (input) => {
      recorded.push({ stage: input.stage, message: input.message });
      return Promise.resolve();
    },
    createEventsBestEffortWithTriggers: () =>
      Promise.resolve({
        data: {
          count: 0,
          skipped: [],
          createdEvents: [],
          failures: [{ itemIndex: 0, ...failure }],
        },
      }),
  };

  await writeMediaEntityGroups(
    {
      runId: "run_1",
      failedItems: 0,
      userId: "user_1",
      importedItems: 0,
      startGroupIndex: 0,
      entityGroups: [group],
      onGroupComplete: () => Promise.resolve(),
      writeContext: {
        importRunId: "run_1",
        origin: "integration",
        integrationId: "int_1",
      },
      entityIdsByKey: new Map([
        [importEntityRefKey(group.entityRef), "entity_1"],
      ]),
    },
    deps,
  );

  return recorded;
};

describe("writeMediaEntityGroups event failure stages", () => {
  it("records before-trigger event failures with the event_before_trigger stage", async () => {
    const recorded = await writeSingleEventFailure({
      error: "before_trigger",
      message: "Before trigger failed: timed out",
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      stage: "event_before_trigger",
      message: "Before trigger failed: timed out",
    });
  });

  it("records ordinary event failures with the database_commit stage", async () => {
    const recorded = await writeSingleEventFailure({
      error: "validation",
      message: "Properties failed validation",
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ stage: "database_commit" });
  });
});
