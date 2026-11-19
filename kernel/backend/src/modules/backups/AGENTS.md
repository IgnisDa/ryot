# Backups

- Archive schema or rewrite changes require fixtures and round-trip coverage. Derive embedded ID rewrites from property schema metadata.
- Keep streamed-section memory independent of record count through dependency discovery, validation, rewriting, and persistence. Disk spooling alone is not sufficient.
- Use exact kernel-purity allowlist entries for bootstrap vocabulary exceptions.
- Historical restore writes belong only in `restore/persistence.ts`, under the restore transaction; ordinary repositories expose no restore methods.
