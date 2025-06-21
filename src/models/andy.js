class AndyModel {
    // apiKey: API key, potentially for future use.
    // options: General configuration options. Can include 'modelProfiles' for custom model size/VRAM configuration.
    constructor(apiKey, options = {}) {
        this.apiKey = apiKey;
        this.options = options || {};

        // Default model profiles (name patterns to size and VRAM estimates)
        // More specific names should come before more general ones.
        // Names are matched using startsWith, so 'Andy-4-micro' will match before 'Andy-4'.
        this.modelProfiles = {
            'Andy-4-micro': { sizeB: 1.5, vramPerInstanceGB: 3, defaultMaxClients: 4 }, // Increased VRAM for micro
            'Andy-4-small': { sizeB: 3.0, vramPerInstanceGB: 5, defaultMaxClients: 3 }, // Added small
            'Andy-4-medium': { sizeB: 8.0, vramPerInstanceGB: 10, defaultMaxClients: 2 },// Renamed Andy-4 to Andy-4-medium
            'Andy-4': { sizeB: 8.0, vramPerInstanceGB: 10, defaultMaxClients: 2 }, // General Andy-4, if not more specific
            'default': { sizeB: 7.0, vramPerInstanceGB: 8, defaultMaxClients: 2 } // Default for unrecognized models
        };
        // Allow overriding default profiles via options
        if (this.options.modelProfiles) {
            this.modelProfiles = { ...this.modelProfiles, ...this.options.modelProfiles };
        }

        this.computeProviders = []; // Stores provider objects
        /*
        Each provider object:
        {
          ip: "123.45.67.89:11434", // Host and port
          models: [
            { name: "Andy-4-micro", id: "ollama_model_id_1", quantization: "Q8_0", context_length: 8192, release_date: "2024-05-15T00:00:00Z" },
            { name: "Andy-4-small", id: "ollama_model_id_2", quantization: "Q4_0", context_length: 4096, release_date: "2024-05-10T00:00:00Z" }
          ],
          max_clients: 4,
          current_load: 0,
          avg_tps: 100,
          failureCount: 0,
          lastFailedTimestamp: null,
          isSuspect: false,
          suspectCooldownUntil: null // Timestamp until which this provider should not be used
        }
        */

        // Model aliases and their preferred model names (user-facing names)
        // e.g., { "micro": ["Andy-4-micro-0516", "Andy-4-micro"], "general": ["Andy-4"] }
        this.modelAliases = {
            "micro": ["Andy-4-micro-0516", "Andy-4-micro"],
            "small": ["Andy-4-small-0516", "Andy-4-small"],
            "medium": ["Andy-4-medium-0601", "Andy-4-medium"],
            "large": ["Andy-4-large-latest", "Andy-4-large"],
        };
    }

    async complete(prompt, params = {}) {
        const modelAlias = params.modelIdentifier; // e.g., "micro" from "andy/micro"
        if (!modelAlias || !this.modelAliases[modelAlias]) {
            console.error(`Unknown model alias: ${modelAlias}`);
            // Fallback to pollinations or return error
            return this.fallbackToPollinations(prompt, params);
        }

        const preferredModelNames = this.modelAliases[modelAlias]; // Array of user-friendly model names
        let attempts = 0;
        // Heuristic for max attempts to prevent infinite loops in weird scenarios; +5 for some buffer.
        const MAX_ATTEMPTS_PER_ALIAS = (this.computeProviders.length * preferredModelNames.length) + 5;

        // Loop through preferred model names and then through providers
        for (const targetModelName of preferredModelNames) {
            // Filter out suspect providers or those in cooldown.
            // Sort available providers by average tokens per second (descending)
            // and then by current client load (ascending) to prioritize faster, less loaded providers.
            const availableProviders = this.computeProviders
                .filter(p => !p.isSuspect && (!p.suspectCooldownUntil || p.suspectCooldownUntil < Date.now()))
                .sort((a, b) => {
                    if (b.avg_tps !== a.avg_tps) return b.avg_tps - a.avg_tps;
                    return a.current_load - b.current_load;
                });

            for (const provider of availableProviders) {
                if (attempts++ > MAX_ATTEMPTS_PER_ALIAS) { // Safety break
                    console.warn(`[AndyModel] Exceeded max attempts for alias ${modelAlias}. Breaking.`);
                    return this.fallbackToPollinations(prompt, { ...params, model: modelAlias });
                }

                if (provider.current_load >= provider.max_clients) {
                    continue; // Skip provider if at max capacity
                }

                // Find a model offered by this provider that matches the target user-friendly name
                const chosenModel = provider.models.find(m => m.name === targetModelName || m.name.startsWith(targetModelName));

                if (chosenModel) {
                    provider.current_load++;
                    console.log(`[AndyModel] Attempting to route to provider ${provider.ip} for model ${chosenModel.name} (Ollama ID: ${chosenModel.id}). Load: ${provider.current_load}/${provider.max_clients}`);

                    try {
                        const ollamaRequestBody = {
                            model: chosenModel.id, // Use the Ollama-specific model ID
                            prompt: prompt,
                            stream: false, // For now, handle non-streaming responses
                        };
                        // Forward other relevant parameters from `params`
                        const { modelIdentifier, ...ollamaOptions } = params; // Exclude modelIdentifier
                        Object.assign(ollamaRequestBody, ollamaOptions);


                        const response = await fetch(`http://${provider.ip}/api/generate`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(ollamaRequestBody)
                        });

                        if (!response.ok) {
                            const errorBody = await response.text();
                            throw new Error(`Compute provider ${provider.ip} error: ${response.status} ${response.statusText} - ${errorBody}`);
                        }

                        // Assuming Ollama's non-streaming response is a single JSON object
                        // or a stream of JSON objects for each token if not handled properly by `stream:false`
                        // For `stream: false`, it should be a single JSON object with a final `response` field.
                        const result = await response.json();
                        let text = result.response; // Standard field for Ollama's final response string

                        if (typeof text !== 'string') {
                             // Sometimes Ollama might send multiple JSON objects on a single line or a slightly different structure if an error occurs within its generation.
                            console.warn(`[AndyModel] Unexpected response structure from ${provider.ip}. Full result:`, JSON.stringify(result));
                            text = result.error || "Error: Malformed response from provider."; // Fallback if .response isn't there
                            if (result.done === true && result.response === '') { // Empty response on done is possible
                                text = '';
                            } else if (typeof text !== 'string') {
                                throw new Error(`Malformed response from provider ${provider.ip}: 'response' field is not a string or missing.`);
                            }
                        }

                        provider.current_load--;
                        provider.failureCount = 0; // Reset failure count on success
                        provider.isSuspect = false;
                        provider.suspectCooldownUntil = null;

                        text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                        console.log(`[AndyModel] Successfully received response from ${provider.ip} for model ${chosenModel.name}. Load: ${provider.current_load}/${provider.max_clients}`);
                        return { text };

                    } catch (error) {
                        console.error(`[AndyModel] Error contacting compute provider ${provider.ip} for model ${chosenModel.name}:`, error.message);
                        provider.current_load--; // Decrement load as request failed
                        provider.failureCount = (provider.failureCount || 0) + 1;
                        provider.lastFailedTimestamp = Date.now();

                        if (provider.failureCount >= 3) { // Failure threshold
                            console.warn(`[AndyModel] Provider ${provider.ip} reached failure threshold (${provider.failureCount}). Marking as suspect.`);
                            provider.isSuspect = true;
                            provider.suspectCooldownUntil = Date.now() + (5 * 60 * 1000); // 5 minute cooldown
                            this.reconcileProviderModels(provider); // Attempt to reconcile models
                        }
                        // Continue to the next provider or model name
                    }
                }
            }
        }
        // If loop completes without returning, no suitable provider was found or all failed
        console.warn(`[AndyModel] No suitable and working compute provider found for alias ${modelAlias} after trying all options. Falling back.`);
        return this.fallbackToPollinations(prompt, { ...params, model: modelAlias });
    }

    async reconcileProviderModels(provider) {
        console.log(`[AndyModel] Attempting to reconcile models for suspect provider: ${provider.ip}`);
        try {
            const response = await fetch(`http://${provider.ip}/api/tags`);
            if (!response.ok) {
                throw new Error(`Failed to fetch /api/tags from ${provider.ip}: ${response.status}`);
            }
            const tagsData = await response.json();
            if (!tagsData || !tagsData.models || !Array.isArray(tagsData.models)) {
                throw new Error(`Invalid /api/tags response structure from ${provider.ip}`);
            }

            const liveModelIds = new Set(tagsData.models.map(m => m.name)); // Ollama's /api/tags returns model IDs in the 'name' field

            const originalModelCount = provider.models.length;
            const reconciledModels = provider.models.filter(registeredModel => liveModelIds.has(registeredModel.id));

            if (reconciledModels.length < originalModelCount) {
                console.warn(`[AndyModel] Reconciled models for ${provider.ip}. ${originalModelCount - reconciledModels.length} models removed as they are no longer reported by /api/tags. Kept: ${reconciledModels.map(m=>m.id).join(', ')}`);
            } else {
                console.log(`[AndyModel] Model reconciliation for ${provider.ip}: All registered models confirmed via /api/tags.`);
            }

            provider.models = reconciledModels;

            if (provider.models.length > 0) {
                // If provider still has usable models, reset suspicion partially or fully
                // For now, we keep the cooldown but reset failure count if models were found.
                // This allows it to be retried after cooldown.
                // If it became suspect due to this reconciliation, the cooldown is already set.
                // provider.isSuspect = false; // Or based on some other logic
                provider.failureCount = 0; // Reset failure count as we've taken action
                console.log(`[AndyModel] Provider ${provider.ip} models reconciled. Failure count reset. Will be available after cooldown if still suspect.`);
            } else {
                console.warn(`[AndyModel] Provider ${provider.ip} has no usable models after reconciliation. It will remain suspect and likely unusable.`);
                // Provider remains suspect, cooldown remains.
            }

        } catch (error) {
            console.error(`[AndyModel] Error during model reconciliation for provider ${provider.ip}:`, error.message);
            // Provider remains suspect, cooldown remains.
        }
    }


    async fallbackToPollinations(prompt, params) {
        const modelRequested = params.model || 'unknown';
        console.warn(`[AndyModel] Fallback to Pollinations API triggered for model request: ${modelRequested}. Prompt: "${prompt.substring(0, 50)}..."`);
        console.warn(`[AndyModel] Pollinations API integration is not yet implemented. Returning an error message.`);

        // This is a stub. To implement this, you would need:
        // 1. A Pollinations API client or direct fetch calls to their endpoint.
        // 2. API key/authentication for Pollinations.
        // 3. Knowledge of Pollinations request/response structure for text generation.
        // Example (conceptual):
        // try {
        //     const pollinationsClient = new PollinationsClient(this.options.pollinationsApiKey);
        //     const response = await pollinationsClient.generate({
        //         model: params.pollinationsModelEquivalent || 'default-pollinations-model', // Map Andy model to Pollinations model
        //         prompt: prompt,
        //         ...otherParams // Forward relevant params
        //     });
        //     return { text: response.text.replace(/<think>[\s\S]*?<\/think>/g, '').trim() };
        // } catch (error) {
        //     console.error(`[AndyModel] Error during Pollinations fallback:`, error);
        //     return { text: `Error: Pollinations fallback failed. Details: ${error.message}` };
        // }

        return { text: `Error: Pollinations fallback for model ${modelRequested} is not yet implemented. System could not find a working 'andy/' provider.` };
    }

    addComputeProvider(providerDetails) {
        if (!providerDetails || !providerDetails.ip || !providerDetails.models || !providerDetails.models.length) {
            console.error("[AndyModel] Invalid provider details for addComputeProvider:", providerDetails);
            return false;
        }
        for (const model of providerDetails.models) {
            if (!model.release_date) {
                console.error(`[AndyModel] Model ${model.name} from provider ${providerDetails.ip} is missing release_date.`);
                return false;
            }
        }

        const existingProvider = this.computeProviders.find(p => p.ip === providerDetails.ip);

        // Determine dominant model profile for this provider
        let dominantProfile = this.modelProfiles.default;
        let maxVramPerInstance = this.modelProfiles.default.vramPerInstanceGB;

        if (providerDetails.models && providerDetails.models.length > 0) {
            for (const model of providerDetails.models) {
                let foundProfile = null;
                // Find best matching profile (most specific first)
                for (const profileName in this.modelProfiles) {
                    if (model.name.startsWith(profileName)) {
                        foundProfile = this.modelProfiles[profileName];
                        break;
                    }
                }
                if (!foundProfile) foundProfile = this.modelProfiles.default; // Fallback to default if no specific match

                if (foundProfile.vramPerInstanceGB > maxVramPerInstance) {
                    maxVramPerInstance = foundProfile.vramPerInstanceGB;
                    dominantProfile = foundProfile;
                }
            }
        }

        let serverCalculatedMaxClients = dominantProfile.defaultMaxClients; // Start with profile's default max clients

        if (providerDetails.vram_gb && typeof providerDetails.vram_gb === 'number' && providerDetails.vram_gb > 0) {
            const vramBasedMaxClients = Math.floor(providerDetails.vram_gb / maxVramPerInstance);
            serverCalculatedMaxClients = Math.max(1, vramBasedMaxClients); // Ensure at least 1 if VRAM is very low but positive
            console.log(`[AndyModel] Provider ${providerDetails.ip} VRAM ${providerDetails.vram_gb}GB, dominant model VRAM/instance ${maxVramPerInstance}GB. VRAM-based max clients: ${serverCalculatedMaxClients}`);
        } else {
            console.log(`[AndyModel] Provider ${providerDetails.ip} did not specify VRAM. Using default max_clients from dominant model profile (${dominantProfile.defaultMaxClients}).`);
        }

        let finalMaxClients;
        if (providerDetails.max_clients && typeof providerDetails.max_clients === 'number' && providerDetails.max_clients > 0) {
            finalMaxClients = Math.min(providerDetails.max_clients, serverCalculatedMaxClients);
            finalMaxClients = Math.max(1, finalMaxClients); // Ensure it's at least 1
            console.log(`[AndyModel] Provider ${providerDetails.ip} suggested max_clients ${providerDetails.max_clients}. Server calculated cap ${serverCalculatedMaxClients}. Final max_clients: ${finalMaxClients}`);
        } else {
            finalMaxClients = Math.max(1, serverCalculatedMaxClients); // Ensure it's at least 1
            console.log(`[AndyModel] Provider ${providerDetails.ip} did not suggest max_clients. Server calculated ${serverCalculatedMaxClients}. Final max_clients: ${finalMaxClients}`);
        }

        if (existingProvider) {
            existingProvider.models = providerDetails.models;
            existingProvider.max_clients = finalMaxClients; // Use auto-balanced value
            existingProvider.avg_tps = providerDetails.avg_tps !== undefined ? providerDetails.avg_tps : existingProvider.avg_tps;
            existingProvider.vram_gb = providerDetails.vram_gb; // Store VRAM info
            existingProvider.gpu_info = providerDetails.gpu_info; // Store GPU info
            existingProvider.failureCount = 0;
            existingProvider.lastFailedTimestamp = null;
            existingProvider.isSuspect = false;
            existingProvider.suspectCooldownUntil = null;
            console.log(`[AndyModel] Updated compute provider: ${providerDetails.ip}, Max Clients: ${finalMaxClients}`);
        } else {
            this.computeProviders.push({
                ...providerDetails, // ip, models, (optional: avg_tps, vram_gb, gpu_info)
                max_clients: finalMaxClients, // Use auto-balanced value
                current_load: 0,
                failureCount: 0,
                lastFailedTimestamp: null,
                isSuspect: false,
                suspectCooldownUntil: null,
                avg_tps: providerDetails.avg_tps !== undefined ? providerDetails.avg_tps : 0,
            });
            console.log(`[AndyModel] Added new compute provider: ${providerDetails.ip} with models: ${providerDetails.models.map(m=>m.name).join(', ')}, Max Clients: ${finalMaxClients}`);
        }
        return true;
    }

    updateProviderStats(ip, stats) {
        const provider = this.computeProviders.find(p => p.ip === ip);
        if (provider) {
            if (stats.avg_tps !== undefined && typeof stats.avg_tps === 'number' && stats.avg_tps >= 0) {
                provider.avg_tps = stats.avg_tps;
            }
            console.log(`[AndyModel] Updated stats for provider ${ip}: TPS = ${provider.avg_tps}`);
            return true;
        } else {
            console.warn(`[AndyModel] Attempted to update stats for unknown provider: ${ip}`);
            return false;
        }
    }
}

