import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";
import OAuth from "oauth-1.0a";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Twitter API v2 endpoints
const TWITTER_API_BASE = "https://api.twitter.com";
const POST_TWEET_ENDPOINT = "/2/tweets";

// Gemini API endpoint
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

// OAuth 1.0a setup for Twitter
const oauth = new OAuth({
  consumer: {
    key: process.env.TWITTER_CONSUMER_KEY,
    secret: process.env.TWITTER_CONSUMER_KEY_SECRET
  },
  signature_method: 'HMAC-SHA1',
  hash_function(base_string, key) {
    return crypto
      .createHmac('sha1', key)
      .update(base_string)
      .digest('base64');
  }
});

// Route to generate tweet content using Gemini API
app.post("/generate-tweet", async (req, res) => {
  const { topic } = req.body;

  if (!topic) {
    return res.status(400).json({ error: "Topic is required" });
  }

  try {
    const response = await axios.post(GEMINI_API_URL, {
      contents: [
        {
          parts: [
            {
              text: `Write a short, engaging, and conversational tweet about: ${topic}. 
                     Keep it under 280 characters. Don't use hashtags unless specifically requested.
                     Make it sound natural and personal.`
            }
          ]
        }
      ]
    });

    const tweet = response.data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!tweet) {
      throw new Error("No tweet content generated");
    }

    const cleanTweet = tweet.replace(/^["']|["']$/g, '').trim();

    res.json({ tweet: cleanTweet });
  } catch (err) {
    console.error("Gemini API error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to generate tweet content" });
  }
});

// Route to post tweet to Twitter using OAuth 1.0a
app.post("/post-tweet", async (req, res) => {
  const { tweet } = req.body;

  if (!tweet) {
    return res.status(400).json({ error: "Tweet content is required" });
  }

  try {
    const request_data = {
      url: `${TWITTER_API_BASE}${POST_TWEET_ENDPOINT}`,
      method: 'POST',
    };

    const token = {
      key: process.env.TWITTER_ACCESS_TOKEN,
      secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
    };

    const headers = oauth.toHeader(oauth.authorize(request_data, token));
    headers['Content-Type'] = 'application/json';

 

    const response = await axios({
      url: request_data.url,
      method: request_data.method,
      headers: headers,
      data: { text: tweet }
    });

    const tweetId = response.data?.data?.id;
    const tweetUrl = tweetId
      ? `https://twitter.com/${process.env.TWITTER_USERNAME || "user"}/status/${tweetId}`
      : null;

    res.json({
      success: true,
      tweetId,
      tweetUrl
    });
  } catch (err) {
    console.error("❌ Twitter API error:", err.response?.data || err.message);

    res.status(500).json({
      error: "Failed to post tweet",
      details: err.response?.data || err.message
    });
  }
});

// Simple status endpoint
app.get("/status", (req, res) => {
  res.json({ status: "Online" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
   
});
