import { Handler } from '@netlify/functions';

interface TelegramMessage {
  message: string;
}

interface TelegramResponse {
  ok: boolean;
  result?: any;
  error_code?: number;
  description?: string;
}

const isOriginAllowed = (origin: string): boolean => {
  if (!origin) return true; // Direct server-to-server or same-origin requests where Origin header is absent
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();

    // Local development
    if (host === 'localhost' || host === '127.0.0.1') return true;

    // Production & Netlify deploy previews
    if (host === 'harypictures.netlify.app' || host.endsWith('.netlify.app')) return true;

    // Custom domain from environment variables if set
    if (process.env.URL) {
      try {
        const configuredUrl = new URL(process.env.URL);
        if (configuredUrl.hostname.toLowerCase() === host) return true;
      } catch {
        // Ignore invalid URL in env
      }
    }

    if (process.env.ALLOWED_ORIGINS) {
      const allowedList = process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim().toLowerCase());
      if (allowedList.includes(origin.toLowerCase()) || allowedList.includes(host)) return true;
    }

    return false;
  } catch {
    return false;
  }
};

const handler: Handler = async (event, context) => {
  const origin = event.headers['origin'] || event.headers['Origin'] || '';
  const originAllowed = isOriginAllowed(origin);
  const corsOriginHeader = originAllowed && origin ? origin : (origin ? 'null' : '*');

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': corsOriginHeader,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  // Common CORS headers
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': corsOriginHeader,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Reject unauthorized origins
  if (origin && !originAllowed) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Forbidden: origin not allowed' }),
    };
  }

  try {
    // Parse request body
    const body: TelegramMessage = JSON.parse(event.body || '{}');
    const message = body?.message;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Message is required' }),
      };
    }

    if (message.length > 4000) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Message exceeds maximum allowed length of 4000 characters' }),
      };
    }

    // Server-side environment variables
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const targetChatIds = (process.env.TELEGRAM_CHAT_IDS?.split(',') || [])
      .map((id) => id.trim())
      .filter(Boolean);

    if (!botToken) {
      console.error('TELEGRAM_BOT_TOKEN not configured in server environment');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Telegram bot token not configured' }),
      };
    }

    if (targetChatIds.length === 0) {
      console.error('No chat IDs configured in server environment');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No chat IDs configured' }),
      };
    }

    // Send message to configured chat IDs
    const results: { success: string[]; failed: { chatId: string; error: string }[] } = {
      success: [],
      failed: [],
    };

    for (const chatId of targetChatIds) {
      try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
          }),
        });

        const data: TelegramResponse = await response.json();

        if (data.ok) {
          results.success.push(chatId);
          console.log(`Message sent successfully to chat ${chatId}`);
        } else {
          results.failed.push({
            chatId,
            error: data.description || 'Unknown error',
          });
          console.error(`Failed to send message to chat ${chatId}:`, data.description);
        }
      } catch (error) {
        results.failed.push({
          chatId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        console.error(`Error sending message to chat ${chatId}:`, error);
      }
    }

    // Return results
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: results.success.length > 0,
        results,
        message: `Message sent to ${results.success.length} chat(s), failed for ${results.failed.length} chat(s)`,
      }),
    };
  } catch (error) {
    console.error('Error in sendTelegram function:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

export { handler };
