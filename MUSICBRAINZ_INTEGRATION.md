# MusicBrainz Integration Plan for Ryot

## Overview

MusicBrainz is an open music encyclopedia that collects music metadata and makes it available to the public. This document outlines how MusicBrainz will be integrated into Ryot as a music metadata provider.

### MusicBrainz API Details

- **Base URL**: `https://musicbrainz.org/ws/2/`
- **Cover Art API**: `https://coverartarchive.org/`
- **Response Format**: JSON (via `fmt=json` parameter or `Accept: application/json` header)
- **User-Agent**: Must provide a meaningful User-Agent header (use `USER_AGENT_STR` from `common_utils`)
- **Authentication**: Not required for read operations

## Entity Type Mapping

MusicBrainz has 13 core entity types, but for music tracking, we primarily care about these four:

### 1. Recording → Ryot Metadata (Track/Song)

**MusicBrainz Recording Entity:**
- Represents a unique audio recording/mix
- Corresponds to what users think of as a "track" or "song"
- Each recording can appear on multiple releases

**Maps to:** Ryot `MetadataDetails` with `MediaLot::Music`

**Key Fields:**
- `id` (MBID) → `identifier`
- `title` → `title`
- `length` (milliseconds) → `music_specifics.duration` (convert to seconds)
- `first-release-date` → `publish_date` / `publish_year`
- `artist-credit` → `people` (array of `PartialMetadataPerson`)
- `releases` → `groups` (array of `CommitMetadataGroupInput`)
- `video` (boolean) → can be stored in metadata if needed

**Example Recording:**
```json
{
  "id": "b9ad642e-b012-41c7-b72a-42cf4911f9ff",
  "title": "LAST ANGEL",
  "length": 230240,
  "first-release-date": "2007-11-07",
  "artist-credit": [
    {
      "name": "倖田來未",
      "artist": {
        "id": "c7c0b0c0-...",
        "name": "倖田來未",
        "sort-name": "Koda Kumi"
      }
    }
  ]
}
```

### 2. Release-Group → Ryot MetadataGroup (Album)

**MusicBrainz Release-Group Entity:**
- Represents the abstract concept of an album/single/EP
- Groups together all regional/format variations of the same album
- Has types: Album, Single, EP, Compilation, Soundtrack, etc.

**Maps to:** Ryot `MetadataGroupWithoutId`

**Key Fields:**
- `id` (MBID) → `identifier`
- `title` → `title`
- `primary-type` → could be stored in metadata/description
- `secondary-types` → additional classification (DJ-mix, Mixtape, Live, etc.)
- `first-release-date` → could be used for sorting/display
- `artist-credit` → used to identify the artist
- Related releases (via browse API) → can be fetched to get tracklist

**Example Release-Group:**
```json
{
  "id": "c9fdb94c-4975-4ed6-a96f-ef6d80bb7738",
  "title": "The Lost Tape",
  "primary-type": "Album",
  "secondary-types": ["DJ-mix", "Mixtape/Street"],
  "first-release-date": "2012-05-22",
  "artist-credit": [...]
}
```

**Note:** To get the actual tracklist for a release-group, we need to:
1. Browse releases by release-group MBID
2. Pick the "best" release (typically the earliest official release)
3. Fetch that release's details with `inc=recordings` to get tracks

### 3. Release → Internal Use (Not Directly Exposed)

**MusicBrainz Release Entity:**
- Represents a specific physical/digital product
- Multiple releases belong to one release-group
- Contains the actual tracklist

**Usage in Ryot:**
- Not directly exposed to users as a searchable/trackable entity
- Used internally when fetching `metadata_group_details` to get the tracklist
- Used for Cover Art Archive lookups

**Key Fields:**
- `id` (MBID) → used for Cover Art API
- `media` → array of discs/mediums
- `media[].tracks` → array of track objects
- `media[].tracks[].recording` → links to recording entity

### 4. Artist → Ryot Person

**MusicBrainz Artist Entity:**
- Represents musicians, groups, orchestras, producers, etc.
- Can be Person, Group, Orchestra, Choir, Character, or Other

**Maps to:** Ryot `PersonDetails`

**Key Fields:**
- `id` (MBID) → `identifier`
- `name` → `name`
- `type` → Person/Group classification
- `country` → can be included in description
- `disambiguation` → can be included in description
- `area` → geographic region
- `life-span` → begin/end dates (for description)
- `aliases` → alternative names
- `release-groups` → `related_metadata_groups`
- Top tracks (via browse recordings) → `related_metadata`

