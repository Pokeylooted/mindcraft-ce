# Mindcraft Andy API

This project implements the Andy API, a community-based compute cluster for text generation models.

## Components

- **Client UI (`client_ui/`)**: A web-based interface for users to join the compute pool by offering their local Ollama models.
- **Server API (`server_api/`)**: The central server that manages compute providers, handles completion requests, and routes them accordingly.
- **Website (`website/`)**: The public-facing website for `mindcraft.riqvip.dev`, which will display available models and information about the service.

## Project Structure

```
mindcraft_andy_api/
├── client_ui/
│   ├── index.html
│   ├── style.css
│   └── script.js
├── server_api/
│   ├── main.py
│   ├── requirements.txt
│   └── templates/
│       └── index.html  // Placeholder for now, might be used for server status
├── website/
│   ├── index.html
│   ├── style.css
│   └── script.js
└── README.md
```

## Running the Project

### 1. Server API

The server is a Flask application.

**Prerequisites:**
*   Python 3.7+
*   `pip`

**Setup & Run:**
```bash
cd mindcraft_andy_api/server_api
pip install -r requirements.txt

# Set environment variables (especially for Pollinations API)
export FLASK_APP=main.py
export FLASK_ENV=development # or production
export POLLINATIONS_API_KEY="your_pollinations_api_key"
# Optionally, if Pollinations API details differ from defaults in code:
# export POLLINATIONS_TEXT_API_URL="https://actual.pollinations.url/api/text"
# export POLLINATIONS_DEFAULT_TEXT_MODEL="specific-pollinations-model"

flask run --host=0.0.0.0 --port=5000 # Or any port you prefer
```
The server will be available at `http://localhost:5000` (or your configured host/port). In a production environment, this would be deployed behind a reverse proxy like Nginx or Caddy, which would also handle HTTPS for `https://mindcraft.riqvip.dev`.

### 2. Client UI (for Compute Providers)

This is a static set of HTML, CSS, and JavaScript files.

**Setup & Run:**
1.  Navigate to the `mindcraft_andy_api/client_ui/` directory.
2.  Open `index.html` in a web browser.
3.  Ensure you have a local Ollama instance running and accessible.
4.  Enter your Ollama API URL (e.g., `http://localhost:11434`) in the UI.
5.  Fetch your models, select the ones you want to share.
6.  Optionally provide GPU info, VRAM, and max concurrent clients.
7.  Click "Join Pool". This will send your details to the running Server API (ensure the `mindcraftApiEndpoint` in `client_ui/script.js` points to your server, default is `https://mindcraft.riqvip.dev/generations/join_pool`. For local testing, you might change this to `http://localhost:5000/generations/join_pool`).

### 3. Website

This is a static set of HTML, CSS, and JavaScript files that would be served by `mindcraft.riqvip.dev`.

**Setup & Run (for viewing):**
1.  Navigate to the `mindcraft_andy_api/website/` directory.
2.  Open `index.html` in a web browser.
3.  This site fetches available models from the Server API (ensure the fetch URL in `website/script.js` points to your server, default is `https://mindcraft.riqvip.dev/api/models`. For local testing, change to `http://localhost:5000/api/models`).

## API Endpoints (Server API)

The server API is hosted at `https://mindcraft.riqvip.dev` (or `http://localhost:5000` for local dev).

### `POST /generations/join_pool`
Allows a compute provider to register their Ollama instance and models with the pool.

**Request Body (JSON):**
```json
{
  "ollama_base_url": "http://<provider_ollama_host>:<port>", // e.g., "http://localhost:11434" or public IP if exposed
  "models": [
    {
      "name": "model_name:tag", // e.g., "llama3:latest"
      "model": "model_name:tag", // often same as name
      "digest": "sha256_digest_string",
      "size": 1234567890, // in bytes
      "details": {
        "parent_model": "",
        "format": "gguf",
        "family": "llama",
        "families": ["llama"],
        "parameter_size": "8B",
        "quantization_level": "Q4_0"
      }
      // ... other fields from Ollama's /api/tags response for the model
    }
    // ... more models
  ],
  "gpu_info": "NVIDIA GeForce RTX 3080", // Optional
  "vram_gb": 10, // Optional, integer
  "max_clients": 4 // Optional, integer, how many concurrent requests this provider can handle
}
```

**Response (Success - 201):**
```json
{
  "message": "Successfully joined the compute pool",
  "provider_id": "provider_1"
}
```
**Response (Error - 400):**
```json
{
  "error": "Description of the error"
}
```

### `POST /completions`
Requests a text completion from the community pool.

**Request Body (JSON):**
```json
{
  "model": "model_name:tag", // e.g., "llama3:8b-instruct-q5_K_M" or "mistral"
  "prompt": "Why is the sky blue?",
  "stream": false, // Optional, defaults to false
  "options": { // Optional, Ollama options like temperature, top_k, etc.
    "temperature": 0.7
  },
  "system": "You are a helpful assistant.", // Optional
  "template": "{{ .Prompt }}", // Optional
  "context": [], // Optional, for conversational context
  "format": "json" // Optional, for structured output
}
```

**Response (Success - 200):**
The response structure mirrors Ollama's `/api/generate` response if served by a community provider, or a custom structure if served by Pollinations.
Example from community provider:
```json
{
  "model": "requested_model:tag",
  "created_at": "timestamp",
  "response": "The generated text...", // <think> blocks are stripped
  "done": true,
  // ... other Ollama response fields like context, durations, etc.
}
```
Example from Pollinations fallback:
```json
{
  "response": "The generated text from Pollinations...", // <think> blocks are stripped
  "source": "pollinations" // or "pollinations_unknown_structure"
}
```

**Response (Error - 400, 500, 503, etc.):**
```json
{
  "error": "Description of the error"
  // "source": "pollinations" might be present if error came from fallback
}
```

### `GET /api/models`
Lists unique models currently available from active providers in the pool. Intended for the website to display.

**Response (Success - 200):**
```json
[
  {
    "name": "llama3:latest",
    "providers_available": 2,
    "details": { /* details from one of the providers */ }
  },
  {
    "name": "mistral:7b-instruct-v0.2-q4_K_M",
    "providers_available": 1,
    "details": { /* ... */ }
  }
  // ... more models
]
```

### `GET /debug/providers`
(Debug endpoint) Shows the current internal list of registered compute providers and their status.
**Response (Success - 200):**
```json
{
  "provider_1": {
    "id": "provider_1",
    "ollama_base_url": "http://localhost:11434",
    "models": [ /* ... */ ],
    "gpu_info": null,
    "vram_gb": null,
    "max_clients": 1,
    "current_load": 0
  }
  // ... more providers
}
```