export default AndyModel;

// Example of how this might be integrated into the main server/router:
// app.post('/completions', async (req, res) => {
//     const { model, prompt, ...otherParams } = req.body; // model here might be "andy/micro"
//
//     if (model && model.startsWith('andy/')) {
//         const andyModelName = model.substring('andy/'.length); // e.g., "micro"
//         const andyHandler = new AndyModel(process.env.ANDY_API_KEY_OR_CONFIG); // Initialize with necessary config
//
//         // Simulate adding a provider for testing
//         // In reality, this would come from /completions/join_pool
//         if (andyHandler.computeProviders.length === 0) {
//            andyHandler.addComputeProvider({
//              ip: "127.0.0.1:11434", // Example local Ollama
//              models: [{ name: "Andy-4-micro-0516", quantization: "Q8_0", context_length: 8192, release_date: "2024-05-16T00:00:00Z", id:"llama2" }],
//              max_clients: 4,
//              avg_tps: 50
//            });
//         }
//
//         try {
//             const result = await andyHandler.complete(prompt, { ...otherParams, modelIdentifier: andyModelName });
//             res.json(result);
//         } catch (error) {
//             console.error("Error processing andy model request:", error);
//             res.status(500).json({ error: "Failed to process request with andy model" });
//         }
//     } else {
//         // Handle other models or send error
//         res.status(400).json({ error: "Unsupported model specified" });
//     }
// });
//
// app.post('/completions/join_pool', (req, res) => {
//    const providerDetails = req.body;
//    // Assuming andyHandler is accessible here, e.g., a singleton or instantiated
//    // const andyHandler = getAndyHandlerInstance();
//    // For this example, let's assume it's newly instantiated or managed globally for simplicity
//    const andyHandler = new AndyModel(process.env.ANDY_API_KEY_OR_CONFIG); // This needs proper state management in a real app
//
//    const success = andyHandler.addComputeProvider(providerDetails);
//    if (success) {
//        res.status(200).json({ message: "Compute provider registered/updated successfully." });
//    } else {
//        res.status(400).json({ error: "Failed to register compute provider. Invalid details provided." });
//    }
// });
//
// app.post('/completions/provider_stats', (req, res) => { // Endpoint for providers to push their stats
//    const { ip, avg_tps } = req.body;
//    // const andyHandler = getAndyHandlerInstance();
//    const andyHandler = new AndyModel(process.env.ANDY_API_KEY_OR_CONFIG); // Again, state management
//    andyHandler.updateProviderStats(ip, { avg_tps });
//    res.status(200).json({ message: "Stats updated."});
// });
//

