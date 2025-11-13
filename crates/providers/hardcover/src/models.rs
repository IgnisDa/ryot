use anyhow::Result;
use chrono::NaiveDate;
use common_models::PersonSourceSpecifics;
use common_utils::PAGE_SIZE;
use nest_struct::nest_struct;
use reqwest::Client;
use rust_decimal::Decimal;
use serde::Deserialize;

pub static URL: &str = "https://api.hardcover.app/v1/graphql";

#[nest_struct]
#[derive(Debug, Deserialize)]
pub struct Response<T> {
    pub data: T,
}

#[nest_struct]
#[derive(Debug, Deserialize)]
pub struct Search {
    pub search: nest! {
        pub results: nest! {
            pub found: u64,
            pub hits: Vec<nest! { pub document: Item<String> }>,
        }
    },
}

#[nest_struct]
#[derive(Debug, Deserialize)]
pub struct Editions {
    pub editions: Vec<nest! { pub book_id: i64 }>,
}

#[derive(Debug, Deserialize)]
pub struct BooksByPk {
    pub books_by_pk: Item<i64>,
}

#[derive(Debug, Deserialize)]
pub struct AuthorsByPk {
    pub authors_by_pk: Item<i64>,
}

#[derive(Debug, Deserialize)]
pub struct PublishersByPk {
    pub publishers_by_pk: Item<i64>,
}

#[derive(Debug, Deserialize)]
pub struct SeriesByPk {
    pub series_by_pk: Item<i64>,
}

#[nest_struct]
#[derive(Debug, Deserialize)]
pub struct Item<TId> {
    pub id: TId,
    pub pages: Option<i32>,
    pub bio: Option<String>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub title: Option<String>,
    pub rating: Option<Decimal>,
    pub release_year: Option<i32>,
    pub compilation: Option<bool>,
    pub books_count: Option<usize>,
    pub image: Option<ImageOrLink>,
    pub description: Option<String>,
    pub born_date: Option<NaiveDate>,
    pub death_date: Option<NaiveDate>,
    pub links: Option<Vec<ImageOrLink>>,
    pub release_date: Option<NaiveDate>,
    pub images: Option<Vec<ImageOrLink>>,
    pub alternate_names: Option<Vec<String>>,
    pub editions: Option<Vec<nest! { pub book: Option<Item<TId>> }>>,
    pub recommendations: Option<Vec<nest! { pub item_book: Option<Item<TId>> }>>,
    pub cached_tags: Option<
        nest! {
          #[serde(rename = "Genre")]
          pub genre: Option<Vec<nest! { pub tag: String }>>
        },
    >,
    pub contributions: Option<
        Vec<
            nest! {
                pub author_id: Option<TId>,
                pub contribution: Option<String>,
                pub author: Option<nest! { pub name: String }>,
                pub book: Option<nest! { pub id: TId, pub title: String }>,
            },
        >,
    >,
    pub book_series: Option<
        Vec<
            nest! {
                pub book: Option<Item<TId>>,
                pub series: Option<nest! { pub id: TId, pub name: String }>
            },
        >,
    >,
}

#[nest_struct]
#[derive(Debug, Deserialize)]
pub struct ImageOrLink {
    pub url: Option<String>,
}

pub async fn get_search_response(
    query: &str,
    page: u64,
    query_type: &str,
    client: &Client,
) -> Result<SearchSearchResults> {
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
        .json(&[("query", body)])
        .send()
        .await?
        .json::<Response<Search>>()
        .await?;
    Ok(data.data.search.results)
}

pub fn query_type_from_specifics(source_specifics: &Option<PersonSourceSpecifics>) -> String {
    match source_specifics {
        Some(source_specifics) if source_specifics.is_hardcover_publisher.unwrap_or(false) => {
            "publisher".to_owned()
        }
        _ => "author".to_owned(),
    }
}

pub fn get_isbn_body(isbn_type: &str, isbn: &str) -> String {
    format!(
        r#"
query {{
  editions(where: {{ isbn_{isbn_type}: {{ _eq: "{isbn}" }} }}) {{
    book_id
  }}
}}
    "#
    )
}
