use anyhow::{Result, anyhow};
use application_utils::get_base_http_client;
use async_trait::async_trait;
use chrono::NaiveDate;
use common_models::{EntityAssets, PersonSourceSpecifics, SearchDetails};
use common_utils::PAGE_SIZE;
use dependent_models::{
    MetadataPersonRelated, MetadataSearchSourceSpecifics, PersonDetails, SearchResults,
};
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    MangaSpecifics, MetadataDetails, MetadataSearchItem, PartialMetadataPerson,
    PartialMetadataWithoutId, PeopleSearchItem,
};
use reqwest::Client;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use traits::MediaProvider;

static URL: &str = "https://api.mangaupdates.com/v1";

#[derive(Debug, Clone)]
pub struct MangaUpdatesService {
    client: Client,
}

impl MangaUpdatesService {
    pub async fn new(_config: &config_definition::MangaUpdatesConfig) -> Result<Self> {
        let client = get_base_http_client(None);
        Ok(Self { client })
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
        let Some(input) = input else {
            return (None, None);
        };

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
        _display_nsfw: bool,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let page = page.unwrap_or(1);
        let data: MetadataSearchResponse<PersonItemResponse> = self
            .client
            .post(format!("{URL}/authors/search"))
            .json(&serde_json::json!({
                "page": page,
                "search": query,
                "perpage": PAGE_SIZE,
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
                name: s.hit_name,
                identifier: s.record.id.to_string(),
                ..Default::default()
            })
            .collect();
        Ok(SearchResults {
            items,
            details: SearchDetails {
                total: data.total_hits,
                next_page: (data.total_hits - (page * PAGE_SIZE) > 0).then(|| page + 1),
            },
        })
    }

    async fn person_details(
        &self,
        identity: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        let data: ItemAuthor = self
            .client
            .get(format!("{URL}/authors/{identity}"))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;
        let related_data: ItemPersonRelatedSeries = self
            .client
            .post(format!("{URL}/authors/{identity}/series"))
            .json(&serde_json::json!({ "orderby": "year" }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;
        let related_metadata = related_data
            .series_list
            .into_iter()
            .map(|r| MetadataPersonRelated {
                role: "Author".to_owned(),
                metadata: PartialMetadataWithoutId {
                    title: r.title,
                    lot: MediaLot::Manga,
                    source: MediaSource::MangaUpdates,
                    identifier: r.series_id.to_string(),
                    ..Default::default()
                },
                ..Default::default()
            })
            .collect_vec();
        let resp = PersonDetails {
            related_metadata,
            gender: data.gender,
            place: data.birthplace,
            name: data.name.unwrap(),
            identifier: identity.to_owned(),
            source: MediaSource::MangaUpdates,
            birth_date: data.birthday.and_then(|b| {
                if let (Some(y), Some(m), Some(d)) = (b.year, b.month, b.day) {
                    NaiveDate::from_ymd_opt(y, m, d)
                } else {
                    None
                }
            }),
            assets: EntityAssets {
                remote_images: Vec::from_iter(data.image.and_then(|i| i.url.original.clone())),
                ..Default::default()
            },
            ..Default::default()
        };
        Ok(resp)
    }

    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let data: MetadataItemRecord = self
            .client
            .get(format!("{URL}/series/{identifier}"))
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
                    role: a.lot.unwrap(),
                    identifier: ai.to_string(),
                    name: a.name.unwrap_or_default(),
                    source: MediaSource::MangaUpdates,
                    ..Default::default()
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
                .get(format!("{URL}/series/{series_id}"))
                .send()
                .await
                .map_err(|e| anyhow!(e))?
                .json::<MetadataItemRecord>()
                .await
            {
                suggestions.push(PartialMetadataWithoutId {
                    lot: MediaLot::Manga,
                    title: data.title.unwrap(),
                    source: MediaSource::MangaUpdates,
                    image: data.image.unwrap().url.original,
                    identifier: data.series_id.unwrap().to_string(),
                    ..Default::default()
                });
            }
        }

        let (volumes, status) = self.extract_status(data.status.clone());

        Ok(MetadataDetails {
            people,
            suggestions,
            lot: MediaLot::Manga,
            production_status: status,
            title: data.title.unwrap(),
            description: data.description,
            source: MediaSource::MangaUpdates,
            provider_rating: data.bayesian_rating,
            identifier: data.series_id.unwrap().to_string(),
            publish_year: data.year.and_then(|y| y.parse().ok()),
            assets: EntityAssets {
                remote_images: Vec::from_iter(data.image.unwrap().url.original),
                ..Default::default()
            },
            manga_specifics: Some(MangaSpecifics {
                volumes,
                url: data.url,
                chapters: data.latest_chapter.map(Decimal::from),
            }),
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
            ..Default::default()
        })
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        let search: MetadataSearchResponse<MetadataItemResponse> = self
            .client
            .post(format!("{URL}/series/search"))
            .json(&serde_json::json!({
                "search": query,
                "perpage": PAGE_SIZE,
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
        let next_page = (search.total_hits - ((page) * PAGE_SIZE) > 0).then(|| page + 1);
        Ok(SearchResults {
            items,
            details: SearchDetails {
                next_page,
                total: search.total_hits,
            },
        })
    }
}
