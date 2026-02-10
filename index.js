const axios = require('axios');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const OAuth = require('oauth-1.0a');
const crypto = require('crypto');

// Initialize AWS services (reused across warm Lambda invocations)
const dynamoClient = new DynamoDBClient();
const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);
const secretsManager = new SecretsManagerClient();

const { PERSONA } = require('./persona');

// Define main themes with descriptions and their sub-themes.
// You can have as many as you want, but keep it reasonable for the bot's focus.
const THEMES = {
  "Theme1": {
    description: "describe Theme1 content here.",
    subThemes: ["Subtheme1", "Subtheme2", "Subtheme3", "Subtheme4", "Subtheme5"]
  },
  "Theme2": {
    description: "describe Theme2 content here.",
    subThemes: ["Subtheme6", "Subtheme7", "Subtheme8", "Subtheme9", "Subtheme10"]
  },
  "Theme3": {
    description: "describe Theme3 content here.",
    subThemes: ["Subtheme11", "Subtheme12", "Subtheme13", "Subtheme14", "Subtheme15"]
  },
  "Theme4": {
    description: "describe Theme4 content here.",
    subThemes: ["Subtheme16", "Subtheme17", "Subtheme18", "Subtheme19", "Subtheme20"]
  },
  "Theme5": {
    description: "describe Theme5 content here.",
    subThemes: ["Subtheme21", "Subtheme22", "Subtheme23", "Subtheme24", "Subtheme25"]
  }
};

// Tracking state across executions
const STATE_TABLE = process.env.STATE_TABLE || 'ThreadBotState';
const SAMPLE_THREADS_TABLE = process.env.SAMPLE_THREADS_TABLE || 'ThreadBotSampleThreads';

// Configuration
const TWEETS_PER_THREAD = 4;       // Number of tweets in each thread
const THREADS_PER_SUBTHEME = 3;    // Threads to post per subtheme before advancing
const THREADS_PER_EXECUTION = 1;   // Threads to post per Lambda invocation
const TOTAL_THREADS_PER_DAY = 5;   // ~5 executions per day at rate(5 hours)

exports.handler = async (event) => {
  try {
    // Get the current posting state
    const state = await getCurrentState();

    // Log cycle progress for monitoring
    const progress = getCycleProgress(state);
    console.log(`Cycle Progress: ${progress.progressPercentage}% (${progress.completedSubThemes}/${progress.totalSubThemes} sub-themes)`);
    console.log(`Current: ${progress.currentPosition} (${progress.threadsInCurrentSubTheme}/${THREADS_PER_SUBTHEME} threads)`);
    console.log(`Full cycle takes ~${progress.cycleDays} days`);

    // Get sample threads from DynamoDB
    const sampleThreads = await getSampleThreads();

    // Get API credentials
    const credentials = await getCredentials();

    // Determine which theme and subtheme to use
    const { mainTheme, subTheme, currentSubThemeCount } = state;

    console.log(`Generating thread for theme: ${mainTheme} - ${subTheme}`);
    console.log(`Threads posted today: ${state.threadsPostedToday}, Current subtheme count: ${currentSubThemeCount}`);

    // Only generate as many threads as needed to complete the current subtheme
    const threadsToGenerate = Math.min(THREADS_PER_EXECUTION, THREADS_PER_SUBTHEME - currentSubThemeCount);

    // Filter sample threads for the current subtheme
    const relevantSamples = sampleThreads.filter(thread =>
      thread.toLowerCase().includes(`#${subTheme.toLowerCase()}`)
    );

    console.log(`Found ${relevantSamples.length} relevant sample threads for ${subTheme}`);

    // Reset daily counter if it's a new day
    const today = new Date().toDateString();
    if (today !== state.currentDay) {
      state.threadsPostedToday = 0;
      state.currentDay = today;
    }

    // Generate and post threads
    const postedThreads = [];
    for (let t = 0; t < threadsToGenerate; t++) {
      // Generate a thread (array of connected tweets)
      const thread = await generateThread(
        mainTheme,
        subTheme,
        THEMES[mainTheme].description,
        relevantSamples,
        credentials.ai_provider_api_key
      );

      console.log(`Generated thread with ${thread.length} tweets`);

      // Post the thread as a chain of replies
      const tweetIds = await postThread(
        thread,
        credentials.twitter_api_key,
        credentials.twitter_api_secret,
        credentials.twitter_access_token,
        credentials.twitter_access_token_secret
      );

      postedThreads.push({ tweets: thread, tweetIds });

      // Save progress after each successfully posted thread
      state.currentSubThemeCount += 1;
      state.threadsPostedToday += 1;
      await updateState(state);
    }

    // Advance to next subtheme if current one is complete
    const newState = calculateNextState(state);
    await updateState(newState);

    // Log the new state for monitoring
    const newProgress = getCycleProgress(newState);
    console.log(`Updated to: ${newProgress.currentPosition}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Successfully posted ${postedThreads.length} thread(s) for theme: ${mainTheme} - ${subTheme}`,
        theme: `${mainTheme} - ${subTheme}`,
        threads: postedThreads,
        newState,
        progress: newProgress
      }),
    };
  } catch (error) {
    console.error('Error in Lambda function:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error processing thread posting task',
        error: error.message,
      }),
    };
  }
};

