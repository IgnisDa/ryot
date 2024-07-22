use anyhow::Result;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use uuid::Uuid;

#[skip_serializing_none]
#[derive(Debug, Deserialize, Serialize)]
pub struct AccessLinkClaims {
    pub id: String,
    pub is_demo: Option<bool>,
}

#[skip_serializing_none]
#[derive(Debug, Deserialize, Serialize)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
    pub iat: usize,
    pub jti: Uuid,
    pub access_link: Option<AccessLinkClaims>,
}

impl Claims {
    pub fn new(
        sub: String,
        token_valid_for_days: i32,
        access_link: Option<AccessLinkClaims>,
    ) -> Self {
        let iat = Utc::now();
        let exp = iat + Duration::try_days(token_valid_for_days.into()).unwrap();

        Self {
            sub,
            iat: iat.timestamp().try_into().unwrap(),
            exp: exp.timestamp().try_into().unwrap(),
            jti: Uuid::new_v4(),
            access_link,
        }
    }
}

pub fn sign(
    user_id: String,
    jwt_secret: &str,
    token_valid_for_days: i32,
    access_link: Option<AccessLinkClaims>,
) -> Result<String> {
    let tokens = encode(
        &Header::default(),
        &Claims::new(user_id, token_valid_for_days, access_link),
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )?;
    Ok(tokens)
}

pub fn verify(token: &str, jwt_secret: &str) -> Result<Claims> {
    let claims = decode(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims)?;
    Ok(claims)
}
