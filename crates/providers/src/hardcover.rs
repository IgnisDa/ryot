use anyhow::Result;
use application_utils::get_base_http_client;
use async_trait::async_trait;
use chrono::NaiveDate;
use common_models::{EntityAssets, PersonSourceSpecifics, SearchDetails};
use common_utils::PAGE_SIZE;
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{MetadataPersonRelated, PersonDetails, SearchResults};
use enum_models::{MediaLot, MediaSource};
use media_models::{
    BookSpecifics, CommitMetadataGroupInput, MetadataDetails, MetadataGroupSearchItem,
    MetadataSearchItem, PartialMetadataPerson, PartialMetadataWithoutId, PeopleSearchItem,
    UniqueMediaIdentifier,
};
use nest_struct::nest_struct;
use reqwest::{
    Client,
    header::{AUTHORIZATION, HeaderValue},
};
use rust_decimal::Decimal;
use serde::Deserialize;
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

#[derive(Debug, Deserialize)]
struct BooksByPk {
    books_by_pk: Item<i64>,
}

#[derive(Debug, Deserialize)]
struct AuthorsByPk {
    authors_by_pk: Item<i64>,
}

#[derive(Debug, Deserialize)]
struct PublishersByPk {
    publishers_by_pk: Item<i64>,
}

#[derive(Debug, Deserialize)]
struct SeriesByPk {
    series_by_pk: Item<i64>,
}

#[nest_struct]
#[derive(Debug, Deserialize)]
struct Item<TId> {
    id: TId,
    pages: Option<i32>,
    bio: Option<String>,
    name: Option<String>,
    slug: Option<String>,
    title: Option<String>,
    rating: Option<Decimal>,
    release_year: Option<i32>,
    compilation: Option<bool>,
    books_count: Option<usize>,
    image: Option<ImageOrLink>,
    description: Option<String>,
    born_date: Option<NaiveDate>,
    death_date: Option<NaiveDate>,
    links: Option<Vec<ImageOrLink>>,
    release_date: Option<NaiveDate>,
    images: Option<Vec<ImageOrLink>>,
    alternate_names: Option<Vec<String>>,
    editions: Option<Vec<nest! { book: Option<Item<TId>> }>>,
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
                author: Option<nest! { name: String }>,
                book: Option<nest! { id: TId, title: String }>,
            },
        >,
    >,
    book_series: Option<
        Vec<
            nest! {
                book: Option<Item<TId>>,
                series: Option<nest! { id: TId, name: String }>
            },
        >,
    >,
}

#[nest_struct]
#[derive(Debug, Deserialize)]
struct ImageOrLink {
    url: Option<String>,
}

async fn get_search_response(
    query: &str,
    page: i32,
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
        .json(&serde_json::json!({"query": body}))
        .send()
        .await?
        .json::<Response<Search>>()
        .await?;
    Ok(data.data.search.results)
}