// Get current state from DynamoDB
async function getCurrentState() {
  const result = await dynamoDB.send(new GetCommand({
    TableName: STATE_TABLE,
    Key: { id: 'current_state' }
  }));

  if (result.Item) {
    return result.Item;
  }

  // If no state exists, initialize with default values
  const initialState = initializeState();
  await updateState(initialState);
  return initialState;
}

// Initialize state with default values
function initializeState() {
  const mainThemes = Object.keys(THEMES);
  const firstMainTheme = mainThemes[0];

  return {
    mainTheme: firstMainTheme,
    subTheme: THEMES[firstMainTheme].subThemes[0],
    threadsPostedToday: 0,
    currentSubThemeCount: 0,
    lastUpdated: new Date().toISOString(),
    currentDay: new Date().toDateString()
  };
}

// Update state in DynamoDB
async function updateState(state) {
  await dynamoDB.send(new PutCommand({
    TableName: STATE_TABLE,
    Item: {
      id: 'current_state',
      ...state,
      lastUpdated: new Date().toISOString()
    }
  }));
}

// Advance to next subtheme if current one is complete, otherwise return current state
function calculateNextState(currentState) {
  if (currentState.currentSubThemeCount < THREADS_PER_SUBTHEME) {
    return currentState;
  }

  const { mainTheme, subTheme } = currentState;
  const mainThemes = Object.keys(THEMES);
  const currentMainThemeIndex = mainThemes.indexOf(mainTheme);
  const currentSubThemes = THEMES[mainTheme].subThemes;
  const currentSubThemeIndex = currentSubThemes.indexOf(subTheme);

  // Move to the next subtheme within the same main theme
  if (currentSubThemeIndex + 1 < currentSubThemes.length) {
    return {
      ...currentState,
      subTheme: currentSubThemes[currentSubThemeIndex + 1],
      currentSubThemeCount: 0
    };
  }

  // Move to the next main theme (wraps around)
  const nextMainThemeIndex = (currentMainThemeIndex + 1) % mainThemes.length;
  const nextMainTheme = mainThemes[nextMainThemeIndex];

  return {
    ...currentState,
    mainTheme: nextMainTheme,
    subTheme: THEMES[nextMainTheme].subThemes[0],
    currentSubThemeCount: 0
  };
}

// Get cycle progress for monitoring
function getCycleProgress(currentState) {
  const mainThemes = Object.keys(THEMES);
  const currentMainThemeIndex = mainThemes.indexOf(currentState.mainTheme);
  const currentSubThemeIndex = THEMES[currentState.mainTheme].subThemes.indexOf(currentState.subTheme);

  // Calculate totals dynamically (works with any number of subthemes per theme)
  let completedSubThemes = 0;
  for (let i = 0; i < currentMainThemeIndex; i++) {
    completedSubThemes += THEMES[mainThemes[i]].subThemes.length;
  }
  completedSubThemes += currentSubThemeIndex;

  const totalSubThemes = mainThemes.reduce((sum, theme) => sum + THEMES[theme].subThemes.length, 0);
  const progressPercentage = Math.round((completedSubThemes / totalSubThemes) * 100);

  return {
    currentPosition: `${currentState.mainTheme} -> ${currentState.subTheme}`,
    completedSubThemes: completedSubThemes,
    totalSubThemes: totalSubThemes,
    progressPercentage: progressPercentage,
    threadsInCurrentSubTheme: currentState.currentSubThemeCount,
    cycleDays: Math.ceil(totalSubThemes * THREADS_PER_SUBTHEME / TOTAL_THREADS_PER_DAY)
  };
}

// Get sample threads from DynamoDB
async function getSampleThreads() {
  try {
    const result = await dynamoDB.send(new ScanCommand({
      TableName: SAMPLE_THREADS_TABLE
    }));

    return result.Items.map(item => item.text);
  } catch (error) {
    console.error('Error getting sample threads:', error);
    return [];
  }
}

// Get API credentials from Secrets Manager
async function getCredentials() {
  const result = await secretsManager.send(new GetSecretValueCommand({
    SecretId: process.env.SECRET_NAME,
  }));

  return JSON.parse(result.SecretString);
}

// Generate a thread (array of connected tweets) using AI
async function generateThread(mainTheme, subTheme, themeDescription, sampleThreads, apiKey) {
  const prompt = constructPrompt(mainTheme, subTheme, themeDescription, sampleThreads);

  try {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.8
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        }
      }
    );

    return extractThread(response.data.choices[0].message.content);
  } catch (error) {
    console.error('Error generating thread with AI:', error);
    throw error;
  }
}

