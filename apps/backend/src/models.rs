use std::{
    collections::{HashMap, HashSet},
    fmt,
    sync::Arc,
};

use async_graphql::{Enum, InputObject, OutputType, SimpleObject, Union};
use async_trait::async_trait;
use boilermates::boilermates;
use chrono::{DateTime, NaiveDate};
use database::{
    ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic, ExerciseMuscle,
    MediaLot, MediaSource, SeenState, UserToMediaReason, Visibility,
};
use derive_more::{Add, AddAssign, Sum};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use schematic::ConfigEnum;
use schematic::Schematic;
use sea_orm::{
    prelude::DateTimeUtc, DerivePartialModel, EnumIter, FromJsonQueryResult, FromQueryResult,
};
use serde::{de, Deserialize, Serialize};
use serde_with::skip_serializing_none;
use strum::Display;

use crate::{
    entities::{exercise::ExerciseListItem, prelude::Workout, user_measurement, workout},
    file_storage::FileStorageService,
    miscellaneous::CollectionExtraInformation,
    traits::{DatabaseAssetsAsSingleUrl, DatabaseAssetsAsUrls},
    utils::get_stored_asset,
};

#[derive(Enum, Serialize, Deserialize, Clone, Debug, Copy, PartialEq, Eq)]
pub enum BackgroundJob {
    CalculateSummary,
    EvaluateWorkouts,
    UpdateAllMetadata,
    UpdateAllExercises,
    RecalculateCalendarEvents,
    YankIntegrationsData,
    PerformBackgroundTasks,
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq, Serialize, Deserialize, Default, Display)]
pub enum EntityLot {
    #[default]
    Metadata,
    Person,
    MetadataGroup,
    Exercise,
    Collection,
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, Hash)]
pub enum StoredUrl {
    S3(String),
    Url(String),
}

impl Default for StoredUrl {
    fn default() -> Self {
        Self::Url("".to_owned())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, SimpleObject, InputObject)]
#[graphql(input_name = "NamedObjectInput")]
pub struct NamedObject {
    pub name: String,
}

#[derive(Serialize, Deserialize, Debug, InputObject, Clone, Default)]
pub struct SearchInput {
    pub query: Option<String>,
    pub page: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, SimpleObject, Clone, Default)]
pub struct SearchDetails {
    pub total: i32,
    pub next_page: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, SimpleObject, Clone)]
#[graphql(concrete(name = "ExerciseListResults", params(ExerciseListItem)))]
#[graphql(concrete(
    name = "MediaCollectionContentsResults",
    params(media::MetadataSearchItemWithLot)
))]
#[graphql(concrete(
    name = "MetadataSearchResults",
    params(media::MetadataSearchItemResponse)
))]
#[graphql(concrete(name = "PeopleSearchResults", params(media::PeopleSearchItem)))]
#[graphql(concrete(
    name = "MetadataGroupSearchResults",
    params(media::MetadataGroupSearchItem)
))]
#[graphql(concrete(
    name = "MediaCreatorSearchResults",
    params(media::MediaCreatorSearchItem)
))]
#[graphql(concrete(name = "MediaListResults", params(media::MediaListItem)))]
#[graphql(concrete(name = "GenreListResults", params(media::GenreListItem)))]
#[graphql(concrete(
    name = "MetadataGroupListResults",
    params(media::MetadataGroupListItem)
))]
#[graphql(concrete(name = "WorkoutListResults", params(fitness::WorkoutListItem)))]
pub struct SearchResults<T: OutputType> {
    pub details: SearchDetails,
    pub items: Vec<T>,
}

#[derive(Debug, SimpleObject, Serialize, Deserialize, Clone)]
pub struct IdObject {
    pub id: i32,
}

#[derive(Debug, SimpleObject, Serialize, Deserialize, Clone)]
pub struct StringIdObject {
    pub id: String,
}

/// Complete export of the user.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Schematic)]
#[serde(rename_all = "snake_case")]
pub struct CompleteExport {
    /// Data about user's media.
    pub media: Option<Vec<media::ImportOrExportMediaItem>>,
    /// Data about user's people.
    pub people: Option<Vec<media::ImportOrExportPersonItem>>,
    /// Data about user's measurements.
    pub measurements: Option<Vec<user_measurement::Model>>,
    /// Data about user's workouts.
    pub workouts: Option<Vec<workout::Model>>,
    /// Data about user's media groups.
    pub media_group: Option<Vec<media::ImportOrExportMediaGroupItem>>,
}

#[derive(Debug, InputObject, Default)]
pub struct ChangeCollectionToEntityInput {
    pub creator_user_id: String,
    pub collection_name: String,
    pub metadata_id: Option<String>,
    pub person_id: Option<String>,
    pub metadata_group_id: Option<String>,
    pub exercise_id: Option<String>,
    pub information: Option<HashMap<String, String>>,
}

#[derive(
    Debug,
    SimpleObject,
    Serialize,
    Deserialize,
    Default,
    Clone,
    PartialEq,
    Eq,
    Schematic,
    FromJsonQueryResult,
)]
#[serde(rename_all = "snake_case")]
pub struct IdAndNamedObject {
    pub id: String,
    pub name: String,
}

#[derive(Enum, Eq, PartialEq, Copy, Clone, Debug, Serialize, Deserialize, Display)]
#[strum(serialize_all = "snake_case")]
pub enum ExportItem {
    Media,
    People,
    Workouts,
    MediaGroup,
    Measurements,
}

#[derive(Enum, Eq, PartialEq, Copy, Clone, Debug, Serialize, Deserialize, Display, EnumIter)]
pub enum MediaStateChanged {
    MetadataPublished,
    MetadataStatusChanged,
    MetadataReleaseDateChanged,
    MetadataNumberOfSeasonsChanged,
    MetadataEpisodeReleased,
    MetadataEpisodeNameChanged,
    MetadataChaptersOrEpisodesChanged,
    MetadataEpisodeImagesChanged,
    PersonMediaAssociated,
    ReviewPosted,
}

