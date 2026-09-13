// Cloudflare Worker for Chat Messages KV Storage

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight request
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const url = new URL(request.url);
    const kv = env.firetech || env.KV;
    const key = url.searchParams.get('key') || 'messages';

    try {
      if (request.method === 'GET') {
        let value = null;
        if (kv) {
          value = await kv.get(key);
        }
        if (!value) {
          value = '[]';
        }
        return new Response(value, {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        });
      }

      if (request.method === 'POST') {
        const body = await request.json();
        let targetKey = key;
        let payload = body;

        if (body && typeof body === 'object' && body.key && body.value !== undefined) {
          targetKey = body.key;
          payload = body.value;
        }

        const valueString = typeof payload === 'string' ? payload : JSON.stringify(payload);

        if (kv) {
          await kv.put(targetKey, valueString);
        }

        return new Response(JSON.stringify({ success: true, key: targetKey, data: payload }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        });
      }

      if (request.method === 'DELETE') {
        if (kv) {
          await kv.delete(key);
        }
        return new Response(JSON.stringify({ success: true, deletedKey: key }), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        });
      }

      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }
  },
};