// Construct the prompt for AI thread generation
function constructPrompt(mainTheme, subTheme, themeDescription, sampleThreads) {
  const sampleText = sampleThreads.length > 0
    ? `Here are some sample threads for reference:\n${sampleThreads.join('\n---\n')}`
    : 'No specific samples are available for this subtheme, but please follow the overall style patterns from the main theme.';

  return `
You are ${PERSONA.identity.name}, ${PERSONA.identity.role}. ${PERSONA.identity.approach}.

YOUR CHARACTER:
${PERSONA.character.strengths.map(s => `- ${s}`).join('\n')}

YOUR CORE BELIEFS:
${PERSONA.beliefs.map(b => `- ${b}`).join('\n')}

YOUR VOICE:
- Tone: ${PERSONA.voice.tone}
- Style: ${PERSONA.voice.style.join(', ')}
- Language: ${PERSONA.voice.language}

WHAT TO AVOID:
${PERSONA.avoids.map(a => `- ${a}`).join('\n')}

---

TASK: Generate a Twitter/X thread of ${TWEETS_PER_THREAD} connected tweets about the main theme "${mainTheme}" and specifically the sub-theme "${subTheme}".

CONTEXT:
- Main theme: ${mainTheme}
- Main theme description: ${themeDescription}
- Current sub-theme: ${subTheme}

${sampleText}

THREAD STRUCTURE:
- TWEET 1: Hook the reader. Bold opening statement or provocative question about #${subTheme}. Include the hashtag #${subTheme} here.
- TWEET 2: Expand on the idea. Provide depth, a story, or a surprising angle.
- TWEET 3: Challenge or shift perspective. Push the reader to think differently.
- TWEET 4: Close with impact. A memorable takeaway, call to reflection, or powerful conclusion.

CONTENT REQUIREMENTS:
- Each tweet must be 100-280 characters
- Only TWEET 1 includes the hashtag #${subTheme}
- NO additional hashtags
- NO emojis
- The thread must read as a connected narrative, not standalone tweets
- Each tweet should flow naturally from the previous one
- Embody persona's voice throughout

VARIATION REQUIREMENTS:
- Mix rhetorical techniques across the thread
- Build tension or insight progressively
- Make the reader want to keep reading the next tweet

Generate a thread that reflects persona's character—wise, direct, and quietly powerful.

OUTPUT FORMAT:
Return exactly ${TWEETS_PER_THREAD} tweets, each on a new line in this format:
TWEET 1: [first tweet with #${subTheme}]
TWEET 2: [second tweet]
TWEET 3: [third tweet]
TWEET 4: [fourth tweet]
  `;
}

// Extract thread tweets from AI response
function extractThread(response) {
  const lines = response.split('\n');
  const tweets = [];

  for (const line of lines) {
    const match = line.match(/^TWEET\s*\d+:\s*(.+)/);
    if (match) {
      const tweet = match[1].trim();
      if (tweet && tweet.length <= 280) {
        tweets.push(tweet);
      }
    }
  }

  return tweets;
}

// Post a thread as a chain of replies to Twitter/X
async function postThread(tweets, apiKey, apiSecret, accessToken, accessTokenSecret) {
  const tweetIds = [];
  let previousTweetId = null;

  for (let i = 0; i < tweets.length; i++) {
    const tweetData = { text: tweets[i] };

    // Chain tweets by replying to the previous one
    if (previousTweetId) {
      tweetData.reply = { in_reply_to_tweet_id: previousTweetId };
    }

    const result = await postTweet(
      tweetData,
      apiKey,
      apiSecret,
      accessToken,
      accessTokenSecret
    );

    previousTweetId = result.data.id;
    tweetIds.push(previousTweetId);
    console.log(`Posted tweet ${i + 1}/${tweets.length} (id: ${previousTweetId}): ${tweets[i]}`);

    // Short delay between thread tweets (skip after last)
    if (i < tweets.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  console.log(`Successfully posted thread of ${tweets.length} tweets`);
  return tweetIds;
}

// Post a single tweet to Twitter/X using OAuth 1.0a and return the response
async function postTweet(tweetData, apiKey, apiSecret, accessToken, accessTokenSecret) {
  const oauth = OAuth({
    consumer: {
      key: apiKey,
      secret: apiSecret
    },
    signature_method: 'HMAC-SHA1',
    hash_function(baseString, key) {
      return crypto
        .createHmac('sha1', key)
        .update(baseString)
        .digest('base64');
    }
  });

  const requestData = {
    url: 'https://api.twitter.com/2/tweets',
    method: 'POST'
  };

  const authHeader = oauth.toHeader(oauth.authorize(requestData, {
    key: accessToken,
    secret: accessTokenSecret
  }));

  const response = await axios({
    url: requestData.url,
    method: requestData.method,
    headers: {
      ...authHeader,
      'Content-Type': 'application/json'
    },
    data: tweetData
  });

  return response.data;
}
