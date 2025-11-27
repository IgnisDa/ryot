use anyhow::Result;
use async_trait::async_trait;
use common_models::{
    EntityAssets, NamedObject, PersonSourceSpecifics, SearchDetails, StringIdAndNamedObject,
};
use common_utils::{PAGE_SIZE, convert_date_to_year, convert_string_to_date, get_base_http_client};
use dependent_models::{MetadataSearchSourceSpecifics, PersonDetails, SearchResults};
use enum_models::MediaSource;
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

#[derive(Serialize, Clone, Deserialize, Debug)]
struct ImageLinks {
    url: String,
}

#[derive(Serialize, Clone, Deserialize, Debug)]
struct ItemResponse {
    id: String,
    #[serde(alias = "name")]
    title: Option<String>,
    devstatus: Option<i32>,
    rating: Option<Decimal>,
    released: Option<String>,
    image: Option<ImageLinks>,
    length_minutes: Option<i32>,
    description: Option<String>,
    tags: Option<Vec<NamedObject>>,
    screenshots: Option<Vec<ImageLinks>>,
    developers: Option<Vec<StringIdAndNamedObject>>,
}

#[derive(Serialize, Deserialize, Debug)]
struct SearchResponse {
    more: bool,
    count: u64,
    results: Option<Vec<ItemResponse>>,
}

#[async_trait]
impl MediaProvider for VndbService {
    async fn people_search(
        &self,
        page: u64,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let data = self
            .client
            .post(format!("{URL}/producer"))
            .json(&serde_json::json!({
                "page": page,
                "count": true,
                "fields": "id,name",
                "results": PAGE_SIZE,
                "filters": format!(r#"["search", "=", "{}"]"#, query),
            }))
            .send()
            .await?
            .json::<SearchResponse>()
            .await?;
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
        let next_page = data.more.then(|| page + 1);
        Ok(SearchResults {
            items: resp,
            details: SearchDetails {
                next_page,
                total_items: data.count,
            },
        })
    }

    async fn person_details(
        &self,
        identifier: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        let rsp = self
            .client
            .post(format!("{URL}/producer"))
            .json(&serde_json::json!({
                "count": true,
                "fields": "id,name,description",
                "filters": format!(r#"["id", "=", "{}"]"#, identifier),
            }))
            .send()
            .await?;
        let data: SearchResponse = rsp.json().await?;
        let item = data.results.unwrap_or_default().pop().unwrap();
        Ok(PersonDetails {
            name: item.title.unwrap(),
            description: item.description,
            ..Default::default()
        })
    }

    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let rsp = self
            .client
            .post(format!("{URL}/vn"))
            .json(&serde_json::json!({
                "count": true,
                "fields": METADATA_FIELDS,
                "filters": format!(r#"["id", "=", "{}"]"#, identifier),
            }))
            .send()
            .await?;
        let data: SearchResponse = rsp.json().await?;
        let item = data.results.unwrap_or_default().pop().unwrap();
        let d = self.vndb_response_to_search_response(item);
        Ok(d)
    }

    async fn metadata_search(
        &self,
        page: u64,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let rsp = self
            .client
            .post(format!("{URL}/vn"))
            .json(&serde_json::json!({
                "page": page,
                "count": true,
                "results": PAGE_SIZE,
                "fields": METADATA_FIELDS_SMALL,
                "filters": format!(r#"["search", "=", "{}"]"#, query),
            }))
            .send()
            .await?;
        let search: SearchResponse = rsp.json().await?;
        let resp = search
            .results
            .unwrap_or_default()
            .into_iter()
            .map(|b| {
                let MetadataDetails {
                    title,
                    assets,
                    publish_year,
                    ..
                } = self.vndb_response_to_search_response(b.clone());
                let image = assets.remote_images.first().cloned();
                MetadataSearchItem {
                    title,
                    image,
                    publish_year,
                    identifier: b.id,
                }
            })
            .collect();
        let next_page = search.more.then(|| page + 1);
        Ok(SearchResults {
            items: resp,
            details: SearchDetails {
                next_page,
                total_items: search.count,
            },
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
            title: item.title.unwrap(),
            provider_rating: item.rating,
            description: item.description,
            people: people.into_iter().unique().collect(),
            genres: genres.into_iter().unique().collect(),
            source_url: Some(format!("https://vndb.org/{identifier}")),
            publish_year: item.released.clone().and_then(|d| convert_date_to_year(&d)),
            publish_date: item.released.and_then(|d| convert_string_to_date(&d)),
            visual_novel_specifics: Some(VisualNovelSpecifics {
                length: item.length_minutes,
            }),
            assets: EntityAssets {
                remote_images,
                ..Default::default()
            },
            production_status: item.devstatus.map(|s| match s {
                0 => "Finished".to_owned(),
                1 => "In development".to_owned(),
                2 => "Cancelled".to_owned(),
                _ => unreachable!(),
            }),
            ..Default::default()
        }
    }
}
