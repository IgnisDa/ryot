use anyhow::{anyhow, Result};
use async_trait::async_trait;
use http_types::mime;
use itertools::Itertools;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use surf::{http::headers::ACCEPT, Client};

use crate::{
    config::VisualNovelConfig,
    migrator::{MetadataImageLot, MetadataLot, MetadataSource},
    models::{
        media::{
            MediaDetails, MediaSearchItem, MediaSpecifics, MetadataCreator, MetadataImage,
            VisualNovelSpecifics,
        },
        NamedObject, SearchDetails, SearchResults, StoredUrl,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::{convert_date_to_year, convert_string_to_date, get_base_http_client},
};

static URL: &str = "https://api.vndb.org/kana/";
const FIELDS_SMALL: &str = "title,image.url,released,screenshots.url";
const FIELDS: &str = const_str::concat!(
    FIELDS_SMALL,
    ",",
    "length_minutes,tags.name,developers.name,devstatus,description,rating"
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
    pub async fn new(_config: &VisualNovelConfig, page_limit: i32) -> Self {
        let client = get_base_http_client(URL, vec![(ACCEPT, mime::JSON)]);
        Self { client, page_limit }
    }
}

#[derive(Serialize, Deserialize, Debug)]
struct ImageLinks {
    url: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemResponse {
    id: String,
    title: String,
    rating: Option<Decimal>,
    released: Option<String>,
    description: Option<String>,
    image_links: Option<ImageLinks>,
    length_minutes: Option<i32>,
    devstatus: Option<i32>,
    developers: Option<Vec<NamedObject>>,
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
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let mut rsp = self
            .client
            .post("vn")
            .body_json(&serde_json::json!({
                "filters": format!(r#"["id", "=", "{}"]"#, identifier),
                "count": true,
                "fields": FIELDS
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let data: SearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let item = data.results.unwrap_or_default().pop().unwrap();
        let d = self.google_books_response_to_search_response(item);
        Ok(d)
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let page = page.unwrap_or(1);
        let mut rsp = self
            .client
            .post("vn")
            .body_json(&serde_json::json!({
                "filters": format!(r#"["search", "=", "{}"]"#, query),
                "fields": FIELDS_SMALL,
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
                    images,
                    publish_year,
                    ..
                } = self.google_books_response_to_search_response(b);
                let image = images
                    .into_iter()
                    .map(|i| match i.url {
                        StoredUrl::S3(_u) => unreachable!(),
                        StoredUrl::Url(u) => u,
                    })
                    .collect_vec()
                    .get(0)
                    .cloned();
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
    fn google_books_response_to_search_response(&self, item: ItemResponse) -> MediaDetails {
        let mut images = vec![];
        if let Some(il) = item.image_links {
            images.push(il.url);
        };
        for i in item.screenshots.unwrap_or_default() {
            images.push(i.url);
        }
        let images = images.into_iter().map(|a| MetadataImage {
            url: StoredUrl::Url(a),
            lot: MetadataImageLot::Poster,
        });
        let creators = item
            .developers
            .unwrap_or_default()
            .into_iter()
            .map(|a| MetadataCreator {
                name: a.name,
                role: "Developer".to_owned(),
                image: None,
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
            production_status: item
                .devstatus
                .map(|s| match s {
                    0 => "Finished".to_owned(),
                    1 => "In development".to_owned(),
                    2 => "Cancelled".to_owned(),
                    _ => unreachable!(),
                })
                .unwrap_or_else(|| "Released".to_owned()),
            title: item.title,
            description: item.description,
            creators: creators.into_iter().unique().collect(),
            genres: genres.into_iter().unique().collect(),
            publish_year: item.released.clone().and_then(|d| convert_date_to_year(&d)),
            publish_date: item.released.and_then(|d| convert_string_to_date(&d)),
            specifics: MediaSpecifics::VisualNovel(VisualNovelSpecifics {
                length: item.length_minutes,
            }),
            provider_rating: item.rating,
            images: images.unique().collect(),
            suggestions: vec![],
            groups: vec![],
        }
    }
}
