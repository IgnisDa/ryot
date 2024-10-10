use anyhow::{anyhow, Result};
use application_utils::get_base_http_client;
use async_trait::async_trait;
use chrono::NaiveDate;
use common_models::SearchDetails;
use dependent_models::SearchResults;
use enums::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    MangaSpecifics, MediaDetails, MetadataImageForMediaDetails, MetadataPerson,
    MetadataPersonRelated, MetadataSearchItem, PartialMetadataPerson, PartialMetadataWithoutId,
    PeopleSearchItem, PersonSourceSpecifics,
};
use reqwest::Client;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use traits::{MediaProvider, MediaProviderLanguages};

static URL: &str = "https://api.mangaupdates.com/v1";

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
    pub async fn new(_config: &config::MangaUpdatesConfig, page_limit: i32) -> Self {
        let client = get_base_http_client(None);
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
struct MetadataItemRecord {
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
    recommendations: Option<Vec<MetadataItemRecord>>,
    related_series: Option<Vec<MetadataItemRecord>>,
    latest_chapter: Option<i32>,
    year: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct MetadataItemResponse {
    hit_title: String,
    record: MetadataItemRecord,
}

#[derive(Serialize, Deserialize, Debug)]
struct PersonItemRecord {
    id: i128,
    name: String,
}
#[derive(Serialize, Deserialize, Debug)]
struct PersonItemResponse {
    hit_name: String,
    record: PersonItemRecord,
}

#[derive(Serialize, Deserialize, Debug)]
struct MetadataSearchResponse<T> {
    total_hits: i32,
    results: Vec<T>,
}

impl MangaUpdatesService {
    fn extract_status(&self, input: Option<String>) -> (Option<i32>, Option<String>) {
        if input.is_none() {
            return (None, None);
        }

        let input = input.unwrap();
        let first_part = input.split("<BR>").next().unwrap_or("").trim();
        let parts: Vec<&str> = first_part.split_whitespace().collect();

        let volumes = parts.first().and_then(|s| s.parse::<i32>().ok());
        let status = parts.get(2).and_then(|&s| {
            if s.starts_with('(') && s.ends_with(')') {
                Some(s[1..s.len() - 1].to_string())
            } else {
                None
            }
        });

        (volumes, status)
    }
}

#[async_trait]
impl MediaProvider for MangaUpdatesService {
    async fn people_search(
        &self,
        query: &str,
        page: Option<i32>,
        _source_specifics: &Option<PersonSourceSpecifics>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let data: MetadataSearchResponse<PersonItemResponse> = self
            .client
            .post(format!("{}/authors/search", URL))
            .json(&serde_json::json!({
                "search": query,
                "perpage": self.page_limit,
                "page": page.unwrap_or(1)
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;
        let items = data
            .results
            .into_iter()
            .map(|s| PeopleSearchItem {
                identifier: s.record.id.to_string(),
                name: s.hit_name,
                image: None,
                birth_year: None,
            })
            .collect();
        Ok(SearchResults {
            details: SearchDetails {
                total: data.total_hits,
                next_page: if data.total_hits - ((page.unwrap_or(1)) * self.page_limit) > 0 {
                    Some(page.unwrap_or(1) + 1)
                } else {
                    None
                },
            },
            items,
        })
    }

    async fn person_details(
        &self,
        identity: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<MetadataPerson> {
        let data: ItemAuthor = self
            .client
            .get(format!("{}/authors/{}", URL, identity))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;
        let related_data: ItemPersonRelatedSeries = self
            .client
            .post(format!("{}/authors/{}/series", URL, identity))
            .json(&serde_json::json!({ "orderby": "year" }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;
        let related = related_data
            .series_list
            .into_iter()
            .map(|r| MetadataPersonRelated {
                role: "Author".to_owned(),
                metadata: PartialMetadataWithoutId {
                    title: r.title,
                    identifier: r.series_id.to_string(),
                    source: MediaSource::MangaUpdates,
                    lot: MediaLot::Manga,
                    image: None,
                    is_recommendation: None,
                },
            })
            .collect_vec();
        let resp = MetadataPerson {
            identifier: identity.to_owned(),
            source: MediaSource::MangaUpdates,
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
            source_specifics: None,
        };
        Ok(resp)
    }

    async fn metadata_details(&self, identifier: &str) -> Result<MediaDetails> {
        let data: MetadataItemRecord = self
            .client
            .get(format!("{}/series/{}", URL, identifier))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;
        let people = data
            .authors
            .unwrap_or_default()
            .into_iter()
            .flat_map(|a| {
                a.author_id.map(|ai| PartialMetadataPerson {
                    identifier: ai.to_string(),
                    name: a.name.unwrap_or_default(),
                    role: a.lot.unwrap(),
                    source: MediaSource::MangaUpdates,
                    character: None,
                    source_specifics: None,
                })
            })
            .collect_vec();
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
                .get(format!("{}/series/{}", URL, series_id))
                .send()
                .await
                .map_err(|e| anyhow!(e))?
                .json::<MetadataItemRecord>()
                .await
            {
                suggestions.push(PartialMetadataWithoutId {
                    title: data.title.unwrap(),
                    image: data.image.unwrap().url.original,
                    identifier: data.series_id.unwrap().to_string(),
                    source: MediaSource::MangaUpdates,
                    lot: MediaLot::Manga,
                    is_recommendation: None,
                });
            }
        }

        let (volumes, status) = self.extract_status(data.status.clone());

        Ok(MediaDetails {
            identifier: data.series_id.unwrap().to_string(),
            title: data.title.unwrap(),
            description: data.description,
            source: MediaSource::MangaUpdates,
            lot: MediaLot::Manga,
            people,
            production_status: status,
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
                .map(|i| MetadataImageForMediaDetails { image: i })
                .collect(),
            publish_year: data.year.and_then(|y| y.parse().ok()),
            manga_specifics: Some(MangaSpecifics {
                chapters: data.latest_chapter.map(Decimal::from),
                url: data.url,
                volumes,
            }),
            suggestions,
            provider_rating: data.bayesian_rating,
            ..Default::default()
        })
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        let search: MetadataSearchResponse<MetadataItemResponse> = self
            .client
            .post(format!("{}/series/search", URL))
            .json(&serde_json::json!({
                "search": query,
                "perpage": self.page_limit,
                "page": page
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;
        let items = search
            .results
            .into_iter()
            .map(|s| MetadataSearchItem {
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
