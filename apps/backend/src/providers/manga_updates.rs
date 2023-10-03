use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::NaiveDate;
use http_types::mime;
use itertools::Itertools;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use surf::{http::headers::ACCEPT, Client};

use crate::{
    config::MangaUpdatesConfig,
    entities::partial_metadata::PartialMetadataWithoutId,
    migrator::{MetadataLot, MetadataSource},
    models::{
        media::{
            MangaSpecifics, MediaDetails, MediaSearchItem, MediaSpecifics,
            MetadataImageForMediaDetails, MetadataImageLot, MetadataPerson, PartialMetadataPerson,
        },
        SearchDetails, SearchResults,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::get_base_http_client,
};

static URL: &str = "https://api.mangaupdates.com/v1/";

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
    pub async fn new(_config: &MangaUpdatesConfig, page_limit: i32) -> Self {
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
struct ItemCategory {
    category: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemBirthday {
    year: Option<i32>,
    month: Option<u32>,
    day: Option<u32>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemAuthor {
    author_id: Option<i128>,
    name: Option<String>,
    image: Option<ItemImage>,
    #[serde(rename = "type")]
    lot: Option<String>,
    birthday: Option<ItemBirthday>,
    birthplace: Option<String>,
    gender: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemPublisher {
    publisher_id: Option<i128>,
    name: Option<String>,
    info: Option<String>,
    site: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemPartialRecord {
    title: String,
    series_id: i128,
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemPersonRelatedSeries {
    series_list: Vec<ItemPartialRecord>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemRecord {
    series_id: Option<i128>,
    related_series_id: Option<i128>,
    title: Option<String>,
    description: Option<String>,
    image: Option<ItemImage>,
    status: Option<String>,
    url: Option<String>,
    authors: Option<Vec<ItemAuthor>>,
    publishers: Option<Vec<ItemPublisher>>,
    genres: Option<Vec<ItemGenre>>,
    categories: Option<Vec<ItemCategory>>,
    bayesian_rating: Option<Decimal>,
    recommendations: Option<Vec<ItemRecord>>,
    related_series: Option<Vec<ItemRecord>>,
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
    async fn person_details(&self, identity: &PartialMetadataPerson) -> Result<MetadataPerson> {
        Ok(if identity.role.as_str() == "Publisher" {
            let data: ItemPublisher = self
                .client
                .get(format!("publishers/{}", identity.identifier))
                .await
                .map_err(|e| anyhow!(e))?
                .body_json()
                .await
                .map_err(|e| anyhow!(e))?;
            let related_data: ItemPersonRelatedSeries = self
                .client
                .get(format!("publishers/{}/series", identity.identifier))
                .await
                .map_err(|e| anyhow!(e))?
                .body_json()
                .await
                .map_err(|e| anyhow!(e))?;
            let related = related_data
                .series_list
                .into_iter()
                .map(|r| {
                    (
                        "Publishing".to_owned(),
                        PartialMetadataWithoutId {
                            title: r.title,
                            identifier: r.series_id.to_string(),
                            source: MetadataSource::MangaUpdates,
                            lot: MetadataLot::Manga,
                            image: None,
                        },
                    )
                })
                .collect_vec();
            MetadataPerson {
                identifier: identity.identifier.to_owned(),
                source: MetadataSource::MangaUpdates,
                name: data.name.unwrap(),
                description: data.info,
                website: data.site,
                gender: None,
                place: None,
                images: None,
                death_date: None,
                birth_date: None,
                related,
            }
        } else {
            let data: ItemAuthor = self
                .client
                .get(format!("authors/{}", identity.identifier))
                .await
                .map_err(|e| anyhow!(e))?
                .body_json()
                .await
                .map_err(|e| anyhow!(e))?;
            let related_data: ItemPersonRelatedSeries = self
                .client
                .post(format!("authors/{}/series", identity.identifier))
                .body_json(&serde_json::json!({ "orderby": "year" }))
                .unwrap()
                .await
                .map_err(|e| anyhow!(e))?
                .body_json()
                .await
                .map_err(|e| anyhow!(e))?;
            let related = related_data
                .series_list
                .into_iter()
                .map(|r| {
                    (
                        "Author".to_owned(),
                        PartialMetadataWithoutId {
                            title: r.title,
                            identifier: r.series_id.to_string(),
                            source: MetadataSource::MangaUpdates,
                            lot: MetadataLot::Manga,
                            image: None,
                        },
                    )
                })
                .collect_vec();
            MetadataPerson {
                identifier: identity.identifier.to_owned(),
                source: MetadataSource::MangaUpdates,
                name: data.name.unwrap(),
                gender: data.gender,
                place: data.birthplace,
                images: Some(Vec::from_iter(data.image.and_then(|i| i.url.original))),
                birth_date: data.birthday.and_then(|b| {
                    if let (Some(y), Some(m), Some(d)) = (b.year, b.month, b.day) {
                        NaiveDate::from_ymd_opt(y, m, d)
                    } else {
                        None
                    }
                }),
                related,
                death_date: None,
                description: None,
                website: None,
            }
        })
    }

    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let data: ItemRecord = self
            .client
            .get(format!("series/{}", identifier))
            .await
            .map_err(|e| anyhow!(e))?
            .body_json()
            .await
            .map_err(|e| anyhow!(e))?;
        let mut people = data
            .authors
            .unwrap_or_default()
            .into_iter()
            .map(|a| PartialMetadataPerson {
                identifier: a.author_id.unwrap().to_string(),
                role: a.lot.unwrap(),
                source: MetadataSource::MangaUpdates,
            })
            .collect_vec();
        people.extend(data.publishers.unwrap_or_default().into_iter().map(|a| {
            PartialMetadataPerson {
                identifier: a.publisher_id.unwrap().to_string(),
                role: "Publisher".to_owned(),
                source: MetadataSource::MangaUpdates,
            }
        }));
        let mut suggestions = vec![];
        for series_id in data
            .recommendations
            .unwrap_or_default()
            .into_iter()
            .map(|r| r.series_id.unwrap())
            .chain(
                data.related_series
                    .unwrap_or_default()
                    .into_iter()
                    .map(|r| r.related_series_id.unwrap()),
            )
        {
            if let Ok(data) = self
                .client
                .get(format!("series/{}", series_id))
                .await
                .map_err(|e| anyhow!(e))?
                .body_json::<ItemRecord>()
                .await
            {
                suggestions.push(PartialMetadataWithoutId {
                    title: data.title.unwrap(),
                    image: data.image.unwrap().url.original,
                    identifier: data.series_id.unwrap().to_string(),
                    source: MetadataSource::MangaUpdates,
                    lot: MetadataLot::Manga,
                });
            }
        }
        let data = MediaDetails {
            identifier: data.series_id.unwrap().to_string(),
            title: data.title.unwrap(),
            description: data.description,
            source: MetadataSource::MangaUpdates,
            lot: MetadataLot::Manga,
            people,
            production_status: data.status.unwrap_or_else(|| "Released".to_string()),
            genres: data
                .genres
                .unwrap_or_default()
                .into_iter()
                .map(|g| g.genre)
                .chain(
                    data.categories
                        .unwrap_or_default()
                        .into_iter()
                        .map(|r| r.category),
                )
                .collect(),
            url_images: Vec::from_iter(data.image.unwrap().url.original)
                .into_iter()
                .map(|i| MetadataImageForMediaDetails {
                    image: i,
                    lot: MetadataImageLot::Poster,
                })
                .collect(),
            publish_year: data.year.and_then(|y| y.parse().ok()),
            specifics: MediaSpecifics::Manga(MangaSpecifics {
                chapters: data.latest_chapter,
                volumes: None,
                url: data.url,
            }),
            suggestions,
            provider_rating: data.bayesian_rating,
            videos: vec![],
            publish_date: None,
            group_identifiers: vec![],
            is_nsfw: None,
            creators: vec![],
            s3_images: vec![],
        };
        Ok(data)
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
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
                identifier: s.record.series_id.unwrap().to_string(),
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
