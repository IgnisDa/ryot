use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
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
