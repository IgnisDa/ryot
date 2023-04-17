use async_graphql::{
    Context, EmptySubscription, MergedObject, Object, Result, Schema, SimpleObject,
};
use sea_orm::DatabaseConnection;
use std::env;

use crate::{
    books::{
        openlibrary::OpenlibraryService,
        resolver::{BooksQuery, BooksService},
    },
    config::AppConfig,
    users::resolver::{UsersMutation, UsersService},
};

#[derive(Debug, SimpleObject)]
pub struct IdObject {
    pub id: i32,
}

#[derive(Default)]
struct CoreQuery;

#[Object]
impl CoreQuery {
    /// Get the version of the service running.
    async fn version(&self, _gql_ctx: &Context<'_>) -> Result<String> {
        Ok(env!("CARGO_PKG_VERSION").to_owned())
    }
}

#[derive(MergedObject, Default)]
pub struct QueryRoot(CoreQuery, BooksQuery);

#[derive(MergedObject, Default)]
pub struct MutationRoot(UsersMutation);

pub type GraphqlSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub fn get_schema(conn: DatabaseConnection, config: &AppConfig) -> GraphqlSchema {
    let openlibrary_service = OpenlibraryService::new(
        &config.books.openlibrary.url,
        &config.books.openlibrary.cover_image,
    );
    let book_service = BooksService::new(&openlibrary_service);
    let users_service = UsersService::new(&conn);
    Schema::build(
        QueryRoot::default(),
        MutationRoot::default(),
        EmptySubscription,
    )
    .data(conn)
    .data(book_service)
    .data(users_service)
    .finish()
}
