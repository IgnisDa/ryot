use anyhow::{Result, anyhow};
use application_utils::get_base_http_client;
use async_trait::async_trait;
use common_models::{
    EntityAssets, MetadataSearchSourceSpecifics, NamedObject, PersonSourceSpecifics, SearchDetails,
};
use common_utils::{PAGE_SIZE, convert_date_to_year, convert_string_to_date};
use dependent_models::{PersonDetails, SearchResults};
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    MetadataDetails, MetadataSearchItem, PartialMetadataPerson, PeopleSearchItem,
    VisualNovelSpecifics,
};
use reqwest::Client;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use traits::MediaProvider;

static URL: &str = "https://api.vndb.org/kana";
const METADATA_FIELDS_SMALL: &str = "title,image.url,released,screenshots.url,developers.name";
const METADATA_FIELDS: &str = const_str::concat!(
    METADATA_FIELDS_SMALL,
    ",",
    "length_minutes,tags.name,developers.id,devstatus,description,rating"
);

#[derive(Debug, Clone)]
pub struct VndbService {
    client: Client,
}

impl VndbService {
    pub async fn new(_config: &config_definition::VisualNovelConfig) -> Result<Self> {
        let client = get_base_http_client(None);
        Ok(Self { client })
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
        _display_nsfw: bool,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let data = self
            .client
            .post(format!("{}/producer", URL))
            .json(&serde_json::json!({
                "filters": format!(r#"["search", "=", "{}"]"#, query),
                "count": true,
                "fields": "id,name",
                "results": PAGE_SIZE,
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
                ..Default::default()
            })
            .collect();
        let next_page = data.more.then(|| page.unwrap_or(1) + 1);
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
    ) -> Result<PersonDetails> {
        let rsp = self
            .client
            .post(format!("{}/producer", URL))
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
        Ok(PersonDetails {
            identifier: item.id,
            name: item.title.unwrap(),
            source: MediaSource::Vndb,
            description: item.description,
            ..Default::default()
        })
    }

    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let rsp = self
            .client
            .post(format!("{}/vn", URL))
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
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        let rsp = self
            .client
            .post(format!("{}/vn", URL))
            .json(&serde_json::json!({
                "filters": format!(r#"["search", "=", "{}"]"#, query),
                "fields": METADATA_FIELDS_SMALL,
                "count": true,
                "results": PAGE_SIZE,
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
                let MetadataDetails {
                    title,
                    assets,
                    identifier,
                    publish_year,
                    ..
                } = self.vndb_response_to_search_response(b);
                let image = assets.remote_images.first().cloned();
                MetadataSearchItem {
                    title,
                    image,
                    identifier,
                    publish_year,
                }
            })
            .collect();
        let next_page = search.more.then(|| page + 1);
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
    fn vndb_response_to_search_response(&self, item: ItemResponse) -> MetadataDetails {
        let mut images = vec![];
        if let Some(il) = item.image {
            images.push(il.url);
        };
        for i in item.screenshots.unwrap_or_default() {
            images.push(i.url);
        }
        let remote_images = images.into_iter().unique().collect();
        let people = item
            .developers
            .unwrap_or_default()
            .into_iter()
            .map(|a| PartialMetadataPerson {
                name: a.name,
                identifier: a.id,
                source: MediaSource::Vndb,
                role: "Developer".to_owned(),
                ..Default::default()
            })
            .collect_vec();
        let genres = item
            .tags
            .unwrap_or_default()
            .into_iter()
            .map(|t| t.name)
            .collect_vec();
        let identifier = item.id;
        MetadataDetails {
            source: MediaSource::Vndb,
            lot: MediaLot::VisualNovel,
            identifier: identifier.clone(),
            production_status: item.devstatus.map(|s| match s {
                0 => "Finished".to_owned(),
                1 => "In development".to_owned(),
                2 => "Cancelled".to_owned(),
                _ => unreachable!(),
            }),
            source_url: Some(format!("https://vndb.org/{}", identifier)),
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
            assets: EntityAssets {
                remote_images,
                ..Default::default()
            },
            ..Default::default()
        }
    }
}
