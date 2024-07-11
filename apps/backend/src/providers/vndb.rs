use anyhow::{anyhow, Result};
use async_trait::async_trait;
use database::{MediaLot, MediaSource};
use itertools::Itertools;
use reqwest::Client;
use rs_utils::{convert_date_to_year, convert_string_to_date};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::{
    models::{
        media::{
            MediaDetails, MetadataImageForMediaDetails, MetadataPerson, MetadataSearchItem,
            PartialMetadataPerson, PeopleSearchItem, PersonSourceSpecifics, VisualNovelSpecifics,
        },
        NamedObject, SearchDetails, SearchResults,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::get_base_http_client,
};

static URL: &str = "https://api.vndb.org/kana/";
const METADATA_FIELDS_SMALL: &str = "title,image.url,released,screenshots.url,developers.name";
const METADATA_FIELDS: &str = const_str::concat!(
    METADATA_FIELDS_SMALL,
    ",",
    "length_minutes,tags.name,developers.id,devstatus,description,rating"
);

#[derive(Debug, Clone)]
pub struct VndbService {
    client: Client,
    page_limit: i32,
}

impl MediaProviderLanguages for VndbService {
    fn supported_languages() -> Vec<String> {
        vec!["us".to_owned()]
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

impl VndbService {
    pub async fn new(_config: &config::VisualNovelConfig, page_limit: i32) -> Self {
        let client = get_base_http_client(URL, None);
        Self { client, page_limit }
    }
}

#[derive(Serialize, Deserialize, Debug)]
struct ImageLinks {
    url: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct Developer {
    id: String,
    name: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemResponse {
    id: String,
    #[serde(alias = "name")]
    title: Option<String>,
    rating: Option<Decimal>,
    released: Option<String>,
    description: Option<String>,
    image: Option<ImageLinks>,
    length_minutes: Option<i32>,
    devstatus: Option<i32>,
    developers: Option<Vec<Developer>>,
    screenshots: Option<Vec<ImageLinks>>,
    tags: Option<Vec<NamedObject>>,
}

#[derive(Serialize, Deserialize, Debug)]
struct SearchResponse {
    count: i32,
    more: bool,
    results: Option<Vec<ItemResponse>>,
}

#[async_trait]
impl MediaProvider for VndbService {
    async fn people_search(
        &self,
        query: &str,
        page: Option<i32>,
        _source_specifics: &Option<PersonSourceSpecifics>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let data = self
            .client
            .post("producer")
            .json(&serde_json::json!({
                "filters": format!(r#"["search", "=", "{}"]"#, query),
                "count": true,
                "fields": "id,name",
                "results": self.page_limit,
                "page": page
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json::<SearchResponse>()
            .await
            .map_err(|e| anyhow!(e))?;
        let resp = data
            .results
            .unwrap_or_default()
            .into_iter()
            .map(|b| PeopleSearchItem {
                identifier: b.id,
                name: b.title.unwrap(),
                image: None,
                birth_year: None,
            })
            .collect();
        let next_page = if data.more {
            Some(page.unwrap_or(1) + 1)
        } else {
            None
        };
        Ok(SearchResults {
            details: SearchDetails {
                total: data.count,
                next_page,
            },
            items: resp,
        })
    }

    async fn person_details(
        &self,
        identifier: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<MetadataPerson> {
        let rsp = self
            .client
            .post("producer")
            .json(&serde_json::json!({
                "filters": format!(r#"["id", "=", "{}"]"#, identifier),
                "count": true,
                "fields": "id,name,description"
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let data: SearchResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let item = data.results.unwrap_or_default().pop().unwrap();
        Ok(MetadataPerson {
            identifier: item.id,
            source: MediaSource::Vndb,
            name: item.title.unwrap(),
            description: item.description,
            related: vec![],
            gender: None,
            images: None,
            death_date: None,
            birth_date: None,
            place: None,
            website: None,
            source_specifics: None,
        })
    }

    async fn metadata_details(&self, identifier: &str) -> Result<MediaDetails> {
        let rsp = self
            .client
            .post("vn")
            .json(&serde_json::json!({
                "filters": format!(r#"["id", "=", "{}"]"#, identifier),
                "count": true,
                "fields": METADATA_FIELDS
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let data: SearchResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let item = data.results.unwrap_or_default().pop().unwrap();
        let d = self.vndb_response_to_search_response(item);
        Ok(d)
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        let rsp = self
            .client
            .post("vn")
            .json(&serde_json::json!({
                "filters": format!(r#"["search", "=", "{}"]"#, query),
                "fields": METADATA_FIELDS_SMALL,
                "count": true,
                "results": self.page_limit,
                "page": page
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: SearchResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .results
            .unwrap_or_default()
            .into_iter()
            .map(|b| {
                let MediaDetails {
                    identifier,
                    title,
                    url_images,
                    publish_year,
                    ..
                } = self.vndb_response_to_search_response(b);
                let image = url_images.first().map(|i| i.image.clone());
                MetadataSearchItem {
                    identifier,
                    title,
                    image,
                    publish_year,
                }
            })
            .collect();
        let next_page = if search.more { Some(page + 1) } else { None };
        Ok(SearchResults {
            details: SearchDetails {
                total: search.count,
                next_page,
            },
            items: resp,
        })
    }
}

impl VndbService {
    fn vndb_response_to_search_response(&self, item: ItemResponse) -> MediaDetails {
        let mut images = vec![];
        if let Some(il) = item.image {
            images.push(il.url);
        };
        for i in item.screenshots.unwrap_or_default() {
            images.push(i.url);
        }
        let images = images
            .into_iter()
            .map(|a| MetadataImageForMediaDetails { image: a });
        let people = item
            .developers
            .unwrap_or_default()
            .into_iter()
            .map(|a| PartialMetadataPerson {
                identifier: a.id,
                name: a.name,
                role: "Developer".to_owned(),
                source: MediaSource::Vndb,
                character: None,
                source_specifics: None,
            })
            .collect_vec();
        let genres = item
            .tags
            .unwrap_or_default()
            .into_iter()
            .map(|t| t.name)
            .collect_vec();
        MediaDetails {
            identifier: item.id,
            lot: MediaLot::VisualNovel,
            source: MediaSource::Vndb,
            production_status: item.devstatus.map(|s| match s {
                0 => "Finished".to_owned(),
                1 => "In development".to_owned(),
                2 => "Cancelled".to_owned(),
                _ => unreachable!(),
            }),
            title: item.title.unwrap(),
            description: item.description,
            people: people.into_iter().unique().collect(),
            genres: genres.into_iter().unique().collect(),
            publish_year: item.released.clone().and_then(|d| convert_date_to_year(&d)),
            publish_date: item.released.and_then(|d| convert_string_to_date(&d)),
            visual_novel_specifics: Some(VisualNovelSpecifics {
                length: item.length_minutes,
            }),
            provider_rating: item.rating,
            url_images: images.unique().collect(),
            ..Default::default()
        }
    }
}