// Note: In a real application, the AndyModel instance managing computeProviders
// would need to be a singleton or managed in a way that its state is preserved
// across requests. The example integration above instantiates it per request for /completions
// or for /join_pool, which means providers added in /join_pool wouldn't be seen by /completions
// unless the AndyModel instance is shared. This is a simplification for this step.
// A proper implementation would use a shared instance, perhaps managed by the main application object.

// Also, the current implementation of `addComputeProvider` in the example integration
// for `/completions/join_pool` will always operate on a *new* AndyModel instance
// unless `andyHandler` is a singleton. This needs to be addressed in a real server.
// For now, the class itself supports the logic.

// This would typically be part of your server setup (e.g., in main.js or a dedicated models/index.js)
// For the purpose of this plan step, we are focusing on the AndyModel class itself.
// The actual server endpoint wiring will be handled later or is assumed to be done by the user.

// Example of how it might be registered or used in a hypothetical model loader:
// if (modelName.startsWith('andy/')) {
//   const alias = modelName.substring('andy/'.length);
//   if (!this.andyInstance) {
//      // IMPORTANT: This instance needs to be a singleton shared across requests
//      // that handle /completions and /completions/join_pool
//      this.andyInstance = new AndyModel(apiKey, this.options);
//      // TODO: Initialize with providers, perhaps from a persistent store or config
//      // For now, providers are added via addComputeProvider dynamically.
//   }
//   // The `complete` method of AndyModel would be called, passing the alias.
//   // The caller (e.g. Prompter class in this codebase) would need to pass the alias.
//   // Prompter.js might look like:
//   // if (this.model.startsWith('andy/')) {
//   //   const modelIdentifier = this.model.substring('andy/'.length);
//   //   return andyInstance.complete(prompt, { ...this.params, modelIdentifier });
//   // }
// }

console.log("AndyModel class defined. It includes methods for completing prompts and managing compute providers.");
