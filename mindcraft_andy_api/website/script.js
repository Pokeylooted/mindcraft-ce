document.addEventListener('DOMContentLoaded', () => {
    const modelsGrid = document.getElementById('models-grid');
    const loadingModelsP = document.getElementById('loading-models');

    async function fetchAndDisplayModels() {
        try {
            // This endpoint needs to be implemented on the server_api
            const response = await fetch('https://mindcraft.riqvip.dev/api/models');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const models = await response.json();

            if (loadingModelsP) {
                loadingModelsP.style.display = 'none';
            }

            if (models && models.length > 0) {
                modelsGrid.innerHTML = ''; // Clear loading message
                models.forEach(model => {
                    const card = document.createElement('div');
                    card.classList.add('model-card');

                    let detailsHtml = '';
                    if (model.details && typeof model.details === 'object') {
                        if (model.details.family) {
                            detailsHtml += `<p><strong>Family:</strong> ${model.details.family}</p>`;
                        }
                        if (model.details.parameter_size) {
                            detailsHtml += `<p><strong>Params:</strong> ${model.details.parameter_size}</p>`;
                        }
                        if (model.details.quantization_level) {
                            detailsHtml += `<p><strong>Quantization:</strong> ${model.details.quantization_level}</p>`;
                        }
                    } else if (typeof model.details === 'string' && model.details.trim() !== '') {
                        // If details is just a string, display it directly.
                        detailsHtml += `<p><strong>Details:</strong> ${model.details}</p>`;
                    }

                    if(model.providers_available) {
                        detailsHtml += `<p><strong>Providers:</strong> ${model.providers_available} available</p>`;
                    }


                    card.innerHTML = `
                        <h3>${model.name}</h3>
                        ${detailsHtml}
                        <p>Use this model name in your API requests.</p>
                    `;
                    modelsGrid.appendChild(card);
                });
            } else {
                modelsGrid.innerHTML = '<p>No community models currently available. Check back soon!</p>';
            }
        } catch (error) {
            console.error('Failed to fetch models:', error);
            if (loadingModelsP) {
                loadingModelsP.textContent = 'Failed to load models. Please try again later.';
                loadingModelsP.style.color = 'red';
            } else {
                modelsGrid.innerHTML = '<p>Failed to load models. Please try again later.</p>';
            }
        }
    }

    if (modelsGrid) {
        fetchAndDisplayModels();
        // Optionally, refresh the list periodically
        // setInterval(fetchAndDisplayModels, 30000); // Refresh every 30 seconds
    }
});
