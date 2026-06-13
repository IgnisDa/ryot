# Backup Module Rules

- V1 schemas and rewrites are compatibility surfaces. Changes require fixture and round-trip coverage.
- Embedded entity and relationship IDs are collected and rewritten from property schema metadata.
- `events` is the only streaming section. Never introduce a structure that is O(n) in event count on either the export or the restore path, and never move another section onto the streaming path without the same leaf analysis.
- V1 compatibility vocabulary exceptions use explicit, exact kernel purity allowlist entries.
