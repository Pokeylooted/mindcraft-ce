# Mindcraft Compute Sharing & Model API

This document outlines the API endpoints for interacting with the Mindcraft distributed compute system and its language models. The primary server for these interactions is `mindcraft.riqvip.dev`.

## Table of Contents

1.  [Overview](#overview)
2.  [Authentication](#authentication) (Placeholder)
3.  [Text Completions API (`/completions`)](#text-completions-api-completions)
    *   [Using `andy/` prefixed models](#using-andy-prefixed-models)
    *   [Standard Request Format](#standard-request-format)
    *   [Standard Response Format](#standard-response-format)
    *   [Fallback Mechanism](#fallback-mechanism)
4.  [Compute Pool API (`/completions/join_pool`)](#compute-pool-api-completionsjoin_pool)
    *   [Registering as a Compute Provider](#registering-as-a-compute-provider)
    *   [Request Body Parameters](#request-body-parameters)
    *   [Model Object Parameters](#model-object-parameters)
    *   [Success Response](#success-response)
    *   [Error Responses](#error-responses)
5.  [Provider Stats API (`/completions/provider_stats`)](#provider-stats-api-completionsprovider_stats)
    *   [Updating Provider Statistics](#updating-provider-statistics)
    *   [Request Body Parameters](#request-body-parameters-1)
    *   [Success Response](#success-response-1)
    *   [Error Responses](#error-responses-1)

## 1. Overview

The system consists of two main parts:
*   **Model Interaction**: Users can request text completions from various AI models, including specialized `andy/` models.
*   **Compute Sharing**: Individuals can contribute their compute resources (running Ollama-compatible models) to a shared pool, earning rewards or recognition (details TBD).

The server at `mindcraft.riqvip.dev` manages model routing, load balancing across compute providers, and registration of new providers.

## 2. Authentication

*(Placeholder: Details about API key authentication or other security measures will be added here.)*

All API requests will eventually require an API key passed in the `Authorization` header:
`Authorization: Bearer YOUR_API_KEY`

For now, authentication is not strictly enforced for all endpoints during early development.

## 3. Text Completions API (`/completions`)

This endpoint is used to generate text from a chosen AI model.

**Endpoint:** `POST https://mindcraft.riqvip.dev/completions`

### Using `andy/` prefixed models

To use the distributed `andy` models, specify a model name with the `andy/` prefix in your request. For example:
*   `"model": "andy/micro"`
*   `"model": "andy/general-large"`

The server will:
1.  Parse the alias (e.g., "micro", "general-large").
2.  Consult its list of model preferences for that alias.
3.  Find an available compute provider from the shared pool that hosts a compatible model and has capacity.
4.  Prioritize providers based on factors like average tokens per second (TPS) and current load.
5.  If the preferred model/provider is unavailable or overloaded, it will attempt to find alternatives down a predefined list for that alias.

### Standard Request Format

The request body should be a JSON object.

```json
{
  "model": "model_identifier_string", // e.g., "andy/micro", "openrouter/some-model", "pollinations/another-model"
  "prompt": "Your input text or question here.",
  "max_tokens": 150, // Optional, model-specific defaults may apply
  "temperature": 0.7, // Optional
  "stream": false // Optional, true for streaming responses
  // ... other model-specific parameters
}
```

**Common Parameters:**

*   `model` (string, required): Identifier for the model to use. For `andy` models, use the `andy/<alias>` format.
*   `prompt` (string, required): The input text for the model.
*   `max_tokens` (integer, optional): Maximum number of tokens to generate.
*   `temperature` (float, optional): Controls randomness. Lower is more deterministic.
*   `stream` (boolean, optional): If `true`, the response will be a stream of server-sent events. If `false` or omitted, a single JSON response is returned.

### Standard Response Format

For non-streaming requests (`"stream": false` or omitted):

```json
{
  "id": "cmpl-xxxxxxxxxxxxxxx", // A unique ID for the completion
  "object": "text_completion",
  "created": 1677652288, // Unix timestamp
  "model": "model_identifier_used", // Actual model that processed the request
  "choices": [
    {
      "text": "The model's generated response text.",
      "index": 0,
      "logprobs": null,
      "finish_reason": "stop" // e.g., "stop", "length"
    }
  ],
  "usage": { // Optional, may not be available for all models
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```
**Key Response Fields:**
*   `choices[0].text`: The generated text. The server will automatically trim any `<think>...</think>` blocks used internally by some models before sending the response to the client.

For streaming requests (`"stream": true`), the response will be a series of Server-Sent Events (SSE).

### Fallback Mechanism

If all specified `andy/` model providers are unavailable or overloaded, the request will be automatically redirected to use the `pollinations` API as a final fallback to ensure service availability. The response structure will remain consistent.

## 4. Compute Pool API (`/completions/join_pool`)

This endpoint allows individuals to register their Ollama-based AI models and compute resources with the Mindcraft horde.

**Endpoint:** `POST https://mindcraft.riqvip.dev/completions/join_pool`

### Registering as a Compute Provider

To join the pool, a compute provider (running their own Ollama instance with accessible models) sends a POST request with details about their setup and the models they are offering.

The server will use the provider's public IP address (from the request) or a specified IP in the payload. The provider's Ollama API endpoint should be accessible by the Mindcraft server.

### Request Body Parameters

The request body must be a JSON object:

```json
{
  "ip": "YOUR_PUBLIC_IP:PORT", // Your Ollama server's public IP address and port (e.g., "123.45.67.89:11434")
  "models": [
    // Array of model objects, see below (minimum 1, maximum 12)
  ],
  "max_clients": 4, // Optional: Max concurrent requests your endpoint can handle (default: 4)
  "avg_tps": 50.5 // Optional: Your estimated/measured average tokens per second for a typical model
  // "gpu_info": "NVIDIA RTX 4090", // Optional: Information about your GPU
  // "vram_gb": 24 // Optional: Available VRAM in GB
}
```

*   `ip` (string, required): The publicly accessible IP address and port of the provider's Ollama API.
*   `models` (array, required): An array of [Model Objects](#model-object-parameters) being offered. Must contain at least 1 and at most 12 model objects.
*   `max_clients` (integer, optional): Your desired maximum concurrent requests. The server may adjust this value based on the models you offer and VRAM you report (if any). If not specified, the server will calculate a default.
*   `avg_tps` (float, optional): Your estimated/measured average tokens per second for a typical model you offer. Defaults to `0`.
*   `gpu_info` (string, optional): Description of the GPU(s) used (e.g., "NVIDIA GeForce RTX 3080"). This is for informational purposes for the server admin.
*   `vram_gb` (integer, optional): Amount of VRAM available in Gigabytes on your compute endpoint. Providing this helps the server more accurately assign an appropriate `max_clients` limit for your endpoint.

### Model Object Parameters

Each object in the `models` array must have the following structure:

```json
{
  "name": "Andy-4-micro-0516", // User-friendly name, often includes version/date
  "id": "ollama_model_id", // The EXACT model ID as known by your Ollama instance (e.g., "llama2:7b-chat-q4_K_M")
  "quantization": "Q8_0", // Quantization level (e.g., "Q4_0", "Q5_K_M", "FP16")
  "context_length": 8192, // Maximum context length supported by this model (integer)
  "release_date": "2024-05-16T00:00:00Z" // REQUIRED: ISO 8601 timestamp of when this model version was released or made available by you
}
```

*   `name` (string, required): A descriptive name for the model (e.g., "MyCustomLlama3-8B-Instruct"). This can be used by the server to match aliases like "andy/micro".
*   `id` (string, required): The specific model tag/ID that your Ollama instance uses to serve this model (e.g., `mistral:7b-instruct-v0.2-q5_K_M`). This is what the Mindcraft server will use in API calls to your Ollama.
*   `quantization` (string, required): The quantization type of the model (e.g., "Q4_0", "Q8_0", "FP16").
*   `context_length` (integer, required): The maximum context window size (in tokens) supported by this specific model on your setup.
*   `release_date` (string, required): The release date of this particular model version/quantization, in ISO 8601 format (e.g., `"2023-12-25T10:00:00Z"`). This is crucial for version management and selecting the "latest" models.

### Success Response

Status Code: `200 OK`

```json
{
  "message": "Compute provider registered/updated successfully."
}
```
This response is sent if the provider's details are valid and they have been added to or updated in the pool.

### Error Responses

*   Status Code: `400 Bad Request`
    *   If required fields are missing or invalid (e.g., no `ip`, no `models`, invalid `release_date` format, too many models).
    *   Example: `{"error": "Missing required fields: ip and models array."}`
    *   Example: `{"error": "Invalid release_date format for model 'Andy-4-micro'. Please use ISO 8601 format."}`
*   Status Code: `500 Internal Server Error`
    *   If an unexpected error occurs on the server side during registration.
    *   Example: `{"error": "Internal server error while registering provider."}`

## 5. Provider Stats API (`/completions/provider_stats`)

This endpoint allows registered compute providers to periodically push updated statistics about their performance, such as average tokens per second (TPS). This helps the main server make better load-balancing decisions.

**Endpoint:** `POST https://mindcraft.riqvip.dev/completions/provider_stats`

### Updating Provider Statistics

A compute provider should periodically (e.g., every 5-10 minutes, or after a certain number of requests) send a POST request with their latest `avg_tps`.

### Request Body Parameters (Provider Stats)

The request body must be a JSON object:

```json
{
  "ip": "YOUR_PUBLIC_IP:PORT", // Your Ollama server's public IP and port, must match registered IP
  "avg_tps": 65.2 // Your new calculated average tokens per second
}
```

*   `ip` (string, required): The IP address and port of the provider, matching the one used during registration via `/completions/join_pool`.
*   `avg_tps` (float, required): The new average tokens per second observed by the provider. Must be a non-negative number.

### Success Response (Provider Stats)

Status Code: `200 OK`

```json
{
  "message": "Provider stats updated successfully."
}
```

### Error Responses (Provider Stats)

*   Status Code: `400 Bad Request`
    *   If `ip` or `avg_tps` is missing or invalid.
    *   Example: `{"error": "Missing or invalid 'avg_tps' field. Must be a non-negative number."}`
*   Status Code: `404 Not Found`
    *   If the provided `ip` does not match any registered compute provider.
    *   Example: `{"error": "Provider with IP YOUR_PUBLIC_IP:PORT not found."}`
*   Status Code: `500 Internal Server Error`
    *   If an unexpected error occurs on the server side.
    *   Example: `{"error": "Internal server error while updating provider stats."}`
---

*This API documentation is subject to change as development progresses.*
