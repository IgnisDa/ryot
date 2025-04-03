use async_graphql::Enum;
use enum_meta::{Meta, meta};
use schematic::ConfigEnum;
use sea_orm::{DeriveActiveEnum, EnumIter, FromJsonQueryResult};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};
use strum::Display;

/// The different types of media that can be stored.
#[derive(
    Eq,
    Enum,
    Copy,
    Hash,
    Debug,
    Clone,
    Default,
    EnumIter,
    PartialEq,
    Serialize,
    ConfigEnum,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "snake_case")]
pub enum MediaLot {
    #[default]
    Book,
    Show,
    Movie,
    Anime,
    Manga,
    Music,
    Podcast,
    AudioBook,
    VideoGame,
    VisualNovel,
}

meta! {
    MediaLot, Vec<MediaSource>;

    AudioBook, vec![MediaSource::Audible];
    Book, vec![
        MediaSource::Openlibrary,
        MediaSource::GoogleBooks,
        MediaSource::Hardcover,
    ];
    Podcast, vec![
        MediaSource::Itunes,
        MediaSource::Listennotes,
    ];
    VideoGame, vec![MediaSource::Igdb];
    Anime, vec![
        MediaSource::Anilist,
        MediaSource::Mal,
    ];
    Manga, vec![
        MediaSource::Anilist,
        MediaSource::MangaUpdates,
        MediaSource::Mal,
    ];
    Movie, vec![MediaSource::Tmdb];
    Music, vec![MediaSource::YoutubeMusic];
    Show, vec![MediaSource::Tmdb];
    VisualNovel, vec![MediaSource::Vndb];
}

/// The different sources (or providers) from which data can be obtained from.
#[derive(
    Eq,
    Copy,
    Enum,
    Hash,
    Clone,
    Debug,
    Default,
    EnumIter,
    PartialEq,
    Serialize,
    ConfigEnum,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "snake_case")]
pub enum MediaSource {
    Mal,
    Igdb,
    Tmdb,
    Vndb,
    #[default]
    Custom,
    Itunes,
    Anilist,
    Audible,
    Hardcover,
    Listennotes,
    GoogleBooks,
    Openlibrary,
    MangaUpdates,
    YoutubeMusic,
}

meta! {
    MediaSource, Option<MediaLot>;

    Mal, None;
    Vndb, None;
    Custom, None;
    Itunes, None;
    Anilist, None;
    Audible, None;
    Listennotes, None;
    GoogleBooks, None;
    Openlibrary, None;
    MangaUpdates, None;
    Tmdb, Some(MediaLot::Movie);
    Igdb, Some(MediaLot::VideoGame);
    Hardcover, Some(MediaLot::Book);
    YoutubeMusic, Some(MediaLot::Music);
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize, Enum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
pub enum UserLot {
    Admin,
    Normal,
}

#[derive(
    Eq,
    Ord,
    Hash,
    Copy,
    Enum,
    Debug,
    Clone,
    Display,
    Default,
    EnumIter,
    PartialEq,
    Serialize,
    PartialOrd,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "snake_case")]
pub enum EntityLot {
    #[default]
    Metadata,
    Person,
    Review,
    Workout,
    Exercise,
    Collection,
    MetadataGroup,
    WorkoutTemplate,
    UserMeasurement,
}

// The different possible states of a seen item.
#[derive(
    Eq,
    Enum,
    Copy,
    Debug,
    Clone,
    Display,
    EnumIter,
    PartialEq,
    Serialize,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
pub enum SeenState {
    Dropped,
    OnAHold,
    Completed,
    InProgress,
}

#[derive(
    Eq,
    Enum,
    Copy,
    Debug,
    Clone,
    Default,
    EnumIter,
    PartialEq,
    Serialize,
    ConfigEnum,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
pub enum Visibility {
    #[default]
    Public,
    Private,
}

#[derive(
    Eq,
    Enum,
    Copy,
    Debug,
    Clone,
    Display,
    EnumIter,
    PartialEq,
    Serialize,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
pub enum ImportSource {
    Igdb,
    Imdb,
    Plex,
    Hevy,
    Trakt,
    Movary,
    Anilist,
    Jellyfin,
    OpenScale,
    StrongApp,
    Goodreads,
    Storygraph,
    Myanimelist,
    GenericJson,
    Mediatracker,
    Audiobookshelf,
}

#[derive(
    Eq,
    Copy,
    Enum,
    Hash,
    Debug,
    Clone,
    Default,
    EnumIter,
    PartialEq,
    Serialize,
    ConfigEnum,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "snake_case")]
pub enum ExerciseMuscle {
    Lats,
    Neck,
    Traps,
    Chest,
    Biceps,
    Calves,
    Glutes,
    Triceps,
    Forearms,
    Abductors,
    Adductors,
    #[strum(serialize = "lower_back")]
    #[serde(alias = "lower back")]
    LowerBack,
    Shoulders,
    #[default]
    Abdominals,
    Hamstrings,
    #[strum(serialize = "middle_back")]
    #[serde(alias = "middle back")]
    MiddleBack,
    Quadriceps,
}

#[derive(
    Eq,
    Copy,
    Enum,
    Hash,
    Clone,
    Debug,
    Default,
    EnumIter,
    PartialEq,
    Serialize,
    ConfigEnum,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "snake_case")]
pub enum ExerciseForce {
    #[default]
    Pull,
    Push,
    Static,
}

#[derive(
    Eq,
    Enum,
    Copy,
    Hash,
    Clone,
    Debug,
    Default,
    EnumIter,
    PartialEq,
    Serialize,
    ConfigEnum,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "snake_case")]
pub enum ExerciseLevel {
    #[default]
    Beginner,
    Expert,
    Intermediate,
}

