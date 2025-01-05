use anyhow::Result;
use application_utils::get_base_http_client;
use async_trait::async_trait;
use chrono::NaiveDate;
use common_models::{PersonSourceSpecifics, SearchDetails};
use common_utils::PAGE_SIZE;
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{
    MetadataGroupSearchResponse, PeopleSearchResponse, PersonDetails, SearchResults,
};
use media_models::{MetadataDetails, MetadataSearchItem, PartialMetadataWithoutId};
use nest_struct::nest_struct;
use reqwest::{
    header::{HeaderValue, AUTHORIZATION},
    Client,
};
use rust_decimal::Decimal;
use serde::{de::DeserializeOwned, Deserialize};
use traits::MediaProvider;

static URL: &str = "https://api.hardcover.app/v1/graphql";

async fn get_search_response<T: DeserializeOwned>(
    query: &str,
    page: i32,
    query_type: &str,
    client: &Client,
) -> Result<T> {
    let body = format!(
        r#"
query {{
  search(
    page: {page}, per_page: {PAGE_SIZE},
    query: "{query}", query_type: "{query_type}"
  ) {{
    results
  }}
}}
    "#
    );
    let data = client
        .post(URL)
        .json(&serde_json::json!({"query": body}))
        .send()
        .await?
        .json::<T>()
        .await
        .unwrap();
    Ok(data)
}

async fn get_book_details(identifier: &str, client: &Client) -> Result<MetadataDetails> {
    let body = format!(r#"
query {{
  books_by_pk(id: {identifier}) {{
    pages
    title
    rating
    description
    cached_tags
    release_date
    release_year
    image {{ url }}
    images {{ url }}
    book_series {{ series {{ id name }} }}
    contributions {{ contribution author_id }}
    recommendations(where: {{ item_type: {{ _eq: "book" }} }}) {{ item_id }}
  }}
}}
    "#);
    let data = client
        .post(URL)
        .json(&serde_json::json!({"query": body}))
        .send()
        .await?
        .json::<Book>()
        .await
        .unwrap();
    Ok(data)
}

#[nest_struct]
#[derive(Debug, Deserialize)]
struct Response {
    data: nest! {
        search: nest! {
            results: nest! {
                found: i32,
                hits: Vec<nest! { document: Book }>,
            }
        }
    },
}

#[nest_struct]
#[derive(Debug, Deserialize)]
struct Book {
    id: String,
    title: String,
    pages: Option<i32>,
    image: Option<Image>,
    rating: Option<Decimal>,
    release_year: Option<i32>,
    images: Option<Vec<Image>>,
    description: Option<String>,
    release_date: Option<NaiveDate>,
    cached_tags: nest! {
        #[serde(rename = "Genre")]
        genre: Vec<nest! { tag: String }>
    },
    contributions: Option<Vec<nest! {
        author_id: String,
        contribution: Option<String>
    }>>,
    book_series: Option<Vec<nest! {
        series: nest! {
            id: String,
            name: String
        }
    }>>,
}

#[nest_struct]
#[derive(Debug, Deserialize)]
struct Image {
    url: Option<String>,
}

pub struct HardcoverService {
    client: Client,
}

impl HardcoverService {
    pub async fn new(config: &config::HardcoverConfig) -> Self {
        let client = get_base_http_client(Some(vec![(
            AUTHORIZATION,
            HeaderValue::from_str(&config.api_key).unwrap(),
        )]));
        Self { client }
    }
}

#[async_trait]
impl MediaProvider for HardcoverService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let details = get_book_details(identifier, &self.client).await?;
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        let response = get_search_response::<Response>(query, page, "book", &self.client).await?;
        let response = response.data.search.results;
        let items = response
            .hits
            .into_iter()
            .map(|h| MetadataSearchItem {
                title: h.document.title,
                identifier: h.document.id,
                publish_year: h.document.release_year,
                image: h.document.image.and_then(|i| i.url),
            })
            .collect();
        let resp = SearchResults {
            items,
            details: SearchDetails {
                total: response.found,
                next_page: if page < response.found / PAGE_SIZE {
                    Some(page + 1)
                } else {
                    None
                },
            },
        };
        Ok(resp)
    }

    async fn metadata_group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        todo!()
    }

    async fn metadata_group_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<MetadataGroupSearchResponse> {
        todo!()
    }

    async fn person_details(
        &self,
        identifier: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        todo!()
    }

    async fn people_search(
        &self,
        query: &str,
        page: Option<i32>,
        _source_specifics: &Option<PersonSourceSpecifics>,
        _display_nsfw: bool,
    ) -> Result<PeopleSearchResponse> {
        todo!()
    }
}
