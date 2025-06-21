import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import AndyModel from '../models/andy.js'; // Adjusted path

// Replicate __dirname functionality for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.WEBSITE_PORT || 3000;

// Instantiate AndyModel for this web server
// This instance is separate from any instance that might be running in `main.js` or `mind_server.js`
const andyModelInstance = new AndyModel('dummyApiKeyForWebServer'); // API key might not be used by AndyModel's current features but good practice

// Middleware
app.use(express.json()); // For parsing application/json
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from 'public' directory

// --- API Endpoints ---

// Endpoint for compute providers to join the pool
app.post('/completions/join_pool', (req, res) => {
    const providerDetails = req.body;

    // Validation (adapted from join_pool_handler.js and API.md)
    if (!providerDetails || typeof providerDetails !== 'object') {
        return res.status(400).json({ error: "Invalid request body: expected JSON object." });
    }

    const { ip, models, max_clients, avg_tps, vram_gb, gpu_info } = providerDetails; // Added vram_gb, gpu_info

    if (!ip || typeof ip !== 'string' || ip.trim() === "") {
        return res.status(400).json({ error: "Missing or invalid 'ip' field. Must be a non-empty string." });
    }

    if (!models || !Array.isArray(models) || models.length === 0) {
        return res.status(400).json({ error: "Missing or invalid 'models' field: must be a non-empty array." });
    }

    if (models.length > 12) {
        return res.status(400).json({ error: "Too many models listed. Maximum is 12." });
    }

    for (let i = 0; i < models.length; i++) {
        const model = models[i];
        if (!model || typeof model !== 'object' ||
            !model.name || typeof model.name !== 'string' || model.name.trim() === "" ||
            !model.quantization || typeof model.quantization !== 'string' || model.quantization.trim() === "" ||
            !model.context_length || typeof model.context_length !== 'number' || model.context_length <=0 ||
            !model.release_date || typeof model.release_date !== 'string' || model.release_date.trim() === "" ||
            !model.id || typeof model.id !== 'string' || model.id.trim() === "") { // model.id is the Ollama model ID
            return res.status(400).json({
                error: `Invalid model entry at index ${i}. Each model must be an object with non-empty string fields: name, quantization, release_date, id; and a positive number field: context_length.`
            });
        }
        if (isNaN(new Date(model.release_date).getTime())) {
            return res.status(400).json({ error: `Invalid release_date format for model '${model.name}'. Please use ISO 8601 format (e.g., YYYY-MM-DDTHH:mm:ssZ).` });
        }
    }

    // Validate optional vram_gb and gpu_info
    if (vram_gb !== undefined && (typeof vram_gb !== 'number' || vram_gb <= 0)) {
        return res.status(400).json({ error: "Invalid 'vram_gb' field. Must be a positive number if provided." });
    }
    if (gpu_info !== undefined && typeof gpu_info !== 'string') {
        return res.status(400).json({ error: "Invalid 'gpu_info' field. Must be a string if provided." });
    }


    const processedProviderDetails = {
        ip: ip.trim(),
        models: models.map(m => ({
            name: m.name.trim(),
            quantization: m.quantization.trim(),
            context_length: m.context_length,
            release_date: m.release_date,
            id: m.id.trim(),
        })),
        // Let AndyModel handle default max_clients if not provided or invalid
        max_clients: (Number.isInteger(max_clients) && max_clients > 0) ? max_clients : undefined,
        avg_tps: (typeof avg_tps === 'number' && avg_tps >= 0) ? avg_tps : undefined, // Pass undefined if not provided for AndyModel to default
        vram_gb: vram_gb, // Pass along, AndyModel will check type
        gpu_info: gpu_info ? gpu_info.trim() : undefined // Pass along
    };

    try {
        const success = andyModelInstance.addComputeProvider(processedProviderDetails);
        if (success) {
            console.log(`[Web Server] Successfully registered/updated compute provider: ${processedProviderDetails.ip}`);
            res.status(200).json({ message: "Compute provider registered/updated successfully for web server pool." });
        } else {
            console.error(`[Web Server] Failed to register provider for IP: ${processedProviderDetails.ip}. AndyModel.addComputeProvider returned false.`);
            res.status(400).json({ error: "Failed to register compute provider. Ensure all model objects have a 'release_date' or check server logs." });
        }
    } catch (error) {
        console.error(`[Web Server] Error processing join_pool request for IP ${ip}:`, error);
        res.status(500).json({ error: "Internal server error while registering provider." });
    }
});

// Endpoint for providers to update their stats
app.post('/completions/provider_stats', (req, res) => {
    const { ip, avg_tps } = req.body;

    if (!ip || typeof ip !== 'string' || ip.trim() === "") {
        return res.status(400).json({ error: "Missing or invalid 'ip' field." });
    }
    if (avg_tps === undefined || typeof avg_tps !== 'number' || avg_tps < 0) {
        return res.status(400).json({ error: "Missing or invalid 'avg_tps' field. Must be a non-negative number." });
    }

    try {
        const success = andyModelInstance.updateProviderStats(ip.trim(), { avg_tps });
        if (success) {
            res.status(200).json({ message: "Provider stats updated successfully for web server pool." });
        } else {
            res.status(404).json({ error: `Provider with IP ${ip.trim()} not found in web server pool.` });
        }
    } catch (error) {
        console.error(`[Web Server] Error processing provider_stats request for IP ${ip}:`, error);
        res.status(500).json({ error: "Internal server error while updating provider stats." });
    }
});


// Endpoint to get list of providers for the frontend
app.get('/api/providers', (req, res) => {
    const providers = andyModelInstance.computeProviders.map(p => ({
        ip: p.ip,
        models: p.models,
        max_clients: p.max_clients,
        current_load: p.current_load, // Assuming AndyModel tracks this; it does.
        avg_tps: p.avg_tps
    }));
    res.json(providers);
});

// Endpoint to get list of all unique models for the frontend
app.get('/api/models', (req, res) => {
    const allModels = new Map(); // Using a Map to store unique models by a composite key

    andyModelInstance.computeProviders.forEach(provider => {
        provider.models.forEach(model => {
            // Create a unique key for each model variant (name + quantization + context_length + release_date)
            const modelKey = `${model.name}|${model.quantization}|${model.context_length}|${model.release_date}`;
            if (!allModels.has(modelKey)) {
                allModels.set(modelKey, {
                    name: model.name,
                    quantization: model.quantization,
                    context_length: model.context_length,
                    release_date: model.release_date,
                    // id: model.id, // The specific Ollama ID might not be needed for a general listing
                    providers: [provider.ip] // Store IPs of providers hosting this model variant
                });
            } else {
                allModels.get(modelKey).providers.push(provider.ip);
            }
        });
    });

    res.json(Array.from(allModels.values()));
});

// Serve index.html for the root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Mindcraft Web Server dashboard running on http://localhost:${PORT}`);
    console.log(`Serving static files from: ${path.join(__dirname, 'public')}`);
    console.log(`AndyModel instance created for this server. Providers need to register with this server's /completions/join_pool endpoint.`);
});

// Basic error handling
app.use((err, req, res, next) => {
    console.error("[Web Server] Unhandled error:", err.stack);
    res.status(500).send('Something broke!');
});
