from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os
import re
import requests # For Pollinations and forwarding to compute nodes

app = Flask(__name__)
CORS(app) # Allow all origins for now, restrict in production

# In-memory store for compute providers and their models
# Structure:
# {
# "provider_id_1": {
# "ollama_base_url": "http://their.local.ollama.ip:port", # Stored for internal use, NOT sent to end-users
# "models": [
#             { "name": "llama3:latest", "details": {...}, "size": ..., "digest": ...},
#             { "name": "mistral:7b", "details": {...}, "size": ..., "digest": ...}
# ],
# "gpu_info": "NVIDIA RTX 3080",
# "vram_gb": 10,
# "max_clients": 4, # Max concurrent requests this provider can handle
# "current_load": 0, # Active requests being handled by this provider
# "id": "provider_id_1" # A unique ID for the provider
#     },
# ...
# }
compute_providers = {}
provider_counter = 0 # Simple counter for unique provider IDs

# --- Helper Functions ---
def generate_provider_id():
    global provider_counter
    provider_counter += 1
    return f"provider_{provider_counter}"

def find_pollinations_api_key():
    # This is a placeholder. In a real scenario, you'd securely fetch this.
    # For example, from environment variables or a config file.
    # Attempting to find it in Mindcraft's typical structure.
    # This part needs to be adapted based on actual Mindcraft structure.
    # For now, let's assume it's an environment variable or a hardcoded placeholder.
    return os.environ.get("POLLINATIONS_API_KEY", "YOUR_POLLINATIONS_API_KEY_HERE")

def call_pollinations_api(prompt, model):
    api_key = find_pollinations_api_key()
    if api_key == "YOUR_POLLINATIONS_API_KEY_HERE":
        return {"error": "Pollinations API key not configured"}, 503

    # Actual Pollinations API endpoint for text generation might differ.
    # This is a structured guess.
    # Common text generation APIs: "https://api.pollinations.ai/v1/completions" or similar.
    # For this example, let's assume a hypothetical endpoint and payload.
    # IMPORTANT: This needs to be verified against actual Mindcraft integration.

    pollinations_url = os.environ.get("POLLINATIONS_TEXT_API_URL", "https://api.pollinations.ai/v1/text/completions") # Example, configurable
    default_pollinations_model = os.environ.get("POLLINATIONS_DEFAULT_TEXT_MODEL", "text-davinci-003") # Example

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    # Try to use the requested model if Pollinations might support it, else a default
    # This logic might need refinement based on how Pollinations names models.
    final_model_for_pollinations = model if ":" not in model else model.split(":")[0] # Simplistic mapping

    payload = {
        "model": final_model_for_pollinations, # Or a known default like default_pollinations_model
        "prompt": prompt,
        "max_tokens": 1500, # Default, can be overridden by request
        "temperature": 0.7 # Default, can be overridden by request
        # Potentially pass other parameters from original request if compatible
    }

    print(f"Calling Pollinations API: URL='{pollinations_url}', Model='{payload['model']}'")

    try:
        api_response = requests.post(pollinations_url, headers=headers, json=payload, timeout=45) # Increased timeout
        api_response.raise_for_status()

        response_data = api_response.json()

        # Adapt to actual Pollinations response structure. Common patterns:
        # 1. {"completion": "text..."}
        # 2. {"choices": [{"text": "text..."}]}
        # 3. {"data": {"text": "text..."}} or {"data": {"completion": "text..."}}

        # Assuming a structure like {"completion": "..."} or {"choices": [{"text": ...}]}
        if "completion" in response_data:
            return {"response": response_data["completion"], "source": "pollinations"}, api_response.status_code
        elif "choices" in response_data and len(response_data["choices"]) > 0 and "text" in response_data["choices"][0]:
            return {"response": response_data["choices"][0]["text"], "source": "pollinations"}, api_response.status_code
        elif "data" in response_data and "completion" in response_data["data"]:
             return {"response": response_data["data"]["completion"], "source": "pollinations"}, api_response.status_code
        elif "data" in response_data and "text" in response_data["data"]:
             return {"response": response_data["data"]["text"], "source": "pollinations"}, api_response.status_code
        else:
            # If structure is unknown, return the whole thing but flag it
            print(f"Pollinations response structure not recognized: {response_data}")
            return {"response": json.dumps(response_data), "source": "pollinations_unknown_structure"}, api_response.status_code

    except requests.exceptions.HTTPError as e:
        print(f"Pollinations API HTTP error: {e.response.status_code} - {e.response.text}")
        error_detail = f"Pollinations API request failed with status {e.response.status_code}"
        try:
            error_body = e.response.json()
            error_detail += f": {error_body.get('error', {}).get('message', e.response.text)}"
        except ValueError: # If response is not JSON
            error_detail += f": {e.response.text}"
        return {"error": error_detail, "source": "pollinations"}, e.response.status_code
    except requests.exceptions.RequestException as e:
        print(f"Pollinations API general error: {e}")
        return {"error": f"Pollinations API request failed: {str(e)}", "source": "pollinations"}, 500


