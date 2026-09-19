# Entity mutation results

Entity-returning create, update, and upsert commands retain one `ListedEntity` snapshot in
their receipts. A no-op retains the entity returned by that command. Replay reads the
receipt before reading the source, so later updates or deletion cannot change the result.

Ensure-user and global-batch item receipts retain only `entityId` and `wasInserted`, which
their external results require. A delete item receipt retains `null`; its identity proves
completion, and the batch receipt retains the deleted count.

The entity persistence operation builds change evidence in the source-write transaction.
Matching hook plans, receipt results, dispatch references, and conditional batch evidence
commit with the source. Result codecs do not contain universal before/after outcomes.
Prepared policy inputs still retain the source snapshot needed to detect concurrent changes.

Provider root-write activities retain the entity snapshot and dispatch references.
Collection preparation projects the entity result to its identifier before journaling it.
