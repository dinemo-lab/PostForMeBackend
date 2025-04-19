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

// Rate limit tracking (simple implementation for free tier - 17 tweets/24hr)
let tweetCount = 0;
let lastResetTime = Date.now();
const TWEET_LIMIT = 17;
const RESET_PERIOD = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Function to check and update rate limits
const checkRateLimit = () => {
  // Reset counter if 24 hours have passed
  if (Date.now() - lastResetTime > RESET_PERIOD) {
    tweetCount = 0;
    lastResetTime = Date.now();
    return { allowed: true, remaining: TWEET_LIMIT };
  }
  
  // Check if limit reached
  if (tweetCount >= TWEET_LIMIT) {
    return { allowed: false, remaining: 0 };
  }
  
  return { allowed: true, remaining: TWEET_LIMIT - tweetCount };
};

// Language-specific prompts
const getPromptByLanguage = (topic, language = 'english') => {
  const prompts = {
    english: `Write a short, engaging tweet about: ${topic}.
Keep it under 280 characters. Make it sound natural and personal, like something someone would actually post.
Try to include a relatable insight, surprising idea, clever twist, or emotional hook.
Avoid hashtags unless explicitly requested.`,
    
    hindi: `${topic} के बारे में एक छोटा और आकर्षक ट्वीट हिंदी में लिखें।
इसे 280 अक्षरों से कम रखें। इसे स्वाभाविक और व्यक्तिगत बनाएं, जैसे कोई वास्तव में पोस्ट करेगा।
इसमें एक संबंधित अंतर्दृष्टि, आश्चर्यजनक विचार, चतुर मोड़, या भावनात्मक आकर्षण शामिल करने का प्रयास करें।
विशेष रूप से अनुरोध किए जाने पर ही हैशटैग का उपयोग करें।`,
    
    hinglish: `${topic} ke baare mein ek short, engaging tweet Hinglish mein likhiye.
280 characters se kam rakhein. Natural aur personal sound karna chahiye, jaisa koi actually post karega.
Try to include relatable insight, surprising idea, clever twist, ya emotional hook.
Hashtags avoid karein jab tak specifically requested na ho.`
  };
  
  return prompts[language] || prompts.english;
};

// Thread-specific prompts
const getThreadPromptByLanguage = (topic, partCount, language = 'english') => {
  const prompts = {
    english: `Write part ${partCount} of a Twitter thread about: ${topic}.
Keep it under 280 characters. Make it sound natural and conversational, like one part of a cohesive thread.
Ensure this part flows well if it's not the first tweet. Create a natural continuation or development of ideas.`,
    
    hindi: `${topic} के बारे में एक ट्विटर थ्रेड का भाग ${partCount} हिंदी में लिखें।
इसे 280 अक्षरों से कम रखें। इसे स्वाभाविक और वार्तालाप जैसा बनाएं, जैसे एक सुसंगत थ्रेड का एक हिस्सा हो।
सुनिश्चित करें कि यदि यह पहला ट्वीट नहीं है तो यह भाग अच्छी तरह से प्रवाहित होता है। विचारों का एक प्राकृतिक निरंतरता या विकास बनाएं।`,
    
    hinglish: `${topic} ke baare mein ek Twitter thread ka part ${partCount} Hinglish mein likhiye.
280 characters se kam rakhein. Natural aur conversational sound karna chahiye, jaise cohesive thread ka ek hissa ho.
Ensure kare ki agar ye first tweet nahi hai to ye part achhe se flow kare. Ideas ka natural continuation ya development create karein.`
  };
  
  return prompts[language] || prompts.english;
};