pub mod media {
    use super::*;

    #[derive(Debug, SimpleObject, Serialize, Deserialize, Clone)]
    pub struct MetadataSearchItemWithLot {
        pub details: MetadataSearchItem,
        pub metadata_lot: Option<MediaLot>,
        pub entity_lot: EntityLot,
    }

    #[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
    pub struct MetadataSearchItemResponse {
        pub item: MetadataSearchItem,
        /// Whether the user has interacted with this media item.
        pub has_interacted: bool,
        pub database_id: Option<String>,
    }

    #[derive(Clone, Debug, Serialize, Deserialize, SimpleObject, FromQueryResult)]
    pub struct MediaCreatorSearchItem {
        pub id: String,
        pub name: String,
        pub image: Option<String>,
        pub media_count: i64,
    }

    #[derive(Debug, InputObject, Default, Clone)]
    pub struct CreateOrUpdateCollectionInput {
        pub name: String,
        pub description: Option<String>,
        pub update_id: Option<String>,
        #[graphql(skip_input)]
        pub information_template: Option<Vec<CollectionExtraInformation>>,
    }

    #[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
    pub struct MediaListItem {
        pub data: MetadataSearchItem,
        pub average_rating: Option<Decimal>,
        pub media_reason: Option<Vec<UserToMediaReason>>,
    }

    #[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, FromQueryResult)]
    pub struct GenreListItem {
        pub id: String,
        pub name: String,
        pub num_items: Option<i64>,
    }

    #[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, FromQueryResult)]
    pub struct MetadataGroupListItem {
        pub id: String,
        pub title: String,
        pub description: Option<String>,
        pub lot: MediaLot,
        pub image: Option<String>,
        #[graphql(skip)]
        pub images: Vec<MetadataImage>,
        pub parts: i32,
    }

