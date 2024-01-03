use anyhow::{anyhow, Result};
use async_trait::async_trait;
use database::{MetadataLot, MetadataSource};
use http_types::mime;
use itertools::Itertools;
use rs_utils::{convert_date_to_year, convert_string_to_date};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use surf::{http::headers::ACCEPT, Client};

use crate::{
    models::{
        media::{
            MediaDetails, MediaSearchItem, MediaSpecifics, MetadataImageForMediaDetails,
            MetadataImageLot, MetadataPerson, PartialMetadataPerson, VisualNovelSpecifics,
        },
        NamedObject, SearchDetails, SearchResults,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::get_base_http_client,
};

static URL: &str = "https://api.vndb.org/kana/";
const MEDIA_FIELDS_SMALL: &str = "title,image.url,released,screenshots.url";
const MEDIA_FIELDS: &str = const_str::concat!(
    MEDIA_FIELDS_SMALL,
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
        let client = get_base_http_client(URL, vec![(ACCEPT, mime::JSON)]);
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
    async fn person_details(&self, identity: &PartialMetadataPerson) -> Result<MetadataPerson> {
        let mut rsp = self
            .client
            .post("producer")
            .body_json(&serde_json::json!({
                "filters": format!(r#"["id", "=", "{}"]"#, identity.identifier),
                "count": true,
                "fields": "id,name,description"
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let data: SearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let item = data.results.unwrap_or_default().pop().unwrap();
        Ok(MetadataPerson {
            identifier: item.id,
            source: MetadataSource::Vndb,
            name: item.title.unwrap(),
            description: item.description,
            related: vec![],
            gender: None,
            images: None,
            death_date: None,
            birth_date: None,
            place: None,
            website: None,
        })
    }

    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let mut rsp = self
            .client
            .post("vn")
            .body_json(&serde_json::json!({
                "filters": format!(r#"["id", "=", "{}"]"#, identifier),
                "count": true,
                "fields": MEDIA_FIELDS
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let data: SearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let item = data.results.unwrap_or_default().pop().unwrap();
        let d = self.vndb_response_to_search_response(item);
        Ok(d)
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let page = page.unwrap_or(1);
        let mut rsp = self
            .client
            .post("vn")
            .body_json(&serde_json::json!({
                "filters": format!(r#"["search", "=", "{}"]"#, query),
                "fields": MEDIA_FIELDS_SMALL,
                "count": true,
                "results": self.page_limit,
                "page": page
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: SearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
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
                MediaSearchItem {
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
        let images = images.into_iter().map(|a| MetadataImageForMediaDetails {
            image: a,
            lot: MetadataImageLot::Poster,
        });
        let people = item
            .developers
            .unwrap_or_default()
            .into_iter()
            .map(|a| PartialMetadataPerson {
                identifier: a.id,
                role: "Developer".to_owned(),
                source: MetadataSource::Vndb,
                character: None,
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
            lot: MetadataLot::VisualNovel,
            source: MetadataSource::Vndb,
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
            specifics: MediaSpecifics::VisualNovel(VisualNovelSpecifics {
                length: item.length_minutes,
            }),
            provider_rating: item.rating,
            url_images: images.unique().collect(),
            is_nsfw: None,
            videos: vec![],
            suggestions: vec![],
            creators: vec![],
            s3_images: vec![],
            group_identifiers: vec![],
            original_language: None,
        }
    }
}