**Example Artist:**
```json
{
  "id": "5b11f4ce-a62d-471e-81fc-a69a8278c7da",
  "name": "Nirvana",
  "type": "Group",
  "country": "US",
  "area": {
    "name": "United States"
  },
  "life-span": {
    "begin": "1987",
    "end": "1994-04-05",
    "ended": true
  },
  "disambiguation": "1980s–1990s US grunge band"
}
```

## Comparison with Existing Providers

### YouTube Music (YTM)
- Uses `rustypipe` library for scraping
- Simpler structure: Track → Album → Artist
- Has view_count for tracks
- Has "various artists" flag
- Provides direct URLs to tracks/albums/artists

### Spotify
- Uses REST API with OAuth authentication
- Structure: Track → Album → Artist
- Has popularity ratings
- Has explicit content flags
- Disc/track numbers available
- Duration in milliseconds

### MusicBrainz Differences
1. **More canonical**: MusicBrainz distinguishes between abstract album (release-group) and physical releases
2. **No authentication needed**: Public API for read operations
3. **Collaborative artist credits**: Better support for "Artist A feat. Artist B" via joinphrases
4. **No popularity/view counts**: Community-driven, not usage-based
5. **More comprehensive metadata**: Better for classical music, compilations, various artists
6. **Separate Cover Art API**: Unlike YTM/Spotify which include images in main response

## API Implementation Plan

### MediaProvider Trait Implementation

```rust
pub struct MusicBrainzService {
    client: Client,
    cover_art_client: Client,
}
```

### Pagination Configuration

**Page Size:** Use the same page size as all other providers:
```rust
pub const PAGE_SIZE: u64 = 20;
```

**MusicBrainz Limits:**
- MusicBrainz API supports up to 100 results per request
- Default is 25 if not specified
- Ryot will request 20 per page for consistency

**Offset Calculation:**
```rust
let offset = (page - 1) * PAGE_SIZE;
```

**Response Processing:**
- MusicBrainz returns total count in response
- Use existing `compute_next_page(page, count)` helper function to calculate next page
- MusicBrainz count may be capped at 10,000 for very large result sets

### 1. `metadata_search` - Search for Recordings

**Endpoint:** `GET /ws/2/recording?query={query}&fmt=json&limit={limit}&offset={offset}`

**Query Construction:**
- Basic: `query=recording:{track_name}`
- With artist: `query=recording:{track_name} AND artist:{artist_name}`
- Can use Lucene syntax for advanced queries

**Implementation:**
```rust
async fn metadata_search(
    &self,
    page: u64,
    query: &str,
    _display_nsfw: bool,
    _source_specifics: &Option<MetadataSearchSourceSpecifics>,
) -> Result<SearchResults<MetadataSearchItem>>
```

**Response Processing:**
- Extract `recordings` array
- Map each recording to `MetadataSearchItem`:
  - `identifier`: recording.id
  - `title`: recording.title
  - `publish_year`: extract year from first-release-date
  - `image`: None (skip for performance)

**Pagination:**
- Use `PAGE_SIZE` (20) for limit parameter
- Calculate offset as `(page - 1) * PAGE_SIZE`
- Response includes `count` (total results) and `offset`
- Calculate `next_page` using existing `compute_next_page(page, count)` helper function

### 2. `metadata_details` - Get Recording Details

**Endpoint:** `GET /ws/2/recording/{mbid}?inc=artist-credits+releases+isrcs&fmt=json`

**Include Parameters:**
- `artist-credits`: Get artist information
- `releases`: Get albums this recording appears on
- `isrcs`: International Standard Recording Code (optional)

**Implementation:**
```rust
async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails>
```

