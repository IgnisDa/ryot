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
use enum_models::{MediaLot, MediaSource};
use media_models::{
    BookSpecifics, CommitMediaInput, MetadataDetails, MetadataImageForMediaDetails,
    MetadataSearchItem, PartialMetadataPerson, PartialMetadataWithoutId, PeopleSearchItem,
    UniqueMediaIdentifier,
};
use nest_struct::nest_struct;
use reqwest::{
    header::{HeaderValue, AUTHORIZATION},
    Client,
};
use rust_decimal::Decimal;
use serde::{de::DeserializeOwned, Deserialize};
use traits::MediaProvider;

static URL: &str = "https://api.hardcover.app/v1/graphql";

#[nest_struct]
#[derive(Debug, Deserialize)]
struct Response<T> {
    data: T,
}

#[nest_struct]
#[derive(Debug, Deserialize)]
struct Search {
    search: nest! {
        results: nest! {
            found: i32,
            hits: Vec<nest! { document: Item<String> }>,
        }
    },
}

#[nest_struct]
#[derive(Debug, Deserialize)]
struct Editions {
    editions: Vec<nest! { book_id: i64 }>,
}

#[nest_struct]
#[derive(Debug, Deserialize)]
struct BooksByPk {
    books_by_pk: Item<i64>,
}

#[nest_struct]
#[derive(Debug, Deserialize)]
struct Item<TId> {
    id: TId,
    pages: Option<i32>,
    image: Option<Image>,
    name: Option<String>,
    slug: Option<String>,
    title: Option<String>,
    rating: Option<Decimal>,
    release_year: Option<i32>,
    compilation: Option<bool>,
    images: Option<Vec<Image>>,
    description: Option<String>,
    release_date: Option<NaiveDate>,
    recommendations: Option<Vec<nest! { item_book: Option<Item<TId>> }>>,
    cached_tags: Option<
        nest! {
          #[serde(rename = "Genre")]
          genre: Option<Vec<nest! { tag: String }>>
        },
    >,
    contributions: Option<
        Vec<
            nest! {
                author_id: Option<TId>,
                contribution: Option<String>,
                author: nest! { name: String }
            },
        >,
    >,
    book_series: Option<
        Vec<
            nest! {
                series: nest! {
                    id: TId,
                    name: String
                }
            },
        >,
    >,
}

#[nest_struct]
#[derive(Debug, Deserialize)]
struct Image {
    url: Option<String>,
}

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
        .await?;
    Ok(data)
}

async fn get_book_details(identifier: &str, client: &Client) -> Result<MetadataDetails> {
    let body = format!(
        r#"
query {{
  books_by_pk(id: {identifier}) {{
    id
    slug
    pages
    title
    rating
    compilation
    description
    cached_tags
    release_date
    release_year
    image {{ url }}
    images {{ url }}
    book_series {{ series {{ id name }} }}
    contributions {{ contribution author_id author {{ name }} }}
    recommendations(
      where: {{
        subject_id: {{ _eq: {identifier} }},
        subject_type: {{ _eq: "Book" }}, item_type: {{ _eq: "Book" }}
      }}
    ) {{ item_id }}
  }}
}}
    "#
    );
    let data = client
        .post(URL)
        .json(&serde_json::json!({"query": body}))
        .send()
        .await?
        .json::<Response<BooksByPk>>()
        .await
        .unwrap();
    let data = data.data.books_by_pk;
    let mut images = vec![];
    if let Some(i) = data.image {
        if let Some(image) = i.url {
            images.push(MetadataImageForMediaDetails { image });
        }
    }
    for i in data.images.into_iter().flatten() {
        if let Some(image) = i.url {
            images.push(MetadataImageForMediaDetails { image });
        }
    }
    let details = MetadataDetails {
        url_images: images,
        lot: MediaLot::Book,
        title: data.title.unwrap(),
        provider_rating: data.rating,
        description: data.description,
        source: MediaSource::Hardcover,
        publish_date: data.release_date,
        publish_year: data.release_year,
        identifier: data.id.to_string(),
        book_specifics: Some(BookSpecifics {
            pages: data.pages,
            is_compilation: data.compilation,
        }),
        source_url: data
            .slug
            .map(|s| format!("https://hardcover.app/books/{s}")),
        suggestions: data
            .recommendations
            .unwrap_or_default()
            .into_iter()
            .flat_map(|i| {
                i.item_book.map(|b| PartialMetadataWithoutId {
                    lot: MediaLot::Book,
                    title: b.title.unwrap(),
                    identifier: b.id.to_string(),
                    source: MediaSource::Hardcover,
                    ..Default::default()
                })
            })
            .collect(),
        genres: data
            .cached_tags
            .into_iter()
            .flat_map(|t| t.genre.unwrap_or_default().into_iter().map(|g| g.tag))
            .collect(),
        groups: data
            .book_series
            .into_iter()
            .flatten()
            .map(|r| CommitMediaInput {
                name: r.series.name,
                unique: UniqueMediaIdentifier {
                    lot: MediaLot::Book,
                    source: MediaSource::Hardcover,
                    identifier: r.series.id.to_string(),
                },
            })
            .collect(),
        people: data
            .contributions
            .into_iter()
            .flatten()
            .flat_map(|a| {
                a.author_id.map(|c| PartialMetadataPerson {
                    name: a.author.name,
                    identifier: c.to_string(),
                    source: MediaSource::Hardcover,
                    role: a
                        .contribution
                        .unwrap_or_else(|| "Author".to_owned())
                        .to_string(),
                    ..Default::default()
                })
            })
            .collect(),
        ..Default::default()
    };
    Ok(details)
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
        Ok(details)
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        let response =
            get_search_response::<Response<Search>>(query, page, "book", &self.client).await?;
        let response = response.data.search.results;
        let items = response
            .hits
            .into_iter()
            .map(|h| MetadataSearchItem {
                identifier: h.document.id,
                title: h.document.title.unwrap(),
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
        source_specifics: &Option<PersonSourceSpecifics>,
        _display_nsfw: bool,
    ) -> Result<PeopleSearchResponse> {
        let page = page.unwrap_or(1);
        let query_type = match source_specifics {
            Some(source_specifics) if source_specifics.is_hardcover_publisher.unwrap_or(false) => {
                "publisher"
            }
            _ => "author",
        };
        let response =
            get_search_response::<Response<Search>>(query, page, query_type, &self.client).await?;
        let response = response.data.search.results;
        let items = response
            .hits
            .into_iter()
            .map(|h| PeopleSearchItem {
                identifier: h.document.id,
                name: h.document.name.unwrap(),
                image: h.document.image.and_then(|i| i.url),
                ..Default::default()
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
}

fn get_isbn_body(isbn_type: &str, isbn: &str) -> String {
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

impl HardcoverService {
    pub async fn id_from_isbn(&self, isbn: &str) -> Option<String> {
        for isbn_type in ["10", "13"] {
            let body = get_isbn_body(isbn_type, isbn);
            let rsp = self
                .client
                .post(URL)
                .json(&serde_json::json!({ "query": body }))
                .send()
                .await
                .unwrap()
                .json::<Response<Editions>>()
                .await
                .unwrap();
            if let Some(edition) = rsp.data.editions.first() {
                return Some(edition.book_id.to_string());
            }
        }
        None
    }
}
