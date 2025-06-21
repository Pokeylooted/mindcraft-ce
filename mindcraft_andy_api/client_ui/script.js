document.addEventListener('DOMContentLoaded', () => {
    const ollamaApiUrlInput = document.getElementById('ollama-api-url');
    const fetchModelsBtn = document.getElementById('fetch-models-btn');
    const modelsListDiv = document.getElementById('models-list');
    const modelsStatusP = document.getElementById('models-status');
    const joinPoolBtn = document.getElementById('join-pool-btn');
    const joinStatusP = document.getElementById('join-status');
    const gpuInfoInput = document.getElementById('gpu-info');
    const vramInput = document.getElementById('vram-gb');
    const maxClientsInput = document.getElementById('max-clients');

    let availableModels = [];

    // --- Fetch Models from Local Ollama ---
    fetchModelsBtn.addEventListener('click', async () => {
        const baseUrl = ollamaApiUrlInput.value.trim();
        if (!baseUrl) {
            modelsStatusP.textContent = 'Please enter Ollama API URL.';
            modelsStatusP.style.color = 'red';
            return;
        }

        modelsStatusP.textContent = 'Fetching models...';
        modelsStatusP.style.color = 'blue';
        modelsListDiv.innerHTML = ''; // Clear previous list

        try {
            const response = await fetch(`${baseUrl}/api/tags`);
            if (!response.ok) {
                throw new Error(`Error fetching models: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            availableModels = data.models || [];

            if (availableModels.length > 0) {
                modelsStatusP.textContent = `Found ${availableModels.length} model(s). Select which to share.`;
                modelsStatusP.style.color = 'green';
                renderModelsList();
            } else {
                modelsStatusP.textContent = 'No models found at this endpoint.';
                modelsStatusP.style.color = 'orange';
            }
        } catch (error) {
            console.error('Error fetching Ollama models:', error);
            modelsStatusP.textContent = `Failed to fetch models: ${error.message}`;
            modelsStatusP.style.color = 'red';
            availableModels = [];
        }
    });

    function renderModelsList() {
        modelsListDiv.innerHTML = ''; // Clear previous items
        availableModels.forEach(model => {
            const modelDiv = document.createElement('div');
            modelDiv.classList.add('model-item');

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `model-${model.digest}`; // Use digest for a unique ID
            checkbox.value = model.name;
            checkbox.dataset.modelDetails = JSON.stringify(model); // Store full model details

            const label = document.createElement('label');
            label.htmlFor = checkbox.id;
            label.textContent = `${model.name} (Size: ${(model.size / 1e9).toFixed(2)} GB)`;

            modelDiv.appendChild(checkbox);
            modelDiv.appendChild(label);
            modelsListDiv.appendChild(modelDiv);
        });
    }

    // --- Join Mindcraft Pool ---
    joinPoolBtn.addEventListener('click', async () => {
        const selectedModels = [];
        const checkboxes = modelsListDiv.querySelectorAll('input[type="checkbox"]:checked');
        checkboxes.forEach(checkbox => {
            selectedModels.push(JSON.parse(checkbox.dataset.modelDetails));
        });

        if (selectedModels.length === 0) {
            joinStatusP.textContent = 'Please select at least one model to share.';
            joinStatusP.style.color = 'red';
            return;
        }

        const ollamaApiUrl = ollamaApiUrlInput.value.trim();
        if (!ollamaApiUrl) {
            joinStatusP.textContent = 'Ollama API URL is required to join the pool.';
            joinStatusP.style.color = 'red';
            return;
        }

        const payload = {
            ollama_base_url: ollamaApiUrl, // The client's local Ollama URL
            models: selectedModels.map(m => ({ // Send relevant details
                name: m.name,
                model: m.model,
                digest: m.digest,
                size: m.size,
                details: m.details,
                // Potentially add context length if available from /api/show later
            })),
            gpu_info: gpuInfoInput.value.trim() || null,
            vram_gb: vramInput.value ? parseInt(vramInput.value, 10) : null,
            max_clients: maxClientsInput.value ? parseInt(maxClientsInput.value, 10) : null,
        };

        joinStatusP.textContent = 'Attempting to join the pool...';
        joinStatusP.style.color = 'blue';

        try {
            // IMPORTANT: Replace with the actual Mindcraft API endpoint
            const mindcraftApiEndpoint = 'https://mindcraft.riqvip.dev/generations/join_pool';

            const response = await fetch(mindcraftApiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            const responseData = await response.json();

            if (response.ok) {
                joinStatusP.textContent = `Successfully joined the pool! Server response: ${responseData.message || 'Connected.'}`;
                joinStatusP.style.color = 'green';
                // Disable button or give other feedback
                joinPoolBtn.disabled = true;
                joinPoolBtn.textContent = 'Joined Pool';
            } else {
                throw new Error(responseData.error || `Server error: ${response.status}`);
            }
        } catch (error) {
            console.error('Error joining Mindcraft pool:', error);
            joinStatusP.textContent = `Failed to join pool: ${error.message}`;
            joinStatusP.style.color = 'red';
        }
    });

    // Initial state
    modelsStatusP.textContent = 'Enter your Ollama API URL and click "Fetch My Models".';
    joinStatusP.textContent = 'Select models and provide optional hardware info to join.';
});