def strip_think_blocks(text):
    """Removes <think>...</think> blocks from text."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()

# --- API Endpoints ---

@app.route('/')
def home():
    # Could serve a simple status page or API documentation
    return jsonify({"message": "Mindcraft Andy API is running."})

@app.route('/generations/join_pool', methods=['POST'])
def join_pool():
    data = request.json
    ollama_base_url = data.get('ollama_base_url')
    models = data.get('models')
    gpu_info = data.get('gpu_info')
    vram_gb = data.get('vram_gb')
    max_clients_user = data.get('max_clients')

    if not ollama_base_url or not models:
        return jsonify({"error": "ollama_base_url and models are required"}), 400

    # Basic URL validation
    if not (ollama_base_url.startswith("http://") or ollama_base_url.startswith("https://")):
        return jsonify({"error": "ollama_base_url must start with http:// or https://"}), 400

    try:
        # Further validate model structure (example for one model)
        if not isinstance(models, list) or not all(isinstance(m, dict) and 'name' in m for m in models):
            return jsonify({"error": "models must be a list of objects, each with at least a 'name'"}), 400
    except Exception:
            return jsonify({"error": "Invalid models structure"}), 400


    provider_id = generate_provider_id()

    # Determine max_clients: user-defined or auto-calculated (simple logic for now)
    if max_clients_user is not None and isinstance(max_clients_user, int) and max_clients_user > 0:
        max_clients = max_clients_user
    elif vram_gb and vram_gb >= 16:
        max_clients = 8
    elif vram_gb and vram_gb >= 8:
        max_clients = 4
    elif vram_gb and vram_gb >= 4:
        max_clients = 2
    else:
        max_clients = 1 # Default low if not much info

    compute_providers[provider_id] = {
        "id": provider_id,
        "ollama_base_url": ollama_base_url,
        "models": models,
        "gpu_info": gpu_info,
        "vram_gb": vram_gb,
        "max_clients": max_clients,
        "current_load": 0,
        # Could add last_seen timestamp, status (online/offline via heartbeats later)
    }
    print(f"Provider joined: {provider_id} with models: {[m['name'] for m in models]}")
    return jsonify({"message": "Successfully joined the compute pool", "provider_id": provider_id}), 201

@app.route('/api/models', methods=['GET'])
def get_available_models():
    """
    Lists all unique models available across all providers.
    This is for the main website to display what the cluster offers.
    """
    all_models_summary = {}
    for provider_id, provider_data in compute_providers.items():
        if provider_data.get("current_load", 0) < provider_data.get("max_clients", 1): # Only list if provider has capacity
            for model_info in provider_data.get("models", []):
                model_name = model_info.get("name")
                if model_name:
                    if model_name not in all_models_summary:
                        all_models_summary[model_name] = {
                            "name": model_name,
                            "providers_available": 1,
                            # We could add more details like combined capacity, best quantization etc.
                            "details": model_info.get("details", {}) # Show details from one of the providers
                        }
                    else:
                        all_models_summary[model_name]["providers_available"] += 1
    return jsonify(list(all_models_summary.values())), 200


@app.route('/completions', methods=['POST'])
def completions():
    data = request.json
    prompt = data.get('prompt')
    model_name_req = data.get('model') # e.g., "Andy-4-micro" or "Andy-4-micro:Q8_0"
    # Other parameters like temperature, max_tokens can be passed through

    if not prompt or not model_name_req:
        return jsonify({"error": "prompt and model are required"}), 400

    # Find a suitable provider
    # Prioritize exact match (model:tag), then base model name
    # Also consider provider load
    selected_provider = None
    best_match_level = 0 # 2 for exact, 1 for base name

    providers_sorted_by_load = sorted(
        compute_providers.items(),
        key=lambda item: item[1].get('current_load', float('inf')) / item[1].get('max_clients', 1)
    )

    for provider_id, provider_data in providers_sorted_by_load:
        if provider_data.get('current_load', 0) >= provider_data.get('max_clients', 1):
            continue # Skip overloaded providers

        for model_info in provider_data.get("models", []):
            current_model_name = model_info.get("name")
            if current_model_name == model_name_req and best_match_level < 2: # Exact match (model:tag)
                selected_provider = provider_data
                best_match_level = 2
                break
            # Check for base model match if specific tag wasn't found yet
            if ":" in model_name_req and current_model_name.startswith(model_name_req.split(":")[0]) and best_match_level < 1:
                selected_provider = provider_data
                best_match_level = 1
                # Don't break, keep looking for exact match if possible
            elif ":" not in model_name_req and current_model_name.startswith(model_name_req) and best_match_level < 1:
                selected_provider = provider_data
                best_match_level = 1


        if best_match_level == 2: # Found exact match
            break

    if selected_provider:
        provider_ollama_url = selected_provider['ollama_base_url']
        # Increment load
        selected_provider['current_load'] += 1
        print(f"Routing to provider {selected_provider['id']} for model {model_name_req}. Current load: {selected_provider['current_load']}/{selected_provider['max_clients']}")

        try:
            # Forward the request to the provider's Ollama instance
            # The client UI runs Ollama, so we call its /api/generate or /api/chat
            # Assuming /api/generate for now
            ollama_payload = {
                "model": model_name_req, # Provider should have this exact model name
                "prompt": prompt,
                "stream": data.get("stream", False),
                # Pass through other ollama params if provided in original request
                "options": data.get("options", {}),
                "system": data.get("system"),
                "template": data.get("template"),
                "context": data.get("context"),
                "format": data.get("format")
            }
            # Remove None values to avoid sending them if not provided
            ollama_payload = {k: v for k, v in ollama_payload.items() if v is not None}

            response = requests.post(
                f"{provider_ollama_url}/api/generate", # Or /api/chat depending on needs
                json=ollama_payload,
                timeout=120 # Generous timeout
            )
            response.raise_for_status()
            completion_data = response.json()

            # Decrement load
            selected_provider['current_load'] -= 1

            # Trim <think> blocks
            if "response" in completion_data and isinstance(completion_data["response"], str):
                completion_data["response"] = strip_think_blocks(completion_data["response"])

            # If streaming, each part would need stripping, more complex.
            # For now, assuming non-streaming or final response stripping.

            return jsonify(completion_data), response.status_code

        except requests.exceptions.RequestException as e:
            print(f"Error forwarding to provider {selected_provider['id']}: {e}")
            selected_provider['current_load'] -= 1 # Decrement load on error
            # Fall through to Pollinations if provider fails
        except Exception as e:
            print(f"Generic error with provider {selected_provider['id']}: {e}")
            selected_provider['current_load'] -= 1
            # Fall through

    # Fallback to Pollinations API if no suitable provider or provider error
    print(f"No suitable community provider found for {model_name_req} or provider failed. Falling back to Pollinations.")
    # TODO: Determine how to map requested model_name to what Pollinations expects
    # This might need a mapping or using a default Pollinations model.
    # For now, let's assume Pollinations can handle the model_name_req or a generic one.
    pollinations_model = model_name_req # This might need adjustment

    # Example of stripping model tag for a more generic request if needed
    # if ":" in pollinations_model:
    # pollinations_model = pollinations_model.split(":")[0]

    result, status_code = call_pollinations_api(prompt, pollinations_model)

    # Also strip think blocks from Pollinations if applicable (assuming it might also use them)
    if "response" in result and isinstance(result.get("response"), str): # Or however Pollinations structures its response
        result["response"] = strip_think_blocks(result["response"])
    elif "completion" in result and isinstance(result.get("completion"), str): # Common alternative key
         result["completion"] = strip_think_blocks(result["completion"])


    return jsonify(result), status_code


@app.route('/debug/providers', methods=['GET'])
def debug_providers():
    return jsonify(compute_providers)

if __name__ == '__main__':
    # Make sure to set POLLINATIONS_API_KEY environment variable
    # e.g., export POLLINATIONS_API_KEY='your_actual_api_key'
    app.run(host='0.0.0.0', port=5000, debug=True)
```
