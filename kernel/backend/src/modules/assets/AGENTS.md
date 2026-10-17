# Assets Module Rules

- Temporary uploads always use local storage under `FILE_STORAGE_LOCAL_TEMP_DIR`.
- Treat local temporary storage as ephemeral working storage. Do not require a persistent mount.
- Permanent uploads prefer fully configured S3 storage and fall back to persistent local storage.
- Select the storage provider on the server while creating an upload intent. Clients do not choose providers.
- Keep upload intent provider selection and metadata persistence in one service operation.
- `uploads/` owns upload intents, `storage/` owns object storage and managed-asset records, and `routes.ts` delivers stored files; keep those responsibilities in their owners.
