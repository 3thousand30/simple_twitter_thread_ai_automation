# AI Twitter Thread Posting Agent (Educational Project)

This project shows how to build a simple AI-driven **thread posting agent** for Twitter (X).
By default it generates **5 threads per day** (4 tweets each) across multiple themes, using sample threads to learn tone and style.

It is designed mainly for **education and exploration**:
- Learn how to connect large language models (LLMs) with simple agents
- Apply basic MLP-style functionality in a practical setting
- See how scheduling, state management, and prompt design work in practice

Based on [simple_twitter_ai_agent](https://github.com/3thousand30/simple_twitter_ai_agent) (single-tweet version).

----

## Highlights

- **Thread generation**: Produces 4-tweet connected threads with narrative flow
- **AI content generation**: Uses Claude Haiku 4.5 for varied, natural, theme-aware content
- **Themes and subthemes**: Organises posts into themes with subthemes for balance and variety
- **Configurable volume**: Default is 5 threads/day (~20 tweets), adjustable in code or schedule
- **Voice alignment**: Learns from sample threads to stay on-brand
- **Stateless but progressive**: Each run is independent while cycling through themes
- **Thread chaining**: Posts tweets as proper Twitter threads using reply chains

## How It Works

1. Lambda triggers every 5 hours (~5 executions/day)
2. Reads current position in the theme/subtheme cycle from DynamoDB
3. Generates a 4-tweet thread using Claude Haiku 4.5 with persona and sample context
4. Posts tweet 1, then replies to it with tweet 2, replies to that with tweet 3, etc.
5. Advances state — after 3 threads per subtheme, moves to the next one
6. Full cycle through all subthemes takes ~15 days, then repeats

## Thread Structure

Each thread follows this pattern:
- **Tweet 1**: Hook — bold opening statement or provocative question (includes hashtag)
- **Tweet 2**: Expand — provide depth, a story, or a surprising angle
- **Tweet 3**: Challenge — shift perspective, push the reader to think differently
- **Tweet 4**: Close — memorable takeaway or call to reflection

## Architecture

- **AWS Lambda**: Serverless execution with scheduled triggers
- **DynamoDB**: Stores cycle state (`ThreadBotState`) and sample threads (`ThreadBotSampleThreads`)
- **Secrets Manager**: Keeps Twitter API and Anthropic API credentials secure
- **EventBridge**: Automates scheduling (every 5 hours)

## Configuration

### Themes (`index.js`)

```javascript
const THEMES = {
  "YourTheme1": {
    description: "Theme description for AI context",
    subThemes: ["Subtheme1", "Subtheme2", "Subtheme3", "Subtheme4", "Subtheme5"]
  },
  // Add more themes...
};
```

### Persona (`persona.js`)

Define your bot's identity, voice, beliefs, and what to avoid. The AI uses this to maintain consistent character across all threads.

### Constants (`index.js`)

```javascript
const TWEETS_PER_THREAD = 4;       // Tweets in each thread
const THREADS_PER_SUBTHEME = 3;    // Threads per subtheme before advancing
const THREADS_PER_EXECUTION = 1;   // Threads per Lambda invocation
const TOTAL_THREADS_PER_DAY = 5;   // ~5 executions/day at rate(5 hours)
```

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Customise your content

- Edit themes and subthemes in `index.js`
- Edit persona in `persona.js`
- Edit sample threads in `setup-dynamodb.js`

### 3. Secrets Configuration

Store these in AWS Secrets Manager (secret name: `thread-bot-secrets`):

```json
{
  "twitter_api_key": "your_key",
  "twitter_api_secret": "your_secret",
  "twitter_access_token": "your_token",
  "twitter_access_token_secret": "your_token_secret",
  "ai_provider_api_key": "your_anthropic_api_key"
}
```

## Deployment (AWS Console — Manual)

### Step 1: Create DynamoDB Tables

1. Go to **DynamoDB** in AWS Console
2. Create table `ThreadBotState`:
   - Partition key: `id` (String)
   - Billing mode: On-demand
3. Create table `ThreadBotSampleThreads`:
   - Partition key: `id` (String)
   - Billing mode: On-demand

### Step 2: Create Secret in Secrets Manager

1. Go to **Secrets Manager** in AWS Console
2. Click **Store a new secret**
3. Choose **Other type of secret**
4. Add key/value pairs for all 5 credentials (see Secrets Configuration above)
5. Name it `thread-bot-secrets`

### Step 3: Create Lambda Function

1. Go to **Lambda** in AWS Console
2. Click **Create function**
3. Choose **Author from scratch**
   - Function name: `twitter-thread-agent`
   - Runtime: **Node.js 22.x**
   - Architecture: x86_64
4. Under **General configuration**, set timeout to **5 minutes** (300 seconds) and memory to **256 MB**

### Step 4: Upload Code

1. On your local machine, create a deployment package:
   ```bash
   zip -r function.zip index.js persona.js package.json node_modules/
   ```
2. In the Lambda console, upload the `.zip` file under **Code source**

### Step 5: Set Environment Variables

In the Lambda function configuration, add these environment variables:

| Key | Value |
|-----|-------|
| `SECRET_NAME` | `thread-bot-secrets` |
| `STATE_TABLE` | `ThreadBotState` |
| `SAMPLE_THREADS_TABLE` | `ThreadBotSampleThreads` |

### Step 6: Configure IAM Permissions

Add these permissions to the Lambda execution role:

- **DynamoDB**: `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:Scan` on both tables
- **Secrets Manager**: `secretsmanager:GetSecretValue` on your secret ARN

### Step 7: Set Up Schedule (EventBridge)

1. In the Lambda function, go to **Configuration > Triggers**
2. Click **Add trigger** > **EventBridge (CloudWatch Events)**
3. Create a new rule:
   - Rule name: `thread-bot-schedule`
   - Schedule expression: `rate(5 hours)`
4. Enable the trigger

### Step 8: Initialise Sample Threads

Update `setup-dynamodb.js` with your actual sample threads, then run:
```bash
node setup-dynamodb.js
```

### Step 9: Test

Use the **Test** button in Lambda console with an empty event `{}` to verify everything works.

## Monitoring

- Check **CloudWatch Logs** at `/aws/lambda/twitter-thread-agent`
- Logs show cycle progress, current theme/subtheme, and posted thread content

## Roadmap

- Recent threads tracking to reduce repetition
- Voice analysis engine to detect tone and sentence patterns automatically

## Live Example

Single-tweet version running on [@ProyogiBaba](https://x.com/ProyogiBaba).

## Contact & Contributions

For feedback, questions, or contributions, reach out [here](https://github.com/3thousand30/simple_twitter_thread_ai_automation/issues).

## License

MIT License - Feel free to adapt for your own projects.
