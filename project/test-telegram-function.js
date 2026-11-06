// Test script for the Netlify Telegram function
// Manual integration only: this sends a real Telegram message.
// Use npm run check:security for automated tests with mocked delivery.
// Run with NETLIFY_DEV=true in Netlify Dev and: node test-telegram-function.js

const testMessage = `
🆕 *New Contact Form Submission* ────────────
👤 *Name:* Test User
✉️ *Email:* test@example.com
📞 *Phone:* +1234567890

🖼️ *Service:* Photography
📅 *Preferred Date:* Tomorrow

💬 *Message:*
This is a test message to verify the Telegram function is working correctly.

⏱️ *Submitted:* ${new Date().toLocaleString()}
───────────────────────────────
`.trim();

async function testTelegramFunction() {
  try {
    console.log('Testing Telegram function...');
    console.log('Message to send:', testMessage);
    
    const response = await fetch('http://localhost:8888/.netlify/functions/sendTelegram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:8888',
      },
      body: JSON.stringify({
        message: testMessage
      })
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));

    const data = await response.json();
    console.log('Response data:', JSON.stringify(data, null, 2));

    if (data.success) {
      console.log('✅ Test passed! Telegram function is working correctly.');
    } else {
      console.log('❌ Test failed. Check the response data above.');
    }
  } catch (error) {
    console.error('❌ Test error:', error.message);
    console.log('Make sure Netlify Dev is running: npx netlify dev');
  }
}

testTelegramFunction();
