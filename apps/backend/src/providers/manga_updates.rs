use anyhow::{anyhow, Result};
use async_trait::async_trait;
use http_types::mime;
use serde::{Deserialize, Serialize};
use surf::{http::headers::ACCEPT, Client};

use crate::{
    config::MangaMangaUpdatesConfig,
    migrator::{MetadataImageLot, MetadataLot, MetadataSource},
    models::{
        media::{
            MangaSpecifics, MediaDetails, MediaSearchItem, MediaSpecifics, MetadataCreator,
            MetadataImage, MetadataSuggestion,
        },
        SearchDetails, SearchResults, StoredUrl,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::get_base_http_client,
};

pub static URL: &str = "https://api.mangaupdates.com/v1/";

#[derive(Debug, Clone)]
pub struct MangaUpdatesService {
    client: Client,
    page_limit: i32,
}

impl MediaProviderLanguages for MangaUpdatesService {
    fn supported_languages() -> Vec<String> {
        vec!["us".to_owned()]
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

impl MangaUpdatesService {
    pub async fn new(_config: &MangaMangaUpdatesConfig, page_limit: i32) -> Self {
        let client = get_base_http_client(URL, vec![(ACCEPT, mime::JSON)]);
        Self { client, page_limit }
    }
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemUrl {
    original: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemImage {
    url: ItemUrl,
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemGenre {
    genre: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemAuthor {
    author_id: Option<i128>,
    id: Option<i128>,
    name: String,
    image: Option<ItemImage>,
    #[serde(rename = "type")]
    lot: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemRecord {
    series_id: i128,
    title: Option<String>,
    description: Option<String>,
    image: Option<ItemImage>,
    status: Option<String>,
    url: Option<String>,
    authors: Option<Vec<ItemAuthor>>,
    genres: Option<Vec<ItemGenre>>,
    recommendations: Option<Vec<ItemRecord>>,
    latest_chapter: Option<i32>,
    year: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemResponse {
    hit_title: String,
    record: ItemRecord,
}

#[derive(Serialize, Deserialize, Debug)]
struct SearchResponse {
    total_hits: i32,
    results: Vec<ItemResponse>,
}

#[async_trait]
impl MediaProvider for MangaUpdatesService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let data: ItemRecord = self
            .client
            .get(format!("series/{}", identifier))
            .await
            .map_err(|e| anyhow!(e))?
            .body_json()
            .await
            .map_err(|e| anyhow!(e))?;
        let mut creators = vec![];
        for author in data.authors.unwrap_or_default() {
            let data: ItemAuthor = self
                .client
                .get(format!("authors/{}", author.author_id.unwrap()))
                .await
                .map_err(|e| anyhow!(e))?
                .body_json()
                .await
                .map_err(|e| anyhow!(e))?;
            creators.push(MetadataCreator {
                name: data.name,
                role: author.lot.unwrap(),
                image: data.image.unwrap().url.original,
            });
        }
        let mut suggestions = vec![];
        for series in data.recommendations.unwrap_or_default() {
            let data: ItemRecord = self
                .client
                .get(format!("series/{}", series.series_id))
                .await
                .map_err(|e| anyhow!(e))?
                .body_json()
                .await
                .map_err(|e| anyhow!(e))?;
            suggestions.push(MetadataSuggestion {
                title: data.title.unwrap(),
                image: data.image.unwrap().url.original,
                identifier: data.series_id.to_string(),
                source: MetadataSource::MangaUpdates,
                lot: MetadataLot::Manga,
            });
        }
        let data = MediaDetails {
            identifier: data.series_id.to_string(),
            title: data.title.unwrap(),
            description: data.description,
            source: MetadataSource::MangaUpdates,
            lot: MetadataLot::Manga,
            production_status: data.status.unwrap_or_else(|| "Released".to_string()),
            genres: data
                .genres
                .unwrap_or_default()
                .into_iter()
                .map(|g| g.genre)
                .collect(),
            images: Vec::from_iter(data.image.unwrap().url.original)
                .into_iter()
                .map(|i| MetadataImage {
                    url: StoredUrl::Url(i),
                    lot: MetadataImageLot::Poster,
                })
                .collect(),
            publish_date: None,
            publish_year: data.year.and_then(|y| y.parse().ok()),
            specifics: MediaSpecifics::Manga(MangaSpecifics {
                chapters: data.latest_chapter,
                volumes: None,
                url: data.url,
            }),
            creators,
            suggestions,
        };
        Ok(data)
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let page = page.unwrap_or(1);
        let search: SearchResponse = self
            .client
            .post("series/search")
            .body_json(&serde_json::json!({
                "search": query,
                "perpage": self.page_limit,
                "page": page
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?
            .body_json()
            .await
            .map_err(|e| anyhow!(e))?;
        let items = search
            .results
            .into_iter()
            .map(|s| MediaSearchItem {
                identifier: s.record.series_id.to_string(),
                title: s.hit_title,
                image: s.record.image.unwrap().url.original,
                publish_year: s.record.year.and_then(|y| y.parse().ok()),
            })
            .collect();
        let next_page = if search.total_hits - ((page) * self.page_limit) > 0 {
            Some(page + 1)
        } else {
            None
        };
        Ok(SearchResults {
            details: SearchDetails {
                total: search.total_hits,
                next_page,
            },
            items,
        })
    }
}
