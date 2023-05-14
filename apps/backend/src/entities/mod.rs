//! `SeaORM` Entity. Generated by sea-orm-codegen 0.11.3

pub mod prelude;

pub mod audio_book;
pub mod book;
pub mod collection;
pub mod creator;
pub mod genre;
pub mod media_import_report;
pub mod metadata;
pub mod metadata_image;
pub mod metadata_to_collection;
pub mod metadata_to_creator;
pub mod metadata_to_genre;
pub mod movie;
pub mod podcast;
pub mod review;
pub mod seen;
pub mod show;
pub mod summary;
pub mod token;
pub mod user;
pub mod user_to_metadata;
pub mod video_game;

pub mod utils {
    use async_graphql::SimpleObject;
    use sea_orm::FromJsonQueryResult;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject)]
    pub struct SeenShowExtraInformation {
        pub season: i32,
        pub episode: i32,
    }

    #[derive(Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject)]
    pub struct SeenPodcastExtraInformation {
        pub episode_id: String,
    }

    #[derive(Debug, PartialEq, Eq, Serialize, Deserialize, Clone, FromJsonQueryResult)]
    pub enum SeenExtraInformation {
        Show(SeenShowExtraInformation),
        Podcast(SeenPodcastExtraInformation),
    }
}