// Route to generate tweet content using Gemini API
app.post("/generate-tweet", async (req, res) => {
  const { topic, language = "english" } = req.body;

  if (!topic) {
    return res.status(400).json({ error: "Topic is required" });
  }

  try {
    const prompt = getPromptByLanguage(topic, language);
    
    const response = await axios.post(GEMINI_API_URL, {
      contents: [
        {
          parts: [
            {
              text: prompt
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

// Route to generate thread tweets
app.post("/generate-thread", async (req, res) => {
  const { topic, partCount = 3, language = "english" } = req.body;

  if (!topic) {
    return res.status(400).json({ error: "Topic is required" });
  }

  try {
    const threadTweets = [];
    
    // Generate specified number of tweets for the thread
    for (let i = 1; i <= partCount; i++) {
      const prompt = getThreadPromptByLanguage(topic, i, language);
      
      const response = await axios.post(GEMINI_API_URL, {
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ]
      });

      const tweet = response.data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!tweet) {
        throw new Error(`No content generated for thread part ${i}`);
      }

      const cleanTweet = tweet.replace(/^["']|["']$/g, '').trim();
      threadTweets.push(cleanTweet);
    }

    res.json({ tweets: threadTweets });
  } catch (err) {
    console.error("Gemini API error for thread:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to generate thread content" });
  }
});

// Route to post tweet to Twitter using OAuth 1.0a
app.post("/post-tweet", async (req, res) => {
  const { tweet } = req.body;

  if (!tweet) {
    return res.status(400).json({ error: "Tweet content is required" });
  }

  // Check rate limit
  const rateLimit = checkRateLimit();
  if (!rateLimit.allowed) {
    return res.status(429).json({
      error: "Rate limit exceeded",
      details: "You have reached your limit of 17 tweets per 24 hours.",
      resetTime: new Date(lastResetTime + RESET_PERIOD).toISOString()
    });
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

    // Increment tweet count after successful posting
    tweetCount++;

    const tweetId = response.data?.data?.id;
    const tweetUrl = tweetId
      ? `https://twitter.com/${process.env.TWITTER_USERNAME || "user"}/status/${tweetId}`
      : null;

    res.json({
      success: true,
      tweetId,
      tweetUrl,
      rateLimit: {
        remaining: TWEET_LIMIT - tweetCount,
        resetTime: new Date(lastResetTime + RESET_PERIOD).toISOString()
      }
    });
  } catch (err) {
    console.error("❌ Twitter API error:", err.response?.data || err.message);

    res.status(500).json({
      error: "Failed to post tweet",
      details: err.response?.data || err.message
    });
  }
});

// Route to post a thread to Twitter
app.post("/post-thread", async (req, res) => {
  const { tweets } = req.body;

  if (!tweets || !Array.isArray(tweets) || tweets.length === 0) {
    return res.status(400).json({ error: "Valid tweets array is required" });
  }

  // Check if we have enough rate limit left
  const rateLimit = checkRateLimit();
  if (!rateLimit.allowed || rateLimit.remaining < tweets.length) {
    return res.status(429).json({
      error: "Rate limit exceeded",
      details: `You have only ${rateLimit.remaining} tweets left out of your 17 tweets per 24 hours, but trying to post ${tweets.length} tweets.`,
      resetTime: new Date(lastResetTime + RESET_PERIOD).toISOString()
    });
  }

  try {
    const threadResults = [];
    let prevTweetId = null;

    // Post each tweet in the thread
    for (const tweetText of tweets) {
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

      // If this isn't the first tweet, reply to previous one
      const tweetData = prevTweetId 
        ? { text: tweetText, reply: { in_reply_to_tweet_id: prevTweetId } }
        : { text: tweetText };

      const response = await axios({
        url: request_data.url,
        method: request_data.method,
        headers: headers,
        data: tweetData
      });

      // Get the tweet ID for the next reply
      const tweetId = response.data?.data?.id;
      prevTweetId = tweetId;
      
      // Increment tweet count after successful posting
      tweetCount++;

      const tweetUrl = tweetId
        ? `https://twitter.com/${process.env.TWITTER_USERNAME || "user"}/status/${tweetId}`
        : null;

      threadResults.push({
        tweetId,
        tweetUrl,
        text: tweetText
      });
    }

    res.json({
      success: true,
      threadResults,
      rateLimit: {
        remaining: TWEET_LIMIT - tweetCount,
        resetTime: new Date(lastResetTime + RESET_PERIOD).toISOString()
      }
    });
  } catch (err) {
    console.error("❌ Twitter thread posting error:", err.response?.data || err.message);

    res.status(500).json({
      error: "Failed to post thread",
      details: err.response?.data || err.message
    });
  }
});

// Get remaining tweet limit
app.get("/rate-limit", (req, res) => {
  const rateLimit = checkRateLimit();
  res.json({
    remaining: rateLimit.remaining,
    resetTime: new Date(lastResetTime + RESET_PERIOD).toISOString()
  });
});

// Simple status endpoint
app.get("/status", (req, res) => {
  res.json({ status: "Online" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});