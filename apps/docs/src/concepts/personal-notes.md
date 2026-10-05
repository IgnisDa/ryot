# Personal notes

A personal note is private text attached to a media item. Each user has at most one
note per item. Notes are independent of reviews, ratings, collections and progress.
They are not displayed on public sharing pages.

The authenticated GraphQL operations are `personalNote(metadataId)`,
`setPersonalNote(metadataId, text)` and `deletePersonalNote(metadataId)`.
Ownership comes from the session; operations do not accept a user ID.
Text is preserved as entered, with a limit of 16,000 Unicode characters.
Deleting an account or media item also deletes its notes.

## Backup and recovery

Notes are stored in the `personal_note` PostgreSQL table. A complete database backup
using `pg_dump --format=custom` includes notes, their owners, media IDs and timestamps.
Restore the complete backup into an empty database using `pg_restore`, then start
Ryot against that database. Keep database backups private because they include all
users' notes and credentials.

The existing user JSON export does not include personal notes. For recovery, use a
complete database backup; exporting only the note table is insufficient because
its foreign keys depend on users and media items.