**Response Processing:**
- `title`: recording.title
- `identifier`: recording.id
- `publish_date`: parse first-release-date
- `publish_year`: extract year from first-release-date
- `music_specifics`: populate MusicSpecifics struct:
  - `duration`: recording.length / 1000 (convert milliseconds to seconds)
  - `by_various_artists`: true if artist-credit.length > 1
  - `track_number`: None (not available at recording level - see MusicSpecifics section)
  - `disc_number`: None (not available at recording level - see MusicSpecifics section)
  - `view_count`: None (MusicBrainz doesn't track this)
- `people`: map artist-credit array to `PartialMetadataPerson`
  - Each artist becomes a person with role "Artist"
  - Ignore joinphrases (they're for display only)
- `groups`: map releases array to `CommitMetadataGroupInput`
  - For each release, we get the release-group it belongs to
  - Deduplicate by release-group id
- `assets.remote_images`: fetch from Cover Art Archive
- `source_url`: `https://musicbrainz.org/recording/{mbid}`

**Cover Art Fetching:**
- For each unique release, try: `GET https://coverartarchive.org/release/{release-mbid}/front-1200`
- Take the first successful image (if any)
- Returns 307 redirect to 1200px front cover image

### 3. `metadata_group_search` - Search for Release-Groups (Albums)

**Endpoint:** `GET /ws/2/release-group?query={query}&fmt=json&limit={limit}&offset={offset}`

**Query Construction:**
- Basic: `query=releasegroup:{album_name}`
- With artist: `query=releasegroup:{album_name} AND artist:{artist_name}`
- Filter by type: `query=releasegroup:{album_name} AND primarytype:album`

**Implementation:**
```rust
async fn metadata_group_search(
    &self,
    page: u64,
    query: &str,
    _display_nsfw: bool,
) -> Result<SearchResults<MetadataGroupSearchItem>>
```

**Response Processing:**
- Extract `release-groups` array
- Map to `MetadataGroupSearchItem`:
  - `identifier`: release-group.id
  - `name`: release-group.title
  - `parts`: None (track count not available in search - only populated in full details)
  - `image`: None (skip for performance)

### 4. `metadata_group_details` - Get Release-Group Details with Tracklist

**Endpoints:**
1. `GET /ws/2/release-group/{mbid}?inc=artist-credits&fmt=json`
2. `GET /ws/2/release?release-group={mbid}&fmt=json&limit=100`
3. `GET /ws/2/release/{release-mbid}?inc=recordings+artist-credits&fmt=json`

**Implementation:**
```rust
async fn metadata_group_details(
    &self,
    identifier: &str,
) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)>
```

**Process:**
1. Fetch release-group basic info
2. Browse releases by release-group to find the "canonical" release:
   - Filter for status == "Official"
   - Sort by release date (earliest first)
   - Take first release with complete tracklist
3. Fetch the chosen release with recordings included
4. Extract tracklist from release.media[].tracks[]

**Response Processing:**

**MetadataGroupWithoutId:**
- `identifier`: release-group.id
- `title`: release-group.title
- `lot`: MediaLot::Music
- `source`: MediaSource::MusicBrainz
- `parts`: total track count from release
- `description`: format with primary-type, secondary-types, disambiguation
- `source_url`: `https://musicbrainz.org/release-group/{mbid}`
- `assets.remote_images`: fetch from Cover Art Archive for the release

**PartialMetadataWithoutId array:**
- Iterate through release.media[].tracks[]
- For each track:
  - `title`: track.title (or recording.title if track.title is missing)
  - `identifier`: track.recording.id
  - `lot`: MediaLot::Music
  - `source`: MediaSource::MusicBrainz
  - `image`: use album cover art (same for all tracks)
  - Note: PartialMetadataWithoutId doesn't have music_specifics field
  - Track/disc numbers would be populated when user views the full recording details later

### 5. `people_search` - Search for Artists

**Endpoint:** `GET /ws/2/artist?query={query}&fmt=json&limit={limit}&offset={offset}`

**Query Construction:**
- Basic: `query=artist:{artist_name}`
- Filter by type: `query=artist:{artist_name} AND type:group`
- Filter by country: `query=artist:{artist_name} AND country:US`

**Implementation:**
```rust
async fn people_search(
    &self,
    page: u64,
    query: &str,
    _display_nsfw: bool,
    _source_specifics: &Option<PersonSourceSpecifics>,
) -> Result<SearchResults<PeopleSearchItem>>
```

**Response Processing:**
- Extract `artists` array
- Map to `PeopleSearchItem`:
  - `identifier`: artist.id
  - `name`: artist.name
  - `image`: None (MusicBrainz doesn't provide artist photos)

### 6. `person_details` - Get Artist Details

**Endpoints:**
1. `GET /ws/2/artist/{mbid}?inc=aliases+release-groups&fmt=json`
2. `GET /ws/2/recording?artist={mbid}&fmt=json&limit=10` for recordings

**Implementation:**
```rust
async fn person_details(
    &self,
    identifier: &str,
    _source_specifics: &Option<PersonSourceSpecifics>,
) -> Result<PersonDetails>
```

**Response Processing:**

**PersonDetails:**
- `name`: artist.name
- `identifier`: artist.id
- `source`: MediaSource::MusicBrainz
- `description`: format with:
  - artist.type (Person/Group)
  - artist.country
  - artist.area.name
  - artist.life-span (begin - end dates)
  - artist.disambiguation
- `source_url`: `https://musicbrainz.org/artist/{mbid}`
- `assets.remote_images`: None (or fetch from release-groups)

**related_metadata_groups:**
- Map artist.release-groups to `MetadataGroupPersonRelated`
- For each release-group:
  - `role`: "Artist" (or "Primary Artist")
  - `metadata_group`: MetadataGroupWithoutId with release-group data

**related_metadata:**
- Browse recordings by artist (limit 10)
- Map to `MetadataPersonRelated`
- For each recording:
  - `role`: "Artist"
  - `metadata`: PartialMetadataWithoutId with recording data (title, identifier, lot, source, image)

## Cover Art Archive Integration

The Cover Art Archive (CAA) is a separate service that hosts cover art for MusicBrainz releases.

### Endpoints

1. **Release Front Cover:** `GET https://coverartarchive.org/release/{mbid}/front`
   - Returns 307 redirect to actual image
   - Use this for getting album artwork

2. **Release-Group Front Cover:** `GET https://coverartarchive.org/release-group/{mbid}/front`
   - Returns front cover from a release in the group
   - Convenient for release-group lookups

3. **All Images for Release:** `GET https://coverartarchive.org/release/{mbid}`
   - Returns JSON with all artwork
   - Includes thumbnails in multiple sizes (250, 500, 1200)

### Image Size Variants

Images available in multiple resolutions:
- Original: `GET /release/{mbid}/front`
- 250px: `GET /release/{mbid}/front-250`
- 500px: `GET /release/{mbid}/front-500`
- 1200px: `GET /release/{mbid}/front-1200`

### Implementation Strategy

For Ryot:
- Use direct fetch: `GET https://coverartarchive.org/release/{mbid}/front-1200`
- This returns the 1200px front cover directly (307 redirect to image)
- Single request, no need to fetch JSON metadata first

## Key Implementation Considerations

### 1. User-Agent Header

MusicBrainz requires a meaningful User-Agent header. Use the existing `USER_AGENT_STR` constant from `crates/utils/common/src/lib.rs`:

```rust
use common_utils::USER_AGENT_STR;

let client = get_base_http_client(Some(vec![(
    USER_AGENT,
    HeaderValue::from_str(USER_AGENT_STR)?,
)]));
```

### 2. Artist Credits Processing

MusicBrainz uses "artist credits" which include multiple artists with joinphrases (e.g., " feat. ", " & ").

When processing artist-credit arrays:
```rust
let artists: Vec<PartialMetadataPerson> = artist_credit
    .iter()
    .filter_map(|ac| {
        Some(PartialMetadataPerson {
            name: ac.artist.name.clone(),
            identifier: ac.artist.id.clone(),
            role: "Artist".to_string(),
            source: MediaSource::MusicBrainz,
            ..Default::default()
        })
    })
    .collect();
```

Store each artist as a separate Person entity. Joinphrases are ignored - they're for display purposes only.

### 3. Release vs. Release-Group Complexity

The relationship between releases and release-groups is MusicBrainz's most complex aspect:

- **Release-Group**: Abstract album concept
- **Release**: Specific product (CD, vinyl, digital, regional variants)

For Ryot's `metadata_group_details`:
- Need to pick a "canonical" release from the group to get tracklist
- Strategy: prefer official status, earliest date, most complete data

### 4. Handling Missing Data

MusicBrainz data quality varies:
- Some fields may be null/missing
- Not all releases have cover art
- Some artists may have minimal information
- Track lengths can be null

Implement defensive coding with Option types and fallbacks.

### 5. JSON vs XML

Use JSON for all requests:
- Set header: `Accept: application/json`
- Or use parameter: `fmt=json`
- JSON is easier to work with in Rust via serde

### 6. MBID Format

MusicBrainz IDs (MBIDs) are UUIDs:
- Format: `550e8400-e29b-41d4-a716-446655440000`
- Always validate UUID format when receiving identifiers

### 7. No Authentication Needed

Unlike Spotify, MusicBrainz doesn't require authentication for read operations:
- Simpler implementation
- No token management
- No credentials in config

### 8. Translations

Translation support is not implemented for MusicBrainz. The `translate_metadata`, `translate_metadata_group`, and `translate_person` trait methods will use default implementations (return error).

## Data Structure Mappings Summary

| MusicBrainz Entity | Ryot Entity   | MediaLot | Notes                              |
| ------------------ | ------------- | -------- | ---------------------------------- |
| Recording          | Metadata      | Music    | Individual track/song              |
| Release-Group      | MetadataGroup | Music    | Album/EP/Single concept            |
| Release            | (Internal)    | -        | Used to get tracklist, not exposed |
| Artist             | Person        | -        | Musician/Band/Producer             |

## MusicSpecifics Field Mapping

Current `MusicSpecifics` struct fields:
```rust
pub struct MusicSpecifics {
    pub duration: Option<i32>,           // In seconds
    pub view_count: Option<i32>,         // Not used by MusicBrainz
    pub disc_number: Option<i32>,        // Not populated (see note below)
    pub track_number: Option<i32>,       // Not populated (see note below)
    pub by_various_artists: Option<bool>,
}
```

### Field Population for MusicBrainz

| MusicBrainz Field    | MusicSpecifics Field | When Populated   | Notes                                 |
| -------------------- | -------------------- | ---------------- | ------------------------------------- |
| recording.length     | duration             | metadata_details | Divide by 1000 (ms → seconds)         |
| artist-credit.length | by_various_artists   | metadata_details | True if > 1 artist                    |
| -                    | view_count           | Never            | MusicBrainz doesn't track view counts |
| track.position       | track_number         | Never            | See limitation below                  |
| media.position       | disc_number          | Never            | See limitation below                  |

### Limitation: Track and Disc Numbers

**Problem:** A single recording can appear on multiple releases with different track/disc numbers. For example:
- Song "A" appears as track 3 on Album X
- Same recording appears as track 7 on Compilation Y
- Same recording appears as track 1 on Single Z

**Current approach:** Leave `track_number` and `disc_number` as None for MusicBrainz recordings.

**Future consideration:** Could populate these fields if we pass release context to `metadata_details`, but this would require API changes.

### Potential New MusicSpecifics Fields

The following fields could be added to `MusicSpecifics` (all optional) without database schema changes:

1. **`isrc`**: `Option<String>` - International Standard Recording Code
   - Useful for matching recordings across platforms
   - Available from MusicBrainz API via `inc=isrcs`

2. **`is_video`**: `Option<bool>` - Indicates if recording is a music video
   - Available from MusicBrainz recording.video field
   - Could help differentiate audio tracks from video recordings

## API Endpoint Reference

### Search Endpoints
```
GET /ws/2/recording?query={q}&fmt=json&limit={l}&offset={o}
GET /ws/2/release-group?query={q}&fmt=json&limit={l}&offset={o}
GET /ws/2/artist?query={q}&fmt=json&limit={l}&offset={o}
```

### Lookup Endpoints
```
GET /ws/2/recording/{mbid}?inc=artist-credits+releases&fmt=json
GET /ws/2/release-group/{mbid}?inc=artist-credits&fmt=json
GET /ws/2/release/{mbid}?inc=artist-credits+recordings&fmt=json
GET /ws/2/artist/{mbid}?inc=aliases+release-groups&fmt=json
```

### Browse Endpoints
```
GET /ws/2/release?release-group={mbid}&fmt=json
GET /ws/2/recording?artist={mbid}&fmt=json&limit={l}
```

### Cover Art Endpoints
```
GET https://coverartarchive.org/release/{mbid}/front
GET https://coverartarchive.org/release-group/{mbid}/front
GET https://coverartarchive.org/release/{mbid} (JSON with all images)
```

## Implementation Checklist

- [ ] Create `crates/providers/music_brainz/` directory
- [ ] Implement `MusicBrainzService` struct
- [ ] Implement `metadata_search` (search recordings)
- [ ] Implement `metadata_details` (get recording details)
- [ ] Implement `metadata_group_search` (search release-groups)
- [ ] Implement `metadata_group_details` (get release-group + tracklist)
- [ ] Implement `people_search` (search artists)
- [ ] Implement `person_details` (get artist details)
- [ ] Integrate Cover Art Archive for images
- [ ] Add MusicBrainz to `MediaSource` enum
- [ ] Add it as a music source in crates/models/enum/src/media_enums.rs#L52.
- [ ] Register provider in `provider/src/lib.rs`
- [ ] Update frontend to display MusicBrainz source
- [ ] Add MusicBrainz logo to `apps/frontend/public/`

## References

- [MusicBrainz API Documentation](https://musicbrainz.org/doc/MusicBrainz_API)
- [Cover Art Archive API](https://musicbrainz.org/doc/Cover_Art_Archive/API)
- [Entity: Recording](https://musicbrainz.org/doc/Recording)
- [Entity: Release](https://musicbrainz.org/doc/Release)
- [Entity: Release-Group](https://musicbrainz.org/doc/Release_Group)
- [Entity: Artist](https://musicbrainz.org/doc/Artist)
- [Search Documentation](https://musicbrainz.org/doc/MusicBrainz_API/Search)
- [API Examples](https://musicbrainz.org/doc/MusicBrainz_API/Examples)
