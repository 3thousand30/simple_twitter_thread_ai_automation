const { DynamoDBClient, CreateTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

// Configure AWS - replace with your preferred region or use environment variables
const dynamoClient = new DynamoDBClient({ region: 'eu-central-1' });
const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);

// Create tables function
async function createTables() {
  // Create state table
  const stateTableParams = {
    TableName: 'ThreadBotState',
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  // Create sample threads table
  const sampleThreadsTableParams = {
    TableName: 'ThreadBotSampleThreads',
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    console.log('Creating ThreadBotState table...');
    await dynamoClient.send(new CreateTableCommand(stateTableParams));
    console.log('ThreadBotState table created successfully!');

    console.log('Creating ThreadBotSampleThreads table...');
    await dynamoClient.send(new CreateTableCommand(sampleThreadsTableParams));
    console.log('ThreadBotSampleThreads table created successfully!');

    // Initialize state
    // Important: The initial state need to be updated with your actual themes and subthemes.
    console.log('Initializing state...');
    await dynamoDB.send(new PutCommand({
      TableName: 'ThreadBotState',
      Item: {
        id: 'current_state',
        mainTheme: 'Theme1',
        subTheme: 'Subtheme1',
        threadsPostedToday: 0,
        currentSubThemeCount: 0,
        currentDay: new Date().toDateString(),
        lastUpdated: new Date().toISOString()
      }
    }));
    console.log('State initialized!');

    console.log('DynamoDB setup completed successfully!');
  } catch (error) {
    console.error('Error creating tables:', error);
  }
}

// Function to add a sample thread (multi-tweet text separated by newlines)
async function addSampleThread(text) {
  const id = `thread_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  try {
    await dynamoDB.send(new PutCommand({
      TableName: 'ThreadBotSampleThreads',
      Item: {
        id,
        text,
        createdAt: new Date().toISOString()
      }
    }));
    console.log(`Added sample thread: ${text.substring(0, 50)}...`);
  } catch (error) {
    console.error('Error adding sample thread:', error);
  }
}

// Example usage:
async function main() {
  // First create the tables
  await createTables();

  // Wait for tables to be active
  console.log('Waiting for tables to be active...');
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Then add some sample threads. You can add as many as you want but keep token limits in mind.
  // Important: Needs to be updated with actual sample threads relevant to your themes.
  // Each sample is a full thread text that the AI can reference for style.
  const sampleThreads = [
    "Sample thread about #Subtheme1. First tweet hooks. Second tweet expands. Third challenges. Fourth closes.",
    "Sample thread about #Subtheme2. Opening provocation. Supporting insight. Perspective shift. Final takeaway.",
  ];

  for (const thread of sampleThreads) {
    await addSampleThread(thread);
  }

  console.log('Setup complete!');
}

main();
