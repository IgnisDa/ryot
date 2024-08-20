use super::{IntegrationMediaCollection, IntegrationMediaSeen};
use anyhow::{bail, Result};
use async_graphql::Result as GqlResult;
use database_models::metadata;
use database_utils::ilike_sql;
use enums::{MediaLot, MediaSource};
use media_models::CommitMediaInput;
use sea_orm::{
    prelude::async_trait::async_trait, ColumnTrait, Condition, DatabaseConnection, EntityTrait,
    QueryFilter,
};
use sea_query::{extension::postgres::PgExpr, Alias, Expr, Func};
use std::future::Future;

pub trait YankIntegration {
    async fn yank_progress(
        &self,
    ) -> Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)>;
}

pub trait YankIntegrationWithCommit {
    async fn yank_progress<F>(
        &self,
        commit_metadata: impl Fn(CommitMediaInput) -> F,
    ) -> Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)>
    where
        F: Future<Output = GqlResult<metadata::Model>>;
}

pub trait PushIntegration {
    async fn push_progress(&self) -> Result<()>;
}

#[async_trait]
pub trait ShowIdentifier {
    fn get_db(&self) -> &DatabaseConnection;

    async fn get_show_by_episode_identifier(
        &self,
        series: &str,
        episode: &str,
    ) -> Result<metadata::Model> {
        let db_show = metadata::Entity::find()
            .filter(metadata::Column::Lot.eq(MediaLot::Show))
            .filter(metadata::Column::Source.eq(MediaSource::Tmdb))
            .filter(
                Condition::all()
                    .add(
                        Expr::expr(Func::cast_as(
                            Expr::col(metadata::Column::ShowSpecifics),
                            Alias::new("text"),
                        ))
                        .ilike(ilike_sql(episode)),
                    )
                    .add(Expr::col(metadata::Column::Title).ilike(ilike_sql(series))),
            )
            .one(self.get_db())
            .await?;
        match db_show {
            Some(show) => Ok(show),
            None => bail!(
                "No show found with Series {:#?} and Episode {:#?}",
                series,
                episode
            ),
        }
    }
}
