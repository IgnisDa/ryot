use async_graphql::{InputObject, SimpleObject};
use chrono::NaiveDate;
use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};

use crate::{
    providers::{
        anilist::AnilistService, audible::AudibleService, igdb::IgdbService,
        listennotes::ListennotesService, openlibrary::OpenlibraryService, tmdb::TmdbService,
    },
    traits::MediaProviderLanguages,
};

#[derive(
    Debug,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    InputObject,
    Eq,
    PartialEq,
    FromJsonQueryResult,
)]
pub struct UserFeaturesEnabledPreferences {
    pub anime: bool,
    pub audio_books: bool,
    pub books: bool,
    pub manga: bool,
    pub movies: bool,
    pub podcasts: bool,
    pub shows: bool,
    pub video_games: bool,
}

impl Default for UserFeaturesEnabledPreferences {
    fn default() -> Self {
        Self {
            anime: true,
            audio_books: true,
            books: true,
            manga: true,
            movies: true,
            podcasts: true,
            shows: true,
            video_games: true,
        }
    }
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
    FromJsonQueryResult,
)]
pub struct UserLocalizationPreferences {
    pub anilist: String,
    pub audible: String,
    pub igdb: String,
    pub listennotes: String,
    pub openlibrary: String,
    pub tmdb: String,
}

impl Default for UserLocalizationPreferences {
    fn default() -> Self {
        Self {
            anilist: AnilistService::default_language(),
            audible: AudibleService::default_language(),
            igdb: IgdbService::default_language(),
            listennotes: ListennotesService::default_language(),
            openlibrary: OpenlibraryService::default_language(),
            tmdb: TmdbService::default_language(),
        }
    }
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
pub struct UserPreferences {
    #[serde(default)]
    pub features_enabled: UserFeaturesEnabledPreferences,
    #[serde(default)]
    pub localization: UserLocalizationPreferences,
}

pub mod media {
    use super::*;

    #[derive(
        Debug, Serialize, Deserialize, SimpleObject, Clone, InputObject, PartialEq, Eq, Default,
    )]
    #[graphql(input_name = "AudioBookSpecificsInput")]
    pub struct AudioBookSpecifics {
        pub runtime: Option<i32>,
    }

    #[derive(
        Debug, Serialize, Deserialize, SimpleObject, Clone, InputObject, PartialEq, Eq, Default,
    )]
    #[graphql(input_name = "BookSpecificsInput")]
    pub struct BookSpecifics {
        pub pages: Option<i32>,
    }

    #[derive(
        Debug, Serialize, Deserialize, SimpleObject, Clone, InputObject, Eq, PartialEq, Default,
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
        pub total_episodes: i32,
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
    pub struct PodcastEpisode {
        #[serde(default)]
        pub number: i32,
        pub id: String,
        #[serde(rename = "audio_length_sec")]
        pub runtime: Option<i32>,
        #[serde(rename = "description")]
        pub overview: Option<String>,
        pub title: String,
        #[serde(rename = "pub_date_ms")]
        pub publish_date: i64,
        pub thumbnail: Option<String>,
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
    }
}

pub mod fitness {
    use async_graphql::Enum;

    use super::*;

    #[derive(
        Debug, Clone, Serialize, Enum, Copy, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseForce {
        Static,
        Pull,
        Push,
    }

    #[derive(
        Debug, Clone, Serialize, Enum, Copy, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseLevel {
        Beginner,
        Intermediate,
        Expert,
    }

    #[derive(
        Debug, Clone, Serialize, Enum, Copy, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseMechanic {
        Isolation,
        Compound,
    }

    #[derive(
        Debug, Clone, Serialize, Enum, Copy, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseEquipment {
        #[serde(rename = "medicine ball")]
        MedicineBall,
        Dumbbell,
        #[serde(rename = "body only")]
        BodyOnly,
        Bands,
        Kettlebells,
        #[serde(rename = "foam roll")]
        FoamRoll,
        Cable,
        Machine,
        Barbell,
        #[serde(rename = "exercise ball")]
        ExerciseBall,
        #[serde(rename = "e-z curl bar")]
        EZCurlBar,
        Other,
    }

    #[derive(
        Debug, Clone, Serialize, Enum, Copy, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseMuscle {
        Abdominals,
        Abductors,
        Adductors,
        Biceps,
        Calves,
        Chest,
        Forearms,
        Glutes,
        Hamstrings,
        Lats,
        #[serde(rename = "lower back")]
        LowerBack,
        #[serde(rename = "middle back")]
        MiddleBack,
        Neck,
        Quadriceps,
        Shoulders,
        Traps,
        Triceps,
    }

    #[derive(
        Debug, Clone, Serialize, Enum, Copy, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseCategory {
        Powerlifting,
        Strength,
        Stretching,
        Cardio,
        #[serde(rename = "olympic weightlifting")]
        OlympicWeightlifting,
        Strongman,
        Plyometrics,
    }

    #[derive(
        Debug, Clone, Serialize, SimpleObject, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "camelCase")]
    pub struct ExerciseAttributes {
        pub force: Option<ExerciseForce>,
        pub level: ExerciseLevel,
        pub mechanic: Option<ExerciseMechanic>,
        pub equipment: Option<ExerciseEquipment>,
        pub primary_muscles: Vec<ExerciseMuscle>,
        pub secondary_muscles: Vec<ExerciseMuscle>,
        pub category: ExerciseCategory,
        pub instructions: Vec<String>,
        #[serde(default)]
        pub images: Vec<String>,
        #[serde(default)]
        pub alternate_names: Vec<String>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct Exercise {
        #[serde(rename = "id")]
        pub identifier: String,
        #[serde(flatten)]
        pub attributes: ExerciseAttributes,
        pub name: String,
    }
}
