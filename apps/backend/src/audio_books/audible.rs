use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use surf::{http::headers::USER_AGENT, Client, Config, Url};

use crate::{
    config::AudibleConfig,
    graphql::{AUTHOR, PROJECT_NAME},
    media::{
        resolver::{MediaDetails, MediaSearchItem, MediaSearchResults},
        LIMIT,
    },
    migrator::MetadataLot,
    traits::MediaProvider,
    utils::{convert_date_to_year, convert_string_to_date, NamedObject},
};

use super::AudioBookSpecifics;

#[derive(Serialize, Deserialize)]
struct PrimaryQuery {
    response_groups: String,
    image_sizes: String,
}

impl Default for PrimaryQuery {
    fn default() -> Self {
        Self {
            response_groups: ["contributors", "media", "product_attrs"].join(","),
            image_sizes: ["2400"].join(","),
        }
    }
}

#[derive(Serialize, Deserialize)]
struct SearchQuery {
    title: String,
    num_results: i32,
    page: i32,
    products_sort_by: String,
    #[serde(flatten)]
    primary: PrimaryQuery,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject)]
pub struct AudiblePoster {
    #[serde(rename = "2400")]
    image: Option<String>,
}
#[derive(Debug, Serialize, Deserialize, SimpleObject)]
pub struct AudibleItem {
    asin: String,
    title: String,
    authors: Vec<NamedObject>,
    product_images: AudiblePoster,
    merchandising_summary: Option<String>,
    release_date: Option<String>,
    runtime_length_min: Option<i32>,
}

#[derive(Debug, Clone)]
pub struct AudibleService {
    client: Client,
}

impl AudibleService {
    pub fn new(config: &AudibleConfig) -> Self {
        let client = Config::new()
            .add_header(USER_AGENT, format!("{}/{}", AUTHOR, PROJECT_NAME))
            .unwrap()
            .set_base_url(Url::parse(&config.url).unwrap())
            .try_into()
            .unwrap();
        Self { client }
    }
}

#[async_trait]
impl MediaProvider<AudioBookSpecifics> for AudibleService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails<AudioBookSpecifics>> {
        #[derive(Serialize, Deserialize, Debug)]
        struct AudibleItemResponse {
            product: AudibleItem,
        }
        let mut rsp = self
            .client
            .get(identifier)
            .query(&PrimaryQuery::default())
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let data: AudibleItemResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let d = self.audible_response_to_search_response(data.product);
        Ok(d)
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        #[derive(Serialize, Deserialize, Debug)]
        struct AudibleSearchResponse {
            total_results: i32,
            products: Vec<AudibleItem>,
        }
        let mut rsp = self
            .client
            .get("")
            .query(&SearchQuery {
                title: query.to_owned(),
                num_results: LIMIT,
                page: page.unwrap_or(1) - 1,
                products_sort_by: "Relevance".to_owned(),
                primary: PrimaryQuery::default(),
            })
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: AudibleSearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .products
            .into_iter()
            .map(|d| {
                let a = self.audible_response_to_search_response(d);
                MediaSearchItem {
                    identifier: a.identifier,
                    lot: MetadataLot::AudioBook,
                    title: a.title,
                    poster_images: a.poster_images,
                    publish_year: a.publish_year,
                }
            })
            .collect::<Vec<_>>();
        Ok(MediaSearchResults {
            total: search.total_results,
            items: resp,
        })
    }
}

impl AudibleService {
    fn audible_response_to_search_response(
        &self,
        item: AudibleItem,
    ) -> MediaDetails<AudioBookSpecifics> {
        let poster_images = Vec::from_iter(item.product_images.image);
        let release_date = item.release_date.unwrap_or_default();
        MediaDetails {
            identifier: item.asin,
            lot: MetadataLot::AudioBook,
            title: item.title,
            description: item.merchandising_summary,
            creators: item.authors.into_iter().map(|a| a.name).collect(),
            genres: vec![],
            publish_year: convert_date_to_year(&release_date),
            publish_date: convert_string_to_date(&release_date),
            specifics: AudioBookSpecifics {
                runtime: item.runtime_length_min,
            },
            poster_images,
            backdrop_images: vec![],
        }
    }
}
