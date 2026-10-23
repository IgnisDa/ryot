# Media

The Media plugin defines personal tracking of media consumption and related catalog information. Kernel concepts retain the meanings in the [kernel glossary](../../GLOSSARY.md).

## Language

### Subjects And Organization

**Media item**:
A media subject such as a movie, book, show, podcast, game, or music track, distinct from the user's recorded consumption of it.

**Media library**:
A user's selected media entities, independent of whether the user owns or has completed them. New media activity restores membership after an item has been removed.
_Avoid_: Owned media, consumption history

**Media ownership**:
A user's claim to own a media item, recorded directly or reported by an integration. Ownership is distinct from library membership, consumption progress, and kernel entity ownership.
_Avoid_: Entity ownership, library membership

**Flat media**:
A media item whose consumption progress is recorded directly against the item rather than derived from separate episode entities. Anime and manga can record episode or chapter positions this way.

**Episodic media**:
A show or podcast whose overall consumption state is derived from its separate episodes. Shows organize episodes through seasons; podcasts contain episodes directly.

**Media group**:
A catalog grouping of media items with ordered members, distinct from a user's collection. Its completion summary comes from members rather than its own consumption lifecycle.
_Avoid_: Collection

**Creator**:
A person or company credited on media or a media group, without its own consumption lifecycle.

**Credit**:
A directed relationship from a creator to a media subject, carrying any declared roles, order, or character details.

**Genre**:
A classification linked to media, not a consumable subject or library member. Matching labels do not merge private genres with provider-supplied genres.

### Consumption

**Consumption state**:
A user's current media lifecycle state, determined from recorded activity and any applicable episode state: untracked, backlog, in progress, on hold, dropped, caught up, or complete.
_Avoid_: Library membership, monitoring state

**Caught up**:
Complete consumption coverage of the required currently aired episodes in an episodic cycle, without necessarily completing the series. Newly aired episodes can make the user no longer caught up.
_Avoid_: Series completion

**Consumption cycle**:
An episodic viewing or listening sequence bounded by parent completions, distinct from lifetime episode history. Specials remain outside the cycle.

**Progress**:
A recorded partial consumption, expressed as an optional percentage or, for anime and manga, a cumulative episode or chapter position meaning "consumed through" it. A progress record with neither means the item was started.

**Completion**:
A recorded finished consumption of an item or episode, dated by its occurrence time unless marked as having an unknown date, with any known consumption amount. Completion does not mean ownership or removal from the library.

**List state**:
A source-reported snapshot of an anime or manga list entry, including its state, progress, repeat count, and any partial dates. It is distinct from a separately recorded consumption occurrence.

**Media review**:
A user's written thoughts or rating about a media subject, optionally marked as containing spoilers. A review is distinct from a completion or progress record.

**Episode order**:
An arrangement of a show's episodes for browsing, distinct from the default season structure used to determine consumption coverage and next-up.

**Next-up**:
The next eligible episode selected from a user's episodic consumption state in the default aired structure.

### Monitoring And Availability

**Monitoring**:
A user's subscription to supported changes on a global provider-supplied media entity, separate from consumption state and library membership. Turning monitoring off does not remove library membership.
_Avoid_: Tracking, library membership

**Watch offer**:
A country-specific way to access a movie or show through a service, such as streaming, rental, or purchase. It is distinct from the service where the user recorded consuming it.

**Time to beat**:
A provider's estimate of the time needed to finish a video game, not time the user has actually spent playing.
_Avoid_: Consumed time
