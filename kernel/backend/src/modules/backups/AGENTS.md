# Backups

- Archive schema or rewrite changes require fixtures and round-trip coverage. Derive embedded ID rewrites from property schema metadata.
- Only `events` streams. Keep export and restore memory independent of event count; expanding streaming requires the same leaf analysis.
- Use exact kernel-purity allowlist entries for bootstrap vocabulary exceptions.
- Historical restore writes belong only in `restore/persistence.ts`, under the restore transaction; ordinary repositories expose no restore methods.
