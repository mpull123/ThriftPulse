const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateAIListings() {
  console.log("🤖 Starting AI Listing Assistant...");

  try {
    // Get items that don't have a description yet
    const { data: items } = await supabase
      .from('market_signals')
      .select('*')
      .is('ai_description', null);

    for (const item of items) {
      console.log(`✍️ Writing listing for: ${item.trend_name}`);

      const prompt = `You are a professional eBay reseller. Write a high-converting listing for: ${item.trend_name}.
      Context: The current market price is $${item.exit_price}. 
      The current hype level is ${item.heat_score}/100.
      
      Requirements:
      1. SEO-optimized Title (80 characters max).
      2. 3 bullet points highlighting why this item is trending.
      3. A professional, concise description including the suggested price.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4-turbo",
        messages: [{ role: "user", content: prompt }],
      });

      const response = completion.choices[0].message.content;

      await supabase
        .from('market_signals')
        .update({ ai_description: response })
        .eq('id', item.id);

      console.log(`✅ Listing generated for ${item.trend_name}`);
    }
  } catch (err) {
    console.error("❌ AI Error:", err.message);
  }
}

generateAIListings();