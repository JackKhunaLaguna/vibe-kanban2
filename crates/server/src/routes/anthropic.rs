//! Anthropic API client for task generation
//!
//! This module provides a client for calling the Anthropic Messages API
//! to generate task titles and descriptions from natural language input.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_MODEL: &str = "claude-sonnet-4-20250514";
const MAX_TOKENS: u32 = 1024;

#[derive(Debug, Error)]
pub enum AnthropicError {
    #[error("ANTHROPIC_API_KEY environment variable is not set")]
    MissingApiKey,
    #[error("API request failed: {0}")]
    RequestFailed(#[from] reqwest::Error),
    #[error("API returned error: {status} - {message}")]
    ApiError { status: u16, message: String },
    #[error("Failed to parse response: {0}")]
    ParseError(String),
}

#[derive(Debug, Serialize)]
struct Message {
    role: &'static str,
    content: String,
}

#[derive(Debug, Serialize)]
struct MessagesRequest {
    model: &'static str,
    max_tokens: u32,
    system: String,
    messages: Vec<Message>,
}

#[derive(Debug, Deserialize)]
struct MessagesResponse {
    content: Vec<ContentBlock>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
}

#[derive(Debug, Deserialize)]
struct ApiErrorResponse {
    error: ApiErrorDetail,
}

#[derive(Debug, Deserialize)]
struct ApiErrorDetail {
    message: String,
}

/// Generated task from the AI
#[derive(Debug, Deserialize)]
pub struct GeneratedTask {
    pub title: String,
    pub prompt: String,
}

/// A single task in a feature breakdown
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BreakdownTask {
    pub title: String,
    pub description: String,
    pub dependencies: Vec<String>,
}

/// Feature breakdown response from the AI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureBreakdown {
    pub tasks: Vec<BreakdownTask>,
}

/// Anthropic API client
pub struct AnthropicClient {
    client: Client,
    api_key: String,
}

impl AnthropicClient {
    /// Create a new Anthropic client, reading the API key from environment
    pub fn from_env() -> Result<Self, AnthropicError> {
        let api_key =
            std::env::var("ANTHROPIC_API_KEY").map_err(|_| AnthropicError::MissingApiKey)?;

        Ok(Self {
            client: Client::new(),
            api_key,
        })
    }

    /// Generate a task from user input
    pub async fn generate_task(&self, user_input: &str) -> Result<GeneratedTask, AnthropicError> {
        let system_prompt = r#"You are a task generation assistant for a software development project management tool.
Your role is to analyze user requests and generate well-structured tasks with clear titles and detailed prompts.

Guidelines:
1. Create a concise, actionable task title (under 80 characters) that starts with a verb (Implement, Fix, Add, Update, Refactor, etc.)
2. Write a detailed prompt/description that a coding agent can use to implement the task
3. Include specific technical details, acceptance criteria, and implementation hints in the prompt
4. The prompt should be comprehensive enough for an AI coding assistant to understand and execute

You MUST respond with valid JSON in exactly this format:
{
  "title": "Short actionable title starting with a verb",
  "prompt": "Detailed description with technical requirements, acceptance criteria, and implementation guidance"
}"#;

        let user_message = format!(
            "Generate a task from this request:\n\n{}",
            user_input
        );

        let request = MessagesRequest {
            model: DEFAULT_MODEL,
            max_tokens: MAX_TOKENS,
            system: system_prompt.to_string(),
            messages: vec![Message {
                role: "user",
                content: user_message,
            }],
        };

        let response = self
            .client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();

        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            let message = serde_json::from_str::<ApiErrorResponse>(&error_body)
                .map(|e| e.error.message)
                .unwrap_or(error_body);

            return Err(AnthropicError::ApiError {
                status: status.as_u16(),
                message,
            });
        }

        let messages_response: MessagesResponse = response.json().await?;

        // Extract text from the first content block
        let text = messages_response
            .content
            .into_iter()
            .find_map(|block| match block {
                ContentBlock::Text { text } => Some(text),
            })
            .ok_or_else(|| AnthropicError::ParseError("No text content in response".to_string()))?;

        // Parse the JSON response
        let generated: GeneratedTask = serde_json::from_str(&text).map_err(|e| {
            AnthropicError::ParseError(format!(
                "Failed to parse task JSON: {}. Response was: {}",
                e, text
            ))
        })?;

        Ok(generated)
    }

    /// Break down a feature into multiple tasks
    pub async fn breakdown_feature(
        &self,
        feature_description: &str,
        conversation_history: Option<&[ConversationMessage]>,
    ) -> Result<FeatureBreakdown, AnthropicError> {
        let system_prompt = r#"You are a feature breakdown assistant for a software development project management tool.
Your role is to analyze feature requests and break them down into well-structured, implementable tasks.

Guidelines:
1. Break down features into 3-8 discrete, actionable tasks
2. Each task should be small enough to complete in a reasonable amount of time
3. Task titles should be concise (under 80 characters) and start with a verb
4. Task descriptions should be detailed enough for an AI coding assistant to implement
5. Identify dependencies between tasks (use task titles as references)
6. Order tasks logically - foundational work first, dependent work later
7. Consider edge cases, error handling, and testing as separate tasks when appropriate

You MUST respond with valid JSON in exactly this format:
{
  "tasks": [
    {
      "title": "Short actionable title starting with a verb",
      "description": "Detailed description with technical requirements and implementation guidance",
      "dependencies": ["Title of task this depends on", "Another dependency title"]
    }
  ]
}

If the user provides feedback for refinement, adjust the breakdown accordingly while maintaining the same JSON structure."#;

        let mut messages: Vec<Message> = Vec::new();

        // Add conversation history if provided
        if let Some(history) = conversation_history {
            for msg in history {
                messages.push(Message {
                    role: if msg.role == "user" { "user" } else { "assistant" },
                    content: msg.content.clone(),
                });
            }
        }

        // Add the current user message
        let user_message = if conversation_history.is_some() && !conversation_history.unwrap().is_empty() {
            format!(
                "Please refine the feature breakdown based on this feedback:\n\n{}",
                feature_description
            )
        } else {
            format!(
                "Break down this feature into implementable tasks:\n\n{}",
                feature_description
            )
        };

        messages.push(Message {
            role: "user",
            content: user_message,
        });

        let request = MessagesRequest {
            model: DEFAULT_MODEL,
            max_tokens: 4096,
            system: system_prompt.to_string(),
            messages,
        };

        let response = self
            .client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();

        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            let message = serde_json::from_str::<ApiErrorResponse>(&error_body)
                .map(|e| e.error.message)
                .unwrap_or(error_body);

            return Err(AnthropicError::ApiError {
                status: status.as_u16(),
                message,
            });
        }

        let messages_response: MessagesResponse = response.json().await?;

        // Extract text from the first content block
        let text = messages_response
            .content
            .into_iter()
            .find_map(|block| match block {
                ContentBlock::Text { text } => Some(text),
            })
            .ok_or_else(|| AnthropicError::ParseError("No text content in response".to_string()))?;

        // Parse the JSON response
        let breakdown: FeatureBreakdown = serde_json::from_str(&text).map_err(|e| {
            AnthropicError::ParseError(format!(
                "Failed to parse breakdown JSON: {}. Response was: {}",
                e, text
            ))
        })?;

        Ok(breakdown)
    }
}

/// A message in the conversation history
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMessage {
    pub role: String,
    pub content: String,
}