fn query_type_from_specifics(source_specifics: &Option<PersonSourceSpecifics>) -> String {
    match source_specifics {
        Some(source_specifics) if source_specifics.is_hardcover_publisher.unwrap_or(false) => {
            "publisher".to_owned()
        }
        _ => "author".to_owned(),
    }
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
        let data = self
            .client
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
                images.push(image);
            }
        }
        for i in data.images.into_iter().flatten() {
            if let Some(image) = i.url {
                images.push(image);
            }
        }
        let assets = EntityAssets {
            remote_images: images,
            ..Default::default()
        };
        let details = MetadataDetails {
            assets,
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
                .filter_map(|s| {
                    s.series.map(|r| CommitMetadataGroupInput {
                        name: r.name,
                        unique: UniqueMediaIdentifier {
                            lot: MediaLot::Book,
                            identifier: r.id.to_string(),
                            source: MediaSource::Hardcover,
                        },
                        ..Default::default()
                    })
                })
                .collect(),
            people: data
                .contributions
                .unwrap_or_default()
                .into_iter()
                .filter_map(|a| {
                    a.author.and_then(|ath| {
                        a.author_id.map(|c| PartialMetadataPerson {
                            name: ath.name,
                            identifier: c.to_string(),
                            source: MediaSource::Hardcover,
                            role: a
                                .contribution
                                .unwrap_or_else(|| "Author".to_owned())
                                .to_string(),
                            ..Default::default()
                        })
                    })
                })
                .collect(),
            ..Default::default()
        };
        Ok(details)
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        let response = get_search_response(query, page, "book", &self.client).await?;
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
        let body = format!(
            r#"
{{
  series_by_pk(id: {identifier}) {{
    id
    name
    slug
    books_count
    description
    book_series(
      order_by: {{ position: asc }}
      where: {{
        book: {{
          book_status_id: {{ _eq: "1" }}, compilation: {{ _eq: false }},
          default_physical_edition: {{ language_id: {{ _eq: 1 }} }}
        }}
      }}
    ) {{
      book {{ id title }}
    }}
  }}
}}
    "#
        );
        let data = self
            .client
            .post(URL)
            .json(&serde_json::json!({"query": body}))
            .send()
            .await?
            .json::<Response<SeriesByPk>>()
            .await
            .unwrap();
        let data = data.data.series_by_pk;
        let details = MetadataGroupWithoutId {
            lot: MediaLot::Book,
            title: data.name.unwrap(),
            description: data.description,
            source: MediaSource::Hardcover,
            identifier: data.id.to_string(),
            parts: data.books_count.unwrap_or_default().try_into().unwrap(),
            source_url: data
                .slug
                .map(|s| format!("https://hardcover.app/series/{s}")),
            ..Default::default()
        };
        let related = data
            .book_series
            .into_iter()
            .flatten()
            .filter_map(|s| {
                s.book.map(|r| PartialMetadataWithoutId {
                    lot: MediaLot::Book,
                    title: r.title.unwrap(),
                    identifier: r.id.to_string(),
                    source: MediaSource::Hardcover,
                    ..Default::default()
                })
            })
            .collect();
        Ok((details, related))
    }

    async fn metadata_group_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataGroupSearchItem>> {
        let page = page.unwrap_or(1);
        let response = get_search_response(query, page, "series", &self.client).await?;
        let items = response
            .hits
            .into_iter()
            .map(|h| MetadataGroupSearchItem {
                identifier: h.document.id,
                parts: h.document.books_count,
                name: h.document.name.unwrap(),
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

    async fn person_details(
        &self,
        identifier: &str,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        match query_type_from_specifics(source_specifics).as_str() {
            "author" => {
                let body = format!(
                    r#"
{{
  authors_by_pk(id: {identifier}) {{
    id
    bio
    name
    slug
    links
    born_date
    death_date
    image {{ url }}
    alternate_names
    contributions {{ contribution book {{ id title }} }}
  }}
}}
    "#
                );
                let data = self
                    .client
                    .post(URL)
                    .json(&serde_json::json!({"query": body}))
                    .send()
                    .await?
                    .json::<Response<AuthorsByPk>>()
                    .await
                    .unwrap();
                let data = data.data.authors_by_pk;
                let mut images = vec![];
                if let Some(i) = data.image {
                    if let Some(image) = i.url {
                        images.push(image);
                    }
                }
                let details = PersonDetails {
                    assets: EntityAssets {
                        remote_images: images,
                        ..Default::default()
                    },
                    description: data.bio,
                    name: data.name.unwrap(),
                    birth_date: data.born_date,
                    death_date: data.death_date,
                    source: MediaSource::Hardcover,
                    identifier: data.id.to_string(),
                    alternate_names: data.alternate_names,
                    source_specifics: source_specifics.clone(),
                    source_url: data
                        .slug
                        .map(|s| format!("https://hardcover.app/authors/{s}")),
                    website: data
                        .links
                        .unwrap_or_default()
                        .into_iter()
                        .find(|i| i.url.is_some())
                        .and_then(|i| i.url),
                    related_metadata: data
                        .contributions
                        .unwrap_or_default()
                        .into_iter()
                        .filter_map(|c| {
                            c.book.map(|b| MetadataPersonRelated {
                                role: "Author".to_owned(),
                                metadata: PartialMetadataWithoutId {
                                    title: b.title,
                                    lot: MediaLot::Book,
                                    identifier: b.id.to_string(),
                                    source: MediaSource::Hardcover,
                                    ..Default::default()
                                },
                                ..Default::default()
                            })
                        })
                        .collect(),
                    ..Default::default()
                };
                Ok(details)
            }
            "publisher" => {
                let body = format!(
                    r#"
{{
  publishers_by_pk(id: {identifier}) {{
    id
    name
    slug
    editions(limit: 10000) {{ book {{ id title }} }}
  }}
}}
                "#
                );
                let data = self
                    .client
                    .post(URL)
                    .json(&serde_json::json!({"query": body}))
                    .send()
                    .await?
                    .json::<Response<PublishersByPk>>()
                    .await
                    .unwrap();
                let data = data.data.publishers_by_pk;
                let details = PersonDetails {
                    name: data.name.unwrap(),
                    source: MediaSource::Hardcover,
                    identifier: data.id.to_string(),
                    source_specifics: source_specifics.clone(),
                    source_url: data
                        .slug
                        .map(|s| format!("https://hardcover.app/publishers/{s}")),
                    related_metadata: data
                        .editions
                        .unwrap_or_default()
                        .into_iter()
                        .filter_map(|e| {
                            e.book.map(|b| MetadataPersonRelated {
                                role: "Publisher".to_owned(),
                                metadata: PartialMetadataWithoutId {
                                    lot: MediaLot::Book,
                                    title: b.title.unwrap(),
                                    identifier: b.id.to_string(),
                                    source: MediaSource::Hardcover,
                                    ..Default::default()
                                },
                                ..Default::default()
                            })
                        })
                        .collect(),
                    ..Default::default()
                };
                Ok(details)
            }
            _ => unreachable!(),
        }
    }

    async fn people_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let page = page.unwrap_or(1);
        let query_type = query_type_from_specifics(source_specifics);
        let response = get_search_response(query, page, &query_type, &self.client).await?;
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
                .ok()?
                .json::<Response<Editions>>()
                .await
                .ok()?;
            if let Some(edition) = rsp.data.editions.first() {
                return Some(edition.book_id.to_string());
            }
        }
        None
    }
}
