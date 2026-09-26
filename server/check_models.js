// check-models.js
import 'dotenv/config';

async function listAvailableModels() {
    try {
        const response = await fetch('https://api.groq.com/openai/v1/models', {
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
            }
        });
        
        const data = await response.json();
        console.log('Available models:');
        data.data.forEach(model => {
            console.log(`- ${model.id} (${model.object})`);
        });
    } catch (error) {
        console.error('Error fetching models:', error.message);
    }
}

listAvailableModels();