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
      const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

      // Helper function to filter out items older than 24 hours
      function filterExpired(data) {
        if (!data) return data;
        let parsed = data;
        if (typeof data === 'string') {
          try {
            parsed = JSON.parse(data);
          } catch {
            return data;
          }
        }
        if (Array.isArray(parsed)) {
          const now = Date.now();
          const filtered = parsed.filter((item) => {
            if (!item) return false;
            let time = item.timestamp ? new Date(item.timestamp).getTime() : null;
            if (!time && item.id && !isNaN(Number(item.id.slice(0, 13)))) {
              time = Number(item.id.slice(0, 13));
            }
            if (!time) return true; // keep if timestamp missing
            return now - time < RETENTION_MS;
          });
          return typeof data === 'string' ? JSON.stringify(filtered) : filtered;
        }
        return data;
      }

      if (request.method === 'GET') {
        let value = null;
        if (kv) {
          value = await kv.get(key);
        }
        if (!value) {
          value = '[]';
        }

        // Filter expired items for array data (messages or signals)
        let filteredValue = filterExpired(value);
        if (typeof filteredValue !== 'string') {
          filteredValue = JSON.stringify(filteredValue);
        }

        return new Response(filteredValue, {
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

        // Filter expired items before saving
        const filteredPayload = filterExpired(payload);
        const valueString = typeof filteredPayload === 'string' ? filteredPayload : JSON.stringify(filteredPayload);

        if (kv) {
          await kv.put(targetKey, valueString, { expirationTtl: 86400 });
        }

        return new Response(JSON.stringify({ success: true, key: targetKey, data: filteredPayload }), {
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
