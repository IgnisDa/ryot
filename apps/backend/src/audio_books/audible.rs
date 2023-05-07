use anyhow::{anyhow, Result};
use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};
use surf::{http::headers::USER_AGENT, Client, Config, Url};

use crate::{
    config::AudibleConfig,
    graphql::AUTHOR,
    media::{
        resolver::{MediaSearchItem, MediaSearchResults},
        LIMIT,
    },
    utils::{
        convert_date_to_year, convert_option_path_to_vec, convert_string_to_date, NamedObject,
    },
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
            .add_header(USER_AGENT, format!("{}/ryot", AUTHOR))
            .unwrap()
            .set_base_url(Url::parse(&config.url).unwrap())
            .try_into()
            .unwrap();
        Self { client }
    }
}

impl AudibleService {
    pub async fn details(&self, identifier: &str) -> Result<MediaSearchItem> {
        #[derive(Serialize, Deserialize, Debug)]
        struct AudibleItemResponse {
            product: AudibleItem,
        }
        let mut rsp = self
            .client
            .get(format!("{}", identifier))
            .query(&PrimaryQuery::default())
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let data: AudibleItemResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let detail = self.audible_response_to_search_response(data.product);
        Ok(detail)
    }

    pub async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
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
            .map(|d| self.audible_response_to_search_response(d))
            .collect::<Vec<_>>();
        Ok(MediaSearchResults {
            total: search.total_results,
            items: resp,
        })
    }

    fn audible_response_to_search_response(&self, item: AudibleItem) -> MediaSearchItem {
        let poster_images = convert_option_path_to_vec(item.product_images.image);
        let release_date = item.release_date.unwrap_or_default();
        MediaSearchItem {
            identifier: item.asin,
            title: item.title,
            description: item.merchandising_summary,
            author_names: item.authors.into_iter().map(|a| a.name).collect(),
            genres: vec![],
            publish_year: convert_date_to_year(&release_date),
            publish_date: convert_string_to_date(&release_date),
            movie_specifics: None,
            book_specifics: None,
            show_specifics: None,
            video_game_specifics: None,
            audio_books_specifics: Some(AudioBookSpecifics {
                runtime: item.runtime_length_min,
            }),
            poster_images,
            backdrop_images: vec![],
        }
    }
}