#[derive(
    Eq,
    Hash,
    Enum,
    Copy,
    Debug,
    Clone,
    EnumIter,
    PartialEq,
    Serialize,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "snake_case")]
pub enum ExerciseMechanic {
    Compound,
    Isolation,
}

#[derive(
    Eq,
    Hash,
    Enum,
    Copy,
    Debug,
    Clone,
    Default,
    EnumIter,
    PartialEq,
    Serialize,
    ConfigEnum,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "snake_case")]
pub enum ExerciseEquipment {
    Bands,
    Cable,
    Other,
    #[default]
    Barbell,
    Machine,
    BodyOnly,
    Dumbbell,
    #[serde(alias = "foam roll")]
    FoamRoll,
    #[serde(alias = "e-z curl bar")]
    EZCurlBar,
    #[serde(alias = "body only")]
    Kettlebells,
    #[serde(alias = "exercise ball")]
    ExerciseBall,
    #[serde(alias = "medicine ball")]
    MedicineBall,
}

/// The different types of exercises that can be done.
#[derive(
    Eq,
    Enum,
    Copy,
    Hash,
    Clone,
    Debug,
    Default,
    EnumIter,
    PartialEq,
    Serialize,
    ConfigEnum,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "snake_case")]
pub enum ExerciseLot {
    Reps,
    Duration,
    #[default]
    RepsAndWeight,
    RepsAndDuration,
    DistanceAndDuration,
    RepsAndDurationAndDistance,
}

meta! {
    ExerciseLot, Vec<WorkoutSetPersonalBest>;

    Reps, vec![WorkoutSetPersonalBest::Reps];
    Duration, vec![WorkoutSetPersonalBest::Time];
    RepsAndDuration, vec![
        WorkoutSetPersonalBest::Reps,
        WorkoutSetPersonalBest::Time
    ];
    DistanceAndDuration, vec![
        WorkoutSetPersonalBest::Pace,
        WorkoutSetPersonalBest::Time,
        WorkoutSetPersonalBest::Distance,
    ];
    RepsAndDurationAndDistance, vec![
        WorkoutSetPersonalBest::Reps,
        WorkoutSetPersonalBest::Pace,
        WorkoutSetPersonalBest::Time,
        WorkoutSetPersonalBest::Distance,
    ];
    RepsAndWeight, vec![
        WorkoutSetPersonalBest::Reps,
        WorkoutSetPersonalBest::OneRm,
        WorkoutSetPersonalBest::Weight,
        WorkoutSetPersonalBest::Volume,
    ];
}

#[derive(
    Eq,
    Enum,
    Copy,
    Hash,
    Debug,
    Clone,
    Default,
    EnumIter,
    Serialize,
    PartialEq,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
pub enum ExerciseSource {
    Github,
    #[default]
    Custom,
}

/// The different types of personal bests that can be achieved on a set.
#[derive(
    Eq,
    Enum,
    Copy,
    Clone,
    Debug,
    Default,
    PartialEq,
    Serialize,
    ConfigEnum,
    Deserialize,
    FromJsonQueryResult,
)]
#[serde(rename_all = "snake_case")]
pub enum WorkoutSetPersonalBest {
    Time,
    Pace,
    Reps,
    OneRm,
    Volume,
    #[default]
    Weight,
    Distance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
pub enum MetadataToMetadataRelation {
    Suggestion,
}

#[derive(
    Eq,
    Enum,
    Copy,
    Hash,
    Clone,
    Debug,
    Display,
    EnumIter,
    Serialize,
    PartialEq,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[strum(serialize_all = "snake_case")]
pub enum UserToMediaReason {
    // There is at-least one element in the seen history
    Seen,
    Owned,
    // User has watched this media completely (mostly applies to shows, podcasts etc.)
    Finished,
    Reviewed,
    Reminder,
    Watchlist,
    Collection,
    Monitoring,
}

#[derive(
    Eq,
    Enum,
    Copy,
    Hash,
    Clone,
    Debug,
    Display,
    EnumIter,
    Serialize,
    PartialEq,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationLot {
    Yank,
    Sink,
    Push,
}

#[derive(
    Eq,
    Copy,
    Hash,
    Enum,
    Clone,
    Debug,
    Display,
    EnumIter,
    Serialize,
    PartialEq,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationProvider {
    Emby,
    Kodi,
    Komga,
    Radarr,
    Sonarr,
    PlexSink,
    PlexYank,
    GenericJson,
    YoutubeMusic,
    JellyfinPush,
    JellyfinSink,
    Audiobookshelf,
}

#[derive(
    Eq,
    Enum,
    Copy,
    Clone,
    Debug,
    Display,
    EnumIter,
    PartialEq,
    Serialize,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "snake_case")]
pub enum NotificationPlatformLot {
    Ntfy,
    Gotify,
    Apprise,
    Discord,
    PushOver,
    Telegram,
    PushSafer,
    PushBullet,
}

#[derive(
    Eq,
    Enum,
    Copy,
    Clone,
    Debug,
    Display,
    EnumIter,
    PartialEq,
    Serialize,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "PascalCase",
    db_type = "String(StringLen::None)"
)]
pub enum UserNotificationContent {
    ReviewPosted,
    MetadataPublished,
    NewWorkoutCreated,
    OutdatedSeenEntries,
    MetadataStatusChanged,
    MetadataEpisodeReleased,
    PersonMetadataAssociated,
    MetadataReleaseDateChanged,
    MetadataEpisodeNameChanged,
    MetadataEpisodeImagesChanged,
    PersonMetadataGroupAssociated,
    MetadataNumberOfSeasonsChanged,
    MetadataChaptersOrEpisodesChanged,
    NotificationFromReminderCollection,
    EntityRemovedFromMonitoringCollection,
    IntegrationDisabledDueToTooManyErrors,
}
