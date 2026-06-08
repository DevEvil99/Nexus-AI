const express = require('express');
const {
  HfInference
} = require('@huggingface/inference');
const bodyParser = require('body-parser');
const cors = require('cors');
const fetch = require('node-fetch');
const ftp = require('basic-ftp');
const {
  Readable
} = require('stream');
require("dotenv").config();
const OpenAI = require("openai");
const {
  env
} = require('process');
const fs = require('fs');
const WATERMARK_PATH = path.join(__dirname, 'img', 'watermark.png');

const app = express();
const PORT = 5500;


const allowedOrigins = ['http://localhost', 'https://example.com'];


app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});


app.options('*', (req, res) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(200);
});


app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.XAI_API_KEY
});


const ftpConfig = {
  host: '',
  user: '',
  password: '',
  port: '',
  secure: true
};


const userConversations = {};


app.post('/chat', async (req, res) => {
  const {
    userMessage,
    userId
  } = req.body;


  if (!userMessage || !userId) {
    return res.status(400).json({
      error: 'No user message or user ID provided'
    });
  }


  if (!userConversations[userId]) {
    userConversations[userId] = [{
      role: "system",
      content: `You are an AI assistant that helps users with their needs and questions` // A system prompt and instructions for the AI
    }];
  }

  const conversationHistory = userConversations[userId];

  try {
    let botResponse = '';


    conversationHistory.push({
      role: 'user',
      content: userMessage
    });


    const lowerCaseMessage = userMessage.toLowerCase();

    // Image Generation
    if (lowerCaseMessage.startsWith('create an image') || lowerCaseMessage.startsWith('imagine') || lowerCaseMessage.startsWith('generate an image')) {
      const prompt = userMessage.replace(/create an image|imagine|generate an image/i, '').trim();
      const imageUrl = await generateImage(prompt, userId);


      botResponse = imageUrl ? `<img class="ai-image" src="${imageUrl}" alt="Generated Image" />` : `Oops! Something went wrong. Please try again, and if the issue persists.`;
    }
    // Reasoning, You can change the way it works and triggers, this is just how it works
    else if (lowerCaseMessage.startsWith('reason')) {

      const chatCompletion = await openai.chat.completions.create({
        model: "o3-mini",
        messages: conversationHistory,
        reasoning_effort: "low"
      });

      botResponse += chatCompletion.choices[0].message.content || '';

      conversationHistory.push({
        role: 'assistant',
        content: botResponse
      });
    }
    // Chatting
    else {

      const chatCompletion = await openai.chat.completions.create({
        model: "gpt-5",
        messages: conversationHistory,
        temperature: 1,
        max_completion_tokens: 2048,
        reasoning_effort: "low"
      });

      botResponse += chatCompletion.choices[0].message.content || '';
    }


    conversationHistory.push({
      role: 'assistant',
      content: botResponse
    });


    res.json({
      botResponse
    });
  } catch (error) {
    console.error('Error communicating with API:', error);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});


async function generateImage(prompt, userId) {
  const controller = new AbortController();
  
  const timeout = setTimeout(() => {
    controller.abort();
  }, 600000);

  try {

    if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
      throw new Error("Invalid or empty prompt provided.");
    }

    if (!process.env.HUGGING_FACE_API_KEY) {
      throw new Error("HUGGING_FACE_API_KEY is missing in .env file");
    }

    console.log("Generating image...");

    const response = await fetch(
      "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGING_FACE_API_KEY}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            num_inference_steps: 5,
          },
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const imageBlob = await response.blob();

    clearTimeout(timeout);

    console.log("Image generated successfully");

    const arrayBuffer = await imageBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let watermarkImage;

    try {
      watermarkImage = fs.readFileSync(WATERMARK_PATH);
    } catch (err) {
      throw new Error(`Failed to load watermark image from ${WATERMARK_PATH}: ${err.message}`);
    }

    const watermarkedImage = await sharp(buffer)
      .composite([
        {
          input: watermarkImage,
          gravity: "northwest",
          blend: "over",
        },
      ])
      .png()
      .toBuffer();

    const safePrompt = prompt
      .replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 50);

    const imageName = `${userId}-${Date.now()}-${safePrompt}.png`;

    const ftpClient = new ftp.Client();

    try {
      await ftpClient.access(ftpConfig);

      const readableStream = new Readable();
      readableStream.push(watermarkedImage);
      readableStream.push(null);

      await ftpClient.uploadFrom(readableStream, imageName);

      console.log("FTP upload successful");
    } catch (err) {
      throw new Error(`FTP upload failed: ${err.message}`);
    } finally {
      ftpClient.close();
    }

    // Change "[your_domain]" to the domain of your FTP where images are hosted on
    return `https://[your_domain]/${imageName}`;

  } catch (error) {
    clearTimeout(timeout);

    if (error.name === "AbortError") {
      console.error("Image generation timed out");
      return null;
    }

    console.error("Error generating image with watermark:", {
      message: error.message,
      cause: error.cause,
      stack: error.stack,
      prompt,
      userId,
    });

    return null;
  }
}
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