    #[derive(
        Debug,
        Serialize,
        Deserialize,
        SimpleObject,
        Clone,
        InputObject,
        PartialEq,
        Eq,
        Default,
        FromJsonQueryResult,
    )]
    #[graphql(input_name = "AudioBookSpecificsInput")]
    pub struct AudioBookSpecifics {
        pub runtime: Option<i32>,
    }

    #[derive(
        Debug,
        Serialize,
        Deserialize,
        SimpleObject,
        Clone,
        InputObject,
        PartialEq,
        Eq,
        Default,
        FromJsonQueryResult,
    )]
    #[graphql(input_name = "BookSpecificsInput")]
    pub struct BookSpecifics {
        pub pages: Option<i32>,
    }

    #[derive(
        Debug,
        Serialize,
        Deserialize,
        SimpleObject,
        Clone,
        InputObject,
        Eq,
        PartialEq,
        Default,
        FromJsonQueryResult,
    )]
    #[graphql(input_name = "MovieSpecificsInput")]
    pub struct MovieSpecifics {
        pub runtime: Option<i32>,
    }

    #[derive(
        Debug,
        Serialize,
        Deserialize,
        SimpleObject,
        Clone,
        Default,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        InputObject,
    )]
    #[graphql(input_name = "PodcastSpecificsInput")]
    pub struct PodcastSpecifics {
        pub episodes: Vec<PodcastEpisode>,
        pub total_episodes: usize,
    }

    impl PodcastSpecifics {
        pub fn get_episode(&self, episode_number: i32) -> Option<&PodcastEpisode> {
            self.episodes.iter().find(|e| e.number == episode_number)
        }
    }

    #[derive(
        Debug,
        PartialEq,
        Eq,
        Serialize,
        Deserialize,
        SimpleObject,
        Clone,
        Default,
        FromJsonQueryResult,
        InputObject,
    )]
    #[graphql(input_name = "PodcastEpisodeInput")]
    #[serde(default)]
    pub struct PodcastEpisode {
        pub number: i32,
        pub id: String,
        #[serde(alias = "audio_length_sec")]
        pub runtime: Option<i32>,
        #[serde(alias = "description")]
        pub overview: Option<String>,
        pub title: String,
        #[serde(alias = "pub_date_ms", deserialize_with = "deserialize_date")]
        pub publish_date: NaiveDate,
        pub thumbnail: Option<String>,
    }

    fn deserialize_date<'de, D>(deserializer: D) -> Result<NaiveDate, D::Error>
    where
        D: de::Deserializer<'de>,
    {
        struct JsonStringVisitor;

        impl<'de> de::Visitor<'de> for JsonStringVisitor {
            type Value = NaiveDate;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a number")
            }

            fn visit_u64<E>(self, v: u64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                DateTime::from_timestamp_millis(v.try_into().unwrap())
                    .ok_or_else(|| E::custom("Could not convert timestamp"))
                    .map(|d| d.date_naive())
            }

            fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                NaiveDate::parse_from_str(v, "%Y-%m-%d")
                    .map_err(|_| E::custom("Could not convert timestamp"))
            }
        }

        deserializer.deserialize_any(JsonStringVisitor)
    }

    #[derive(
        Debug,
        PartialEq,
        Eq,
        Serialize,
        Deserialize,
        SimpleObject,
        Clone,
        Default,
        FromJsonQueryResult,
        InputObject,
    )]
    #[graphql(input_name = "ShowSpecificsInput")]
    pub struct ShowSpecifics {
        pub seasons: Vec<ShowSeason>,
        pub runtime: Option<i32>,
        pub total_seasons: Option<usize>,
        pub total_episodes: Option<usize>,
    }

    impl ShowSpecifics {
        pub fn get_episode(
            &self,
            season_number: i32,
            episode_number: i32,
        ) -> Option<(&ShowSeason, &ShowEpisode)> {
            self.seasons
                .iter()
                .find(|s| s.season_number == season_number)
                .and_then(|s| {
                    s.episodes
                        .iter()
                        .find(|e| e.episode_number == episode_number)
                        .map(|e| (s, e))
                })
        }
    }

    #[derive(
        Debug,
        PartialEq,
        Eq,
        Serialize,
        Deserialize,
        SimpleObject,
        Clone,
        Default,
        FromJsonQueryResult,
        Hash,
        InputObject,
    )]
    #[graphql(input_name = "ShowSeasonSpecificsInput")]
    pub struct ShowSeason {
        pub id: i32,
        pub season_number: i32,
        pub name: String,
        pub publish_date: Option<NaiveDate>,
        pub episodes: Vec<ShowEpisode>,
        pub overview: Option<String>,
        pub poster_images: Vec<String>,
        pub backdrop_images: Vec<String>,
    }

    #[derive(
        Debug,
        PartialEq,
        Eq,
        Serialize,
        Deserialize,
        SimpleObject,
        Clone,
        Default,
        FromJsonQueryResult,
        Hash,
        InputObject,
    )]
    #[graphql(input_name = "ShowEpisodeSpecificsInput")]
    pub struct ShowEpisode {
        pub id: i32,
        pub episode_number: i32,
        pub publish_date: Option<NaiveDate>,
        pub name: String,
        pub overview: Option<String>,
        pub poster_images: Vec<String>,
        pub runtime: Option<i32>,
    }

    #[derive(
        Debug,
        PartialEq,
        Eq,
        Serialize,
        Deserialize,
        SimpleObject,
        Clone,
        Default,
        FromJsonQueryResult,
        InputObject,
    )]
    #[graphql(input_name = "VideoGameSpecificsInput")]
    pub struct VideoGameSpecifics {
        pub platforms: Vec<String>,
    }

    #[derive(
        Debug,
        PartialEq,
        Eq,
        Serialize,
        Deserialize,
        SimpleObject,
        Clone,
        Default,
        FromJsonQueryResult,
        InputObject,
    )]
    #[graphql(input_name = "VisualNovelSpecificsInput")]
    pub struct VisualNovelSpecifics {
        pub length: Option<i32>,
    }

    #[derive(
        Debug,
        PartialEq,
        Eq,
        Serialize,
        Deserialize,
        SimpleObject,
        Clone,
        Default,
        FromJsonQueryResult,
        InputObject,
    )]
    #[graphql(input_name = "AnimeSpecificsInput")]
    pub struct AnimeSpecifics {
        pub episodes: Option<i32>,
    }

    #[derive(
        Debug,
        PartialEq,
        Eq,
        Serialize,
        Deserialize,
        SimpleObject,
        Clone,
        Default,
        FromJsonQueryResult,
        InputObject,
    )]
    #[graphql(input_name = "MangaSpecificsInput")]
    pub struct MangaSpecifics {
        pub chapters: Option<i32>,
        pub volumes: Option<i32>,
        pub url: Option<String>,
    }

    #[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
    pub struct MetadataSearchItem {
        pub identifier: String,
        pub title: String,
        pub image: Option<String>,
        pub publish_year: Option<i32>,
    }

    #[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
    pub struct PeopleSearchItem {
        pub identifier: String,
        pub name: String,
        pub image: Option<String>,
        pub birth_year: Option<i32>,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct AudioBooksSummary {
        pub runtime: i32,
        pub played: usize,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct VideoGamesSummary {
        pub played: usize,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct VisualNovelsSummary {
        pub played: usize,
        pub runtime: i32,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct BooksSummary {
        pub pages: i32,
        pub read: usize,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct MoviesSummary {
        pub runtime: i32,
        pub watched: usize,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct PodcastsSummary {
        pub runtime: i32,
        pub played: usize,
        pub played_episodes: usize,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct ShowsSummary {
        pub runtime: i32,
        pub watched: usize,
        pub watched_episodes: usize,
        pub watched_seasons: usize,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct MangaSummary {
        pub chapters: usize,
        pub read: usize,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct AnimeSummary {
        pub episodes: usize,
        pub watched: usize,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct MediaOverallSummary {
        pub reviewed: u64,
        pub interacted_with: u64,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct UserMediaSummary {
        pub books: BooksSummary,
        pub movies: MoviesSummary,
        pub podcasts: PodcastsSummary,
        pub shows: ShowsSummary,
        pub video_games: VideoGamesSummary,
        pub visual_novels: VisualNovelsSummary,
        pub audio_books: AudioBooksSummary,
        pub anime: AnimeSummary,
        pub manga: MangaSummary,
        pub metadata_overall: MediaOverallSummary,
        pub people_overall: MediaOverallSummary,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct UserFitnessWorkoutSummary {
        pub recorded: u64,
        pub duration: Decimal,
        pub weight: Decimal,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct UserFitnessSummary {
        pub measurements_recorded: u64,
        pub exercises_interacted_with: u64,
        pub workouts: UserFitnessWorkoutSummary,
    }

    #[derive(Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult)]
    pub struct UserSummaryUniqueItems {
        pub audio_books: HashSet<String>,
        pub anime_episodes: HashSet<(String, i32)>,
        pub anime: HashSet<String>,
        pub manga_volumes: HashSet<(String, i32)>,
        pub manga_chapters: HashSet<(String, i32)>,
        pub manga: HashSet<String>,
        pub books: HashSet<String>,
        pub movies: HashSet<String>,
        pub visual_novels: HashSet<String>,
        pub video_games: HashSet<String>,
        pub show_episodes: HashSet<(String, i32, i32)>,
        pub show_seasons: HashSet<(String, i32)>,
        pub shows: HashSet<String>,
        pub podcast_episodes: HashSet<(String, i32)>,
        pub podcasts: HashSet<String>,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct UserSummary {
        pub fitness: UserFitnessSummary,
        pub media: UserMediaSummary,
        #[graphql(skip)]
        pub unique_items: UserSummaryUniqueItems,
        pub calculated_on: DateTimeUtc,
        #[graphql(skip)]
        pub calculated_from_beginning: bool,
    }

    #[derive(Debug, InputObject, Default)]
    pub struct PostReviewInput {
        pub rating: Option<Decimal>,
        pub text: Option<String>,
        pub visibility: Option<Visibility>,
        pub is_spoiler: Option<bool>,
        pub metadata_id: Option<String>,
        pub person_id: Option<String>,
        pub metadata_group_id: Option<String>,
        pub collection_id: Option<String>,
        pub date: Option<DateTimeUtc>,
        /// ID of the review if this is an update to an existing review
        pub review_id: Option<String>,
        pub show_season_number: Option<i32>,
        pub show_episode_number: Option<i32>,
        pub podcast_episode_number: Option<i32>,
        pub anime_episode_number: Option<i32>,
        pub manga_chapter_number: Option<i32>,
        pub manga_volume_number: Option<i32>,
    }

    #[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
    pub struct ProgressUpdateInput {
        pub metadata_id: String,
        pub progress: Option<Decimal>,
        pub date: Option<NaiveDate>,
        pub show_season_number: Option<i32>,
        pub show_episode_number: Option<i32>,
        pub podcast_episode_number: Option<i32>,
        pub anime_episode_number: Option<i32>,
        pub manga_chapter_number: Option<i32>,
        pub manga_volume_number: Option<i32>,
        pub change_state: Option<SeenState>,
        pub provider_watched_on: Option<String>,
    }

    #[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
    pub enum ProgressUpdateErrorVariant {
        AlreadySeen,
        NoSeenInProgress,
        UpdateWithoutProgressUpdate,
    }

    #[derive(Debug, SimpleObject)]
    pub struct ProgressUpdateError {
        pub error: ProgressUpdateErrorVariant,
    }

    #[derive(Union)]
    pub enum ProgressUpdateResultUnion {
        Ok(StringIdObject),
        Error(ProgressUpdateError),
    }

    #[skip_serializing_none]
    #[derive(
        Debug,
        Serialize,
        Deserialize,
        InputObject,
        Clone,
        SimpleObject,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        Hash,
        Default,
        Schematic,
    )]
    #[graphql(input_name = "PersonSourceSpecificsInput")]
    #[serde(rename_all = "snake_case")]
    pub struct PersonSourceSpecifics {
        pub is_tmdb_company: Option<bool>,
        pub is_anilist_studio: Option<bool>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, SimpleObject, Hash)]
    pub struct PartialMetadataPerson {
        pub name: String,
        pub identifier: String,
        pub source: MediaSource,
        pub role: String,
        pub character: Option<String>,
        #[graphql(skip)]
        pub source_specifics: Option<PersonSourceSpecifics>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone, Hash)]
    pub struct MetadataPerson {
        pub identifier: String,
        pub source: MediaSource,
        pub name: String,
        pub description: Option<String>,
        pub images: Option<Vec<String>>,
        pub gender: Option<String>,
        pub death_date: Option<NaiveDate>,
        pub birth_date: Option<NaiveDate>,
        pub place: Option<String>,
        pub website: Option<String>,
        pub related: Vec<(String, PartialMetadataWithoutId)>,
        pub source_specifics: Option<PersonSourceSpecifics>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, SimpleObject, Hash)]
    pub struct MetadataImageForMediaDetails {
        pub image: String,
        pub lot: MetadataImageLot,
    }

    #[derive(
        Clone,
        Debug,
        PartialEq,
        FromJsonQueryResult,
        Eq,
        Serialize,
        Deserialize,
        SimpleObject,
        Default,
    )]
    pub struct WatchProvider {
        pub name: String,
        pub image: Option<String>,
        pub languages: HashSet<String>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone, Default)]
    pub struct MediaDetails {
        pub identifier: String,
        pub is_nsfw: Option<bool>,
        pub title: String,
        pub source: MediaSource,
        pub description: Option<String>,
        pub original_language: Option<String>,
        pub lot: MediaLot,
        pub production_status: Option<String>,
        pub creators: Vec<MetadataFreeCreator>,
        pub people: Vec<PartialMetadataPerson>,
        pub genres: Vec<String>,
        pub url_images: Vec<MetadataImageForMediaDetails>,
        pub s3_images: Vec<MetadataImageForMediaDetails>,
        pub videos: Vec<MetadataVideo>,
        pub publish_year: Option<i32>,
        pub publish_date: Option<NaiveDate>,
        pub suggestions: Vec<PartialMetadataWithoutId>,
        pub group_identifiers: Vec<String>,
        pub provider_rating: Option<Decimal>,
        pub watch_providers: Vec<WatchProvider>,
        pub audio_book_specifics: Option<AudioBookSpecifics>,
        pub book_specifics: Option<BookSpecifics>,
        pub movie_specifics: Option<MovieSpecifics>,
        pub podcast_specifics: Option<PodcastSpecifics>,
        pub show_specifics: Option<ShowSpecifics>,
        pub video_game_specifics: Option<VideoGameSpecifics>,
        pub visual_novel_specifics: Option<VisualNovelSpecifics>,
        pub anime_specifics: Option<AnimeSpecifics>,
        pub manga_specifics: Option<MangaSpecifics>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone)]
    #[serde(untagged)]
    pub enum ImportOrExportItemIdentifier {
        // the identifier in case we need to fetch details
        NeedsDetails(String),
        // details are already filled and just need to be committed to database
        AlreadyFilled(Box<MediaDetails>),
    }

    /// A specific instance when an entity was seen.
    #[skip_serializing_none]
    #[derive(Debug, Serialize, Deserialize, Clone, Default, Schematic)]
    #[serde(rename_all = "snake_case")]
    pub struct ImportOrExportMediaItemSeen {
        /// The progress of media done. If none, it is considered as done.
        pub progress: Option<Decimal>,
        /// The timestamp when started watching.
        pub started_on: Option<NaiveDate>,
        /// The timestamp when finished watching.
        pub ended_on: Option<NaiveDate>,
        /// If for a show, the season which was seen.
        pub show_season_number: Option<i32>,
        /// If for a show, the episode which was seen.
        pub show_episode_number: Option<i32>,
        /// If for a podcast, the episode which was seen.
        pub podcast_episode_number: Option<i32>,
        /// If for an anime, the episode which was seen.
        pub anime_episode_number: Option<i32>,
        /// If for a manga, the chapter which was seen.
        pub manga_chapter_number: Option<i32>,
        /// If for a manga, the volume which was seen.
        pub manga_volume_number: Option<i32>,
        /// The provider this item was watched on.
        pub provider_watched_on: Option<String>,
    }

    /// Review data associated to a rating.
    #[skip_serializing_none]
    #[derive(Debug, Serialize, Deserialize, Clone, Default, Schematic)]
    #[serde(rename_all = "snake_case")]
    pub struct ImportOrExportItemReview {
        /// The visibility set by the user.
        pub visibility: Option<Visibility>,
        /// The date the review was posted.
        pub date: Option<DateTimeUtc>,
        /// Whether to mark the review as a spoiler. Defaults to false.
        pub spoiler: Option<bool>,
        /// Actual text for the review.
        pub text: Option<String>,
    }

    /// A rating given to an entity.
    #[skip_serializing_none]
    #[derive(Debug, Serialize, Deserialize, Clone, Default, Schematic)]
    #[serde(rename_all = "snake_case")]
    pub struct ImportOrExportItemRating {
        /// Data about the review.
        pub review: Option<ImportOrExportItemReview>,
        /// The score of the review.
        pub rating: Option<Decimal>,
        /// If for a show, the season for which this review was for.
        pub show_season_number: Option<i32>,
        /// If for a show, the episode for which this review was for.
        pub show_episode_number: Option<i32>,
        /// If for a podcast, the episode for which this review was for.
        pub podcast_episode_number: Option<i32>,
        /// If for an anime, the episode for which this review was for.
        pub anime_episode_number: Option<i32>,
        /// If for a manga, the chapter for which this review was for.
        pub manga_chapter_number: Option<i32>,
        /// The comments attached to this review.
        pub comments: Option<Vec<ImportOrExportItemReviewComment>>,
    }

    /// Details about a specific media item that needs to be imported or exported.
    #[skip_serializing_none]
    #[derive(Debug, Serialize, Deserialize, Clone, Schematic)]
    #[serde(rename_all = "snake_case")]
    pub struct ImportOrExportMediaItem {
        /// An string to help identify it in the original source.
        pub source_id: String,
        /// The type of media.
        pub lot: MediaLot,
        /// The source of media.
        pub source: MediaSource,
        /// The provider identifier. For eg: TMDB-ID, Openlibrary ID and so on.
        pub identifier: String,
        // DEV: Only to be used internally.
        #[serde(skip)]
        #[schema(exclude)]
        pub internal_identifier: Option<ImportOrExportItemIdentifier>,
        /// The seen history for the user.
        pub seen_history: Vec<ImportOrExportMediaItemSeen>,
        /// The review history for the user.
        pub reviews: Vec<ImportOrExportItemRating>,
        /// The collections this entity was added to.
        pub collections: Vec<String>,
    }

    /// Details about a specific media group item that needs to be imported or exported.
    #[skip_serializing_none]
    #[derive(Debug, Serialize, Deserialize, Clone, Schematic)]
    #[serde(rename_all = "snake_case")]
    pub struct ImportOrExportMediaGroupItem {
        /// Name of the group.
        pub title: String,
        /// The type of media.
        pub lot: MediaLot,
        /// The source of media.
        pub source: MediaSource,
        /// The provider identifier. For eg: TMDB-ID, Openlibrary ID and so on.
        pub identifier: String,
        /// The review history for the user.
        pub reviews: Vec<ImportOrExportItemRating>,
        /// The collections this entity was added to.
        pub collections: Vec<String>,
    }

    /// Details about a specific creator item that needs to be exported.
    #[skip_serializing_none]
    #[derive(Debug, Serialize, Deserialize, Clone, Schematic)]
    #[serde(rename_all = "snake_case")]
    pub struct ImportOrExportPersonItem {
        /// The provider identifier.
        pub identifier: String,
        /// The source of data.
        pub source: MediaSource,
        /// The source specific data.
        pub source_specifics: Option<PersonSourceSpecifics>,
        /// The name of the creator.
        pub name: String,
        /// The review history for the user.
        pub reviews: Vec<ImportOrExportItemRating>,
        /// The collections this entity was added to.
        pub collections: Vec<String>,
    }

    #[derive(
        Debug,
        Clone,
        Copy,
        PartialEq,
        Eq,
        EnumIter,
        FromJsonQueryResult,
        Deserialize,
        Serialize,
        Default,
        Hash,
        Enum,
    )]
    pub enum MetadataImageLot {
        Backdrop,
        #[default]
        Poster,
    }

    #[derive(
        Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, Default, Hash,
    )]
    pub struct MetadataImage {
        pub url: StoredUrl,
        pub lot: MetadataImageLot,
    }

    #[derive(
        Debug,
        Clone,
        Copy,
        PartialEq,
        Eq,
        EnumIter,
        FromJsonQueryResult,
        Deserialize,
        Serialize,
        Hash,
        Default,
        Enum,
    )]
    pub enum MetadataVideoSource {
        #[default]
        Youtube,
        Dailymotion,
        Custom,
    }

    #[derive(
        Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, Default, Hash,
    )]
    pub struct MetadataVideo {
        pub identifier: StoredUrl,
        pub source: MetadataVideoSource,
    }

    #[async_trait]
    impl DatabaseAssetsAsSingleUrl for Option<Vec<MetadataImage>> {
        async fn first_as_url(
            &self,
            file_storage_service: &Arc<FileStorageService>,
        ) -> Option<String> {
            if let Some(images) = self {
                if let Some(i) = images.first().cloned() {
                    Some(get_stored_asset(i.url, file_storage_service).await)
                } else {
                    None
                }
            } else {
                None
            }
        }
    }

    #[async_trait]
    impl DatabaseAssetsAsUrls for Option<Vec<MetadataImage>> {
        async fn as_urls(&self, file_storage_service: &Arc<FileStorageService>) -> Vec<String> {
            let mut images = vec![];
            if let Some(imgs) = self {
                for i in imgs.clone() {
                    images.push(get_stored_asset(i.url, file_storage_service).await);
                }
            }
            images
        }
    }

    /// Comments left in replies to posted reviews.
    #[skip_serializing_none]
    #[derive(
        Clone,
        Debug,
        PartialEq,
        FromJsonQueryResult,
        Eq,
        Serialize,
        Deserialize,
        Default,
        SimpleObject,
        Schematic,
    )]
    #[serde(rename_all = "snake_case")]
    pub struct ImportOrExportItemReviewComment {
        pub id: String,
        pub text: String,
        pub user: IdAndNamedObject,
        /// The user ids of all those who liked it.
        pub liked_by: HashSet<String>,
        pub created_on: DateTimeUtc,
    }

    #[derive(
        Clone,
        Debug,
        PartialEq,
        FromJsonQueryResult,
        Eq,
        Serialize,
        Deserialize,
        SimpleObject,
        Default,
        Hash,
    )]
    pub struct MetadataFreeCreator {
        pub name: String,
        pub role: String,
        pub image: Option<String>,
    }

    #[derive(
        Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
    )]
    pub struct SeenShowExtraInformation {
        pub season: i32,
        pub episode: i32,
    }

    #[derive(
        Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
    )]
    pub struct SeenPodcastExtraInformation {
        pub episode: i32,
    }

    #[derive(
        Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
    )]
    pub struct SeenAnimeExtraInformation {
        pub episode: Option<i32>,
    }

    #[derive(
        Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
    )]
    pub struct SeenMangaExtraInformation {
        pub chapter: Option<i32>,
        pub volume: Option<i32>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone)]
    pub struct ReviewPostedEvent {
        pub obj_id: String,
        pub obj_title: String,
        pub username: String,
        pub review_id: String,
        pub entity_lot: EntityLot,
    }

    #[boilermates("PartialMetadataWithoutId")]
    #[boilermates(attr_for(
        "PartialMetadataWithoutId",
        "#[derive(Clone, Eq, PartialEq, Debug, Serialize, Deserialize, SimpleObject, Hash)]"
    ))]
    #[derive(Clone, Eq, PartialEq, Debug, Serialize, Deserialize, SimpleObject, Hash)]
    pub struct PartialMetadata {
        #[boilermates(not_in("PartialMetadataWithoutId"))]
        pub id: String,
        pub identifier: String,
        pub title: String,
        pub image: Option<String>,
        pub lot: MediaLot,
        pub source: MediaSource,
    }

    #[derive(Debug, InputObject)]
    pub struct CommitPersonInput {
        pub name: String,
        pub source: MediaSource,
        pub identifier: String,
        pub source_specifics: Option<PersonSourceSpecifics>,
    }

    #[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
    pub struct MetadataGroupSearchItem {
        pub name: String,
        pub identifier: String,
        pub image: Option<String>,
        pub parts: Option<usize>,
    }

    #[skip_serializing_none]
    #[derive(
        Debug,
        Serialize,
        Deserialize,
        Clone,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        Default,
        InputObject,
        Hash,
    )]
    pub struct CommitMediaInput {
        pub lot: MediaLot,
        pub source: MediaSource,
        pub identifier: String,
        #[graphql(skip_input)]
        pub force_update: Option<bool>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone, FromJsonQueryResult, Eq, PartialEq, Default)]
    pub struct MetadataStateChanges {}

    #[derive(
        Debug, Serialize, Deserialize, Clone, FromJsonQueryResult, Eq, PartialEq, Default, Hash,
    )]
    pub struct MediaAssociatedPersonStateChanges {
        pub media: CommitMediaInput,
        pub role: String,
    }

    #[derive(Debug, Serialize, Deserialize, Clone, FromJsonQueryResult, Eq, PartialEq, Default)]
    pub struct PersonStateChanges {
        pub media_associated: HashSet<MediaAssociatedPersonStateChanges>,
    }

    #[skip_serializing_none]
    #[derive(
        Debug,
        Serialize,
        Deserialize,
        InputObject,
        Clone,
        SimpleObject,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        Hash,
        Default,
        Schematic,
    )]
    #[graphql(input_name = "IntegrationSourceSpecificsInput")]
    #[serde(rename_all = "snake_case")]
    pub struct IntegrationSourceSpecifics {
        pub plex_username: Option<String>,
        pub audiobookshelf_base_url: Option<String>,
        pub audiobookshelf_token: Option<String>,
    }
}

