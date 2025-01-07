// Import necessary AWS SDK modules
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");

// Load environment variables from .env file
dotenv.config();

// S3 client configuration
const s3client = new S3Client({
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  region: process.env.AWS_REGION,
});

// S3 bucket and folder path
// const BUCKET_NAME = "ccdn.creaticode.com";
// const S3_PATH = "scratch-gui-projects/forum/";

// older folder
const BUCKET_NAME = "scratch-gui-projects";
const S3_PATH = "scratch-gui-projects/forum/";

// Local directory to save files
const LOCAL_DIR = path.join(__dirname, "../images2/");

// Ensure the local directory exists
if (!fs.existsSync(LOCAL_DIR)) {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
}

// Function to download a file from S3
async function downloadFile(Key) {
  const localFilePath = path.join(LOCAL_DIR, path.basename(Key));

  try {
    const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key });
    const response = await s3client.send(command);

    const writeStream = fs.createWriteStream(localFilePath);
    response.Body.pipe(writeStream);

    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    console.log(`Downloaded: ${Key} -> ${localFilePath}`);
  } catch (error) {
    console.error(`Failed to download ${Key}:`, error);
  }
}

// Function to list and download all files under a specific S3 path
async function downloadAllFiles() {
  let continuationToken;

  try {
    do {
      const command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: S3_PATH,
        ContinuationToken: continuationToken,
      });

      const response = await s3client.send(command);
      const files = response.Contents || [];

      for (const file of files) {
        if (file.Key.endsWith("/")) {
          // Skip folders
          continue;
        }
        await downloadFile(file.Key);
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    console.log("All files downloaded successfully.");
  } catch (error) {
    console.error("Error listing or downloading files:", error);
  }
}

// Run the script
downloadAllFiles();
