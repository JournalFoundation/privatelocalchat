// The provider list in Settings: what each provider is called, its endpoint, a hint on where to find the API key, and how to recognise which one an
// endpoint belongs to. Pure data and lookups, no DOM.

export const endpointOptions = [
  {
    id: 'choose',
    label: 'Select an endpoint…',
    baseUrl: '',
    hint:
      'Pick a provider from the list to auto-fill the API endpoint and see instructions for locating its API key. You can still paste any custom endpoint below. Requests use <code>/chat/completions</code> for the configured base URL.'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    hint:
      'Access GPT-4o and other OpenAI models. Sign in at <a href="https://platform.openai.com/" target="_blank" rel="noopener">platform.openai.com</a>, open <strong>View API keys</strong>, click <strong>Create new secret key</strong>, name it, and copy the value immediately (it appears only once). Full guide: <a href="https://platform.openai.com/docs/guides/developer-quickstart/api-keys" target="_blank" rel="noopener">OpenAI API keys</a>. Use this base URL; the client calls <code>/chat/completions</code> automatically.'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter — multi-model hub',
    baseUrl: 'https://openrouter.ai/api/v1',
    hint:
      'Aggregator of Anthropic, Mistral, Llama 3 and more. Log in at <a href="https://openrouter.ai/" target="_blank" rel="noopener">openrouter.ai</a>, open <strong>API Keys</strong>, click <strong>Create Key</strong>, optionally set a spend cap, and copy the secret (displayed once). Docs: <a href="https://openrouter.ai/docs/guides/getting-started#step-2-create-an-api-key" target="_blank" rel="noopener">OpenRouter setup</a>. Use this base URL; the client calls <code>/chat/completions</code> automatically.'
  },
  {
    id: 'vercel',
    label: 'Vercel AI Gateway',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    hint:
      'Proxy that fans out to Anthropic, Groq, Mistral, Perplexity and more. In the Vercel dashboard go to <strong>AI Gateway → API Keys</strong>, click <strong>Create key</strong>, name it, and copy the generated secret. Guide: <a href="https://vercel.com/docs/ai/ai-gateway/quickstart" target="_blank" rel="noopener">AI Gateway quickstart</a>. Use this base URL; the client calls <code>/chat/completions</code> automatically.'
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare AI Gateway',
    baseUrl: 'https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/compat',
    hint:
      'Routes to Gemini, Cohere, Perplexity and other providers. In the Cloudflare dashboard open <strong>AI → AI Gateway</strong>, choose your gateway, add upstream provider keys under <strong>Provider Keys</strong>, and optionally create an access token for the <code>cf-aig-authorization</code> header. Docs: <a href="https://developers.cloudflare.com/ai-gateway/get-started/" target="_blank" rel="noopener">Cloudflare AI Gateway</a>. Use this base URL; the client calls <code>/chat/completions</code> automatically.',
    detect: value => value.startsWith('https://gateway.ai.cloudflare.com/')
  },
  {
    id: 'anyscale',
    label: 'Anyscale Endpoints',
    baseUrl: 'https://api.endpoints.anyscale.com/v1',
    hint:
      'Hosted Mixtral and Llama family models. Sign in at <a href="https://www.anyscale.com/" target="_blank" rel="noopener">Anyscale</a>, open <strong>Endpoints → API keys</strong>, click <strong>Create</strong>, and copy the secret before closing the dialog. Reference: <a href="https://docs.anyscale.com/reference/endpoints/api-keys" target="_blank" rel="noopener">Anyscale API keys</a>. Use this base URL; the client calls <code>/chat/completions</code> automatically.'
  },
  {
    id: 'groq',
    label: 'Groq — low-latency inference',
    baseUrl: 'https://api.groq.com/openai/v1',
    hint:
      'Runs LLaMA and Mixtral models on Groq hardware. After logging in to <a href="https://console.groq.com/" target="_blank" rel="noopener">Groq Cloud</a>, open <strong>Developers → API Keys</strong>, click <strong>Create API Key</strong>, name it, and copy the secret. Docs: <a href="https://console.groq.com/docs/quickstart#generate-an-api-key" target="_blank" rel="noopener">Groq quickstart</a>. Use this base URL; the client calls <code>/chat/completions</code> automatically.'
  },
  {
    id: 'together',
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    hint:
      'Unified endpoint for Meta, Mistral, DeepSeek, Google and more. Sign in at <a href="https://api.together.xyz/" target="_blank" rel="noopener">api.together.xyz</a>, go to <strong>Settings → API Keys</strong>, click <strong>Create new API key</strong>, set a name or expiry, and copy the value. Docs: <a href="https://docs.together.ai/docs/getting-started#api-keys" target="_blank" rel="noopener">Together AI keys</a>. Use this base URL; the client calls <code>/chat/completions</code> automatically.'
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    hint:
      'Fireworks hosts Mixtral-based instruct models and other OSS LLMs. In the Fireworks dashboard open <strong>API Keys</strong>, click <strong>Create API key</strong>, and copy the token (store it securely). Tutorial: <a href="https://docs.fireworks.ai/fireworks-api/serverless-quickstart#get-an-api-key" target="_blank" rel="noopener">Fireworks quickstart</a>. Use this base URL; the client calls <code>/chat/completions</code> automatically.'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    hint:
      'Access DeepSeek’s reasoning models. Sign in to <a href="https://platform.deepseek.com/" target="_blank" rel="noopener">platform.deepseek.com</a>, open <strong>Access API → API Keys</strong>, click <strong>Create new API key</strong>, and copy it immediately. Guide: <a href="https://platform.deepseek.com/api-docs/tutorials/api_key" target="_blank" rel="noopener">DeepSeek API key steps</a>. Use this base URL; the client calls <code>/chat/completions</code> automatically.'
  },
  {
    id: 'hyperbolic',
    label: 'Hyperbolic',
    baseUrl: 'https://api.hyperbolic.xyz/v1',
    hint:
      'Scaled-down OSS models with OpenAI compatibility. Log in to the <a href="https://app.hyperbolic.xyz/" target="_blank" rel="noopener">Hyperbolic console</a>, open <strong>Settings → API Key</strong>, generate a token, and copy it for your requests. Docs: <a href="https://docs.hyperbolic.xyz/docs/api-reference/authentication" target="_blank" rel="noopener">Hyperbolic authentication</a>. The client calls <code>/chat/completions</code> automatically.'
  },
  {
    id: 'deepinfra',
    label: 'DeepInfra',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    hint:
      'Chat, completion, and embedding APIs for open-source LLMs. Generate an API key from the <a href="https://deepinfra.com/" target="_blank" rel="noopener">DeepInfra dashboard</a>, copy the value, and send it in the <code>Authorization</code> header. Docs: <a href="https://deepinfra.com/docs/getting-started" target="_blank" rel="noopener">DeepInfra getting started</a>. Use this base URL; the client calls <code>/chat/completions</code> automatically.'
  },
  {
    id: 'perplexity',
    label: 'Perplexity Sonar',
    baseUrl: 'https://api.perplexity.ai',
    hint:
      'Grounded web-search models with an OpenAI-style API. In your Perplexity account open <strong>Settings → API</strong>, click <strong>Generate API Key</strong>, and copy the secret (it is shown once). Docs: <a href="https://docs.perplexity.ai/docs/getting-started#generate-an-api-key" target="_blank" rel="noopener">Perplexity API setup</a>. Use this base URL; the client calls <code>/chat/completions</code> automatically.'
  },
  {
    id: 'huggingface-router',
    label: 'Hugging Face router',
    baseUrl: 'https://router.huggingface.co/v1',
    hint:
      'Route to providers like Novita, Groq or Together via the model name. Create or reuse a Hugging Face access token at <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener">huggingface.co/settings/tokens</a>, select <strong>New token → Read</strong>, and paste the token as your API key. Docs: <a href="https://huggingface.co/docs/api-inference/quicktour#get-your-api-token" target="_blank" rel="noopener">Hugging Face tokens</a>. Use this base URL; the client calls <code>/chat/completions</code> automatically.'
  },
  {
    id: 'huggingface-tgi',
    label: 'Hugging Face TGI (local)',
    baseUrl: 'http://localhost:8080/v1',
    hint:
      'Run <strong>text-generation-inference</strong> locally and point the client at this base URL. No API key is required when running on your own machine. Setup guide: <a href="https://huggingface.co/docs/text-generation-inference/en/basic_tutorials/openai_compatibility" target="_blank" rel="noopener">TGI OpenAI compatibility</a>. The client calls <code>/chat/completions</code> automatically.'
  },
  {
    id: 'lorax',
    label: 'LoRAX (local server)',
    baseUrl: 'http://127.0.0.1:8080/v1',
    hint:
      'LoRAX exposes an OpenAI-compatible endpoint on your workstation. Start the server and use any placeholder key if authentication is disabled. Reference: <a href="https://docs.predibase.com/docs/lorax" target="_blank" rel="noopener">LoRAX docs</a>. The client calls <code>/chat/completions</code> automatically.'
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (desktop)',
    baseUrl: 'http://localhost:1234/v1',
    hint:
      'LM Studio ships with an OpenAI-compatible API. Start the local server from the LM Studio interface and use this URL (the API key field can stay empty). Docs: <a href="https://lmstudio.ai/docs/api" target="_blank" rel="noopener">LM Studio API</a>. The client calls <code>/chat/completions</code> automatically.'
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    hint:
      'Ollama serves local LLaMA, Mistral and Phi models. No API key is required—any string will work—so you can leave the token blank. Docs: <a href="https://github.com/ollama/ollama/blob/main/docs/openai.md" target="_blank" rel="noopener">Ollama OpenAI API</a>. The client calls <code>/chat/completions</code> automatically.'
  },
  {
    id: 'runpod',
    label: 'RunPod vLLM worker',
    baseUrl: 'https://api.runpod.ai/v2/ENDPOINT_ID/openai/v1',
    hint:
      'Each RunPod worker exposes an OpenAI-compatible interface. Replace <code>ENDPOINT_ID</code> with your worker ID and use the API key from the RunPod dashboard. Guide: <a href="https://docs.runpod.io/docs/ai-endpoints" target="_blank" rel="noopener">RunPod AI endpoints</a>. Use this base URL; the client calls <code>/chat/completions</code> automatically.',
    detect: value => value.startsWith('https://api.runpod.ai/v2/')
  },
  {
    id: 'baseten',
    label: 'Baseten (model-specific URL)',
    baseUrl: 'https://{model_id}.api.baseten.co/environments/{environment}/content/v1',
    hint:
      'Deploy models with Engine Builder to receive an OpenAI-style endpoint. Use the format <code>https://{model_id}.api.baseten.co/environments/&lt;env&gt;/content/v1</code> and authenticate with a Baseten personal API key from <strong>Account → API keys</strong>. Docs: <a href="https://docs.baseten.co/docs/api-keys" target="_blank" rel="noopener">Baseten API keys</a>. Use this base URL; the client calls <code>/chat/completions</code> automatically.',
    detect: value => value.includes('.api.baseten.co')
  },
  {
    id: 'custom',
    label: 'Custom / self-hosted endpoint',
    baseUrl: '',
    hint:
      'Paste any OpenAI-compatible base URL, such as a corporate gateway or another local server. Remember to include the provider’s API key (if required). For payload details see the <a href="https://platform.openai.com/docs/api-reference/chat/create" target="_blank" rel="noopener">OpenAI chat API spec</a>. Changes save automatically as you edit. Requests use <code>/chat/completions</code> for this base URL.'
  }
];

export const escapeHtml = str =>
  (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function getEndpointOptionById(id) {
  return endpointOptions.find(option => option.id === id) || endpointOptions[0];
}

export function findEndpointOptionForValue(value) {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) {
    return getEndpointOptionById('choose');
  }
  const match = endpointOptions.find(option => {
    if (option.baseUrl) {
      const compare = option.baseUrl.toLowerCase();
      if (compare && normalized.startsWith(compare)) {
        return true;
      }
    }
    if (typeof option.detect === 'function') {
      try {
        if (option.detect(normalized)) {
          return true;
        }
      } catch (err) {
        console.warn('Endpoint detection failed for option', option.id, err);
      }
    }
    return false;
  });
  return match || getEndpointOptionById('custom');
}
