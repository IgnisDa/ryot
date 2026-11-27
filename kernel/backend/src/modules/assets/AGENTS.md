# Assets

- Temporary uploads use ephemeral local storage under `FILE_STORAGE_LOCAL_TEMP_DIR`; never require a persistent mount.
- The server selects an upload provider and persists its intent metadata in one service operation. Clients cannot select providers.