pub mod fitness {
    use super::*;

    #[derive(
        Debug, Clone, Serialize, Enum, Copy, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseCategory {
        Powerlifting,
        Strength,
        Stretching,
        Cardio,
        #[serde(alias = "olympic weightlifting")]
        OlympicWeightlifting,
        Strongman,
        Plyometrics,
    }

    #[derive(
        Debug,
        Clone,
        Serialize,
        SimpleObject,
        Deserialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        InputObject,
    )]
    #[serde(rename_all = "camelCase")]
    #[graphql(input_name = "ExerciseAttributesInput")]
    pub struct ExerciseAttributes {
        pub instructions: Vec<String>,
        #[graphql(skip)]
        #[serde(default)]
        pub internal_images: Vec<StoredUrl>,
        #[serde(default)]
        pub images: Vec<String>,
    }

    #[derive(
        Debug, Clone, Serialize, SimpleObject, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "camelCase")]
    pub struct GithubExerciseAttributes {
        pub level: ExerciseLevel,
        pub category: ExerciseCategory,
        pub force: Option<ExerciseForce>,
        pub mechanic: Option<ExerciseMechanic>,
        pub equipment: Option<ExerciseEquipment>,
        pub primary_muscles: Vec<ExerciseMuscle>,
        pub secondary_muscles: Vec<ExerciseMuscle>,
        pub instructions: Vec<String>,
        #[serde(default)]
        pub images: Vec<String>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct Exercise {
        #[serde(alias = "id")]
        pub identifier: String,
        #[serde(flatten)]
        pub attributes: GithubExerciseAttributes,
        pub name: String,
    }

    /// The actual statistics that were logged in a user measurement.
    #[skip_serializing_none]
    #[derive(
        Debug,
        Clone,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        SimpleObject,
        InputObject,
        Schematic,
        Default,
    )]
    #[graphql(input_name = "UserMeasurementDataInput")]
    #[serde(rename_all = "snake_case")]
    pub struct UserMeasurementStats {
        pub weight: Option<Decimal>,
        pub body_mass_index: Option<Decimal>,
        pub total_body_water: Option<Decimal>,
        pub muscle: Option<Decimal>,
        pub lean_body_mass: Option<Decimal>,
        pub body_fat: Option<Decimal>,
        pub bone_mass: Option<Decimal>,
        pub visceral_fat: Option<Decimal>,
        pub waist_circumference: Option<Decimal>,
        pub waist_to_height_ratio: Option<Decimal>,
        pub hip_circumference: Option<Decimal>,
        pub waist_to_hip_ratio: Option<Decimal>,
        pub chest_circumference: Option<Decimal>,
        pub thigh_circumference: Option<Decimal>,
        pub biceps_circumference: Option<Decimal>,
        pub neck_circumference: Option<Decimal>,
        pub body_fat_caliper: Option<Decimal>,
        pub chest_skinfold: Option<Decimal>,
        pub abdominal_skinfold: Option<Decimal>,
        pub thigh_skinfold: Option<Decimal>,
        pub basal_metabolic_rate: Option<Decimal>,
        pub total_daily_energy_expenditure: Option<Decimal>,
        pub calories: Option<Decimal>,
        // DEV: The only custom data type we allow is decimal
        pub custom: Option<HashMap<String, Decimal>>,
    }

    /// The totals of a workout and the different bests achieved.
    #[derive(
        Debug,
        FromJsonQueryResult,
        Clone,
        Serialize,
        Deserialize,
        Eq,
        PartialEq,
        SimpleObject,
        Default,
        Sum,
        Add,
        AddAssign,
        Schematic,
    )]
    #[serde(rename_all = "snake_case")]
    pub struct WorkoutOrExerciseTotals {
        /// The number of personal bests achieved.
        pub personal_bests_achieved: usize,
        pub weight: Decimal,
        pub reps: Decimal,
        pub distance: Decimal,
        pub duration: Decimal,
        /// The total seconds that were logged in the rest timer.
        #[serde(default)]
        pub rest_time: u16,
    }

    #[derive(
        Debug,
        Clone,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        SimpleObject,
        Default,
    )]
    pub struct UserToExerciseHistoryExtraInformation {
        pub workout_id: String,
        pub idx: usize,
    }

    /// Details about the statistics of the set performed.
    #[skip_serializing_none]
    #[derive(
        Clone,
        Debug,
        Deserialize,
        Serialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        SimpleObject,
        InputObject,
        Schematic,
        Default,
    )]
    #[graphql(input_name = "SetStatisticInput")]
    #[serde(rename_all = "snake_case")]
    pub struct WorkoutSetStatistic {
        pub duration: Option<Decimal>,
        pub distance: Option<Decimal>,
        pub reps: Option<Decimal>,
        pub weight: Option<Decimal>,
        pub one_rm: Option<Decimal>,
        pub pace: Option<Decimal>,
        pub volume: Option<Decimal>,
    }

    /// The types of set (mostly characterized by exertion level).
    #[derive(
        Clone,
        Debug,
        Deserialize,
        Serialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        Enum,
        Copy,
        ConfigEnum,
    )]
    #[serde(rename_all = "snake_case")]
    pub enum SetLot {
        Normal,
        WarmUp,
        Drop,
        Failure,
    }

    /// The different types of personal bests that can be achieved on a set.
    #[derive(
        Clone,
        Debug,
        Deserialize,
        Serialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        Enum,
        Copy,
        Default,
        ConfigEnum,
    )]
    #[serde(rename_all = "snake_case")]
    pub enum WorkoutSetPersonalBest {
        #[default]
        Weight,
        OneRm,
        Volume,
        Time,
        Pace,
        Reps,
    }

    #[skip_serializing_none]
    #[derive(
        Clone,
        Debug,
        Deserialize,
        Serialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        SimpleObject,
        Schematic,
        Default,
    )]
    #[serde(rename_all = "snake_case")]
    pub struct WorkoutSetTotals {
        pub weight: Option<Decimal>,
    }

    /// Details about the set performed.
    #[derive(
        Clone,
        Debug,
        Deserialize,
        Serialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        SimpleObject,
        Schematic,
    )]
    #[serde(rename_all = "snake_case")]
    pub struct WorkoutSetRecord {
        pub statistic: WorkoutSetStatistic,
        pub lot: SetLot,
        pub personal_bests: Vec<WorkoutSetPersonalBest>,
        pub confirmed_at: Option<DateTimeUtc>,
        #[serde(default)]
        pub totals: WorkoutSetTotals,
        pub actual_rest_time: Option<i64>,
        pub note: Option<String>,
    }

    impl WorkoutSetRecord {
        // DEV: Formula from https://en.wikipedia.org/wiki/One-repetition_maximum#cite_note-7
        pub fn calculate_one_rm(&self) -> Option<Decimal> {
            let mut val = (self.statistic.weight? * dec!(36.0))
                .checked_div(dec!(37.0) - self.statistic.reps?);
            if let Some(v) = val {
                if v <= dec!(0) {
                    val = None;
                }
            };
            val
        }

        pub fn calculate_volume(&self) -> Option<Decimal> {
            Some(self.statistic.weight? * self.statistic.reps?)
        }

        pub fn calculate_pace(&self) -> Option<Decimal> {
            self.statistic
                .distance?
                .checked_div(self.statistic.duration?)
        }

        pub fn get_personal_best(&self, pb_type: &WorkoutSetPersonalBest) -> Option<Decimal> {
            match pb_type {
                WorkoutSetPersonalBest::Weight => self.statistic.weight,
                WorkoutSetPersonalBest::Time => self.statistic.duration,
                WorkoutSetPersonalBest::Reps => self.statistic.reps,
                WorkoutSetPersonalBest::OneRm => self.calculate_one_rm(),
                WorkoutSetPersonalBest::Volume => self.calculate_volume(),
                WorkoutSetPersonalBest::Pace => self.calculate_pace(),
            }
        }
    }

    #[derive(
        Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject,
    )]
    pub struct ExerciseBestSetRecord {
        pub workout_id: String,
        pub exercise_idx: usize,
        pub workout_done_on: DateTimeUtc,
        pub set_idx: usize,
        pub data: WorkoutSetRecord,
    }

    #[derive(
        Debug,
        Clone,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        SimpleObject,
        Default,
    )]
    pub struct UserToExerciseBestSetExtraInformation {
        pub lot: WorkoutSetPersonalBest,
        pub sets: Vec<ExerciseBestSetRecord>,
    }

    #[derive(
        Debug,
        Clone,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        SimpleObject,
        Default,
    )]
    pub struct UserToExerciseExtraInformation {
        pub history: Vec<UserToExerciseHistoryExtraInformation>,
        pub lifetime_stats: WorkoutOrExerciseTotals,
        pub personal_bests: Vec<UserToExerciseBestSetExtraInformation>,
    }

    /// The assets that were uploaded for an entity.
    #[derive(
        Clone,
        Debug,
        Deserialize,
        Serialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        SimpleObject,
        InputObject,
        Default,
        Schematic,
    )]
    #[graphql(input_name = "EntityAssetsInput")]
    #[serde(rename_all = "snake_case")]
    pub struct EntityAssets {
        /// The keys of the S3 images.
        pub images: Vec<String>,
        /// The keys of the S3 videos.
        pub videos: Vec<String>,
    }

    /// An exercise that has been processed and committed to the database.
    #[derive(
        Clone,
        Debug,
        Deserialize,
        Serialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        SimpleObject,
        Schematic,
    )]
    #[serde(rename_all = "snake_case")]
    pub struct ProcessedExercise {
        pub name: String,
        pub lot: ExerciseLot,
        pub sets: Vec<WorkoutSetRecord>,
        pub notes: Vec<String>,
        pub rest_time: Option<u16>,
        pub total: WorkoutOrExerciseTotals,
        pub assets: EntityAssets,
        /// The indices of the exercises with which this has been superset with.
        pub superset_with: Vec<u16>,
    }

    #[derive(
        Debug,
        Serialize,
        Deserialize,
        Enum,
        Clone,
        Eq,
        PartialEq,
        FromJsonQueryResult,
        Copy,
        Default,
        ConfigEnum,
    )]
    pub enum UserUnitSystem {
        #[default]
        Metric,
        Imperial,
    }

    /// Information about a workout done.
    #[derive(
        Clone,
        Debug,
        Deserialize,
        Serialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        SimpleObject,
        Schematic,
    )]
    #[serde(rename_all = "snake_case")]
    pub struct WorkoutInformation {
        pub exercises: Vec<ProcessedExercise>,
        pub assets: EntityAssets,
    }

    /// The summary about an exercise done in a workout.
    #[derive(
        Clone,
        Debug,
        Deserialize,
        Serialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        SimpleObject,
        Schematic,
    )]
    #[serde(rename_all = "snake_case")]
    pub struct WorkoutSummaryExercise {
        pub num_sets: usize,
        #[serde(alias = "name")]
        pub id: String,
        pub lot: ExerciseLot,
        pub best_set: WorkoutSetRecord,
    }

    #[derive(
        Clone,
        Debug,
        Deserialize,
        Serialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        SimpleObject,
        Schematic,
    )]
    #[serde(rename_all = "snake_case")]
    pub struct WorkoutSummary {
        pub total: WorkoutOrExerciseTotals,
        pub exercises: Vec<WorkoutSummaryExercise>,
    }

    #[derive(
        Clone,
        Debug,
        PartialEq,
        Eq,
        Serialize,
        Deserialize,
        FromQueryResult,
        DerivePartialModel,
        SimpleObject,
    )]
    #[sea_orm(entity = "Workout")]
    pub struct WorkoutListItem {
        pub id: String,
        pub start_time: DateTimeUtc,
        pub end_time: DateTimeUtc,
        pub summary: WorkoutSummary,
        pub name: String,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
    pub struct UserWorkoutSetRecord {
        pub lot: SetLot,
        pub note: Option<String>,
        pub statistic: WorkoutSetStatistic,
        pub confirmed_at: Option<DateTimeUtc>,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
    pub struct UserExerciseInput {
        pub exercise_id: String,
        pub sets: Vec<UserWorkoutSetRecord>,
        pub notes: Vec<String>,
        pub rest_time: Option<u16>,
        pub assets: EntityAssets,
        pub superset_with: Vec<u16>,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
    pub struct UserWorkoutInput {
        #[graphql(skip_input)]
        // If specified, the workout will be created with this ID.
        pub id: Option<String>,
        pub repeated_from: Option<String>,
        pub name: String,
        pub comment: Option<String>,
        pub start_time: DateTimeUtc,
        pub end_time: DateTimeUtc,
        pub exercises: Vec<UserExerciseInput>,
        pub assets: EntityAssets,
    }
}
