use common_models::StringIdObject;
use rust_decimal::Decimal;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_with::{formats::Flexible, serde_as, TimestampSeconds};
use strum::Display;

pub mod audiobookshelf {
    use super::*;

    #[derive(Debug, Serialize, Deserialize, Clone, Display)]
    #[serde(rename_all = "snake_case")]
    pub enum MediaType {
        Book,
        Podcast,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ItemProgress {
        pub progress: Decimal,
        pub is_finished: bool,
        pub ebook_progress: Option<Decimal>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    pub struct ItemMetadata {
        pub title: String,
        pub id: Option<String>,
        pub asin: Option<String>,
        pub isbn: Option<String>,
        pub itunes_id: Option<String>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    pub struct ItemMedia {
        pub metadata: ItemMetadata,
        pub ebook_format: Option<String>,
        pub episodes: Option<Vec<ItemMetadata>>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct RecentEpisode {
        pub id: String,
        pub title: String,
        pub season: Option<String>,
        pub episode: Option<String>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Item {
        pub id: String,
        pub name: Option<String>,
        pub media: Option<ItemMedia>,
        pub media_type: Option<MediaType>,
        pub recent_episode: Option<RecentEpisode>,
        pub user_media_progress: Option<ItemProgress>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Response {
        pub library_items: Vec<Item>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct LibrariesListResponse {
        pub libraries: Vec<Item>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct ListResponse {
        pub results: Vec<Item>,
    }
}

pub mod plex {
    use super::*;

    #[serde_as]
    #[derive(Debug, Deserialize, Serialize)]
    pub struct PlexMetadataItem {
        pub title: String,
        #[serde(rename = "type")]
        pub item_type: String,
        #[serde(rename = "ratingKey")]
        pub rating_key: Option<String>,
        pub key: String,
        #[serde(rename = "Guid")]
        pub guid: Option<Vec<StringIdObject>>,
        #[serde_as(as = "Option<TimestampSeconds<i64, Flexible>>")]
        #[serde(rename = "lastViewedAt")]
        pub last_viewed_at: Option<DateTimeUtc>,
        pub index: Option<i32>,
        #[serde(rename = "parentIndex")]
        pub parent_index: Option<i32>,
    }

    #[derive(Debug, Deserialize, Serialize)]
    #[serde(rename_all = "PascalCase")]
    pub struct PlexLibrary {
        pub directory: Vec<PlexMetadataItem>,
    }

    #[derive(Debug, Deserialize, Serialize)]
    #[serde(rename_all = "PascalCase")]
    pub struct PlexMetadata {
        pub metadata: Vec<PlexMetadataItem>,
    }

    #[derive(Debug, Deserialize, Serialize)]
    #[serde(rename_all = "PascalCase")]
    pub struct PlexMediaResponse<T> {
        pub media_container: T,
    }
}
