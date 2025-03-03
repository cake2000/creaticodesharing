/**
 * convertImages.js
 *
 * Reads "orig.txt" and searches for lines containing references to either .gif
 * or .png images hosted at:
 *   https://cdn.creaticode.com/scratch-gui-projects/forum/[someFile.(gif|png)]
 *
 * For each match:
 *   1) Extract the file name (e.g., "356d917c-f6d6-40b7-b888-8210faacc3a4.gif" or .png).
 *   2) Check if the file already exists in "../images".
 *       - If not, download it from the CDN URL into "../images".
 *   3) Replace the reference with:
 *       https://github.com/cake2000/creaticodesharing/blob/main/images/[filename]?raw=true
 *
 * The updated text is written to "output.txt".
 */

const fs = require("fs");
const path = require("path");
const https = require("https"); // Used for downloading files

// Utility function to download a file from a URL and save it to 'destination'
function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(
            new Error(
              `Failed to download ${url}: status code ${response.statusCode}`
            )
          );
          return;
        }
        response.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        fs.unlink(destination, () => reject(err));
      });
  });
}

// Main asynchronous function to run the conversion process
async function convertImages() {
  // 1) Read the source file (orig.txt)
  let originalText;
  try {
    originalText = fs.readFileSync("orig.txt", "utf8");
  } catch (err) {
    console.error("Error reading orig.txt:", err);
    process.exit(1);
  }

  // 2) Regex to match either .gif or .png from Creaticode's CDN
  // Explanation:
  // - !\[(.*?)\] : matches "![...]" capturing alt text (group #1)
  // - \( : matches "("
  // - (https:\/\/cdn\.creaticode\.com\/scratch-gui-projects\/forum\/(.*?\.(?:gif|png))) :
  //       group #2 = full URL, group #3 = filename (something.gif or something.png)
  // - \) : matches ")"
  const imageRegex =
    /!\[(.*?)\]\((https:\/\/cdn\.creaticode\.com\/scratch-gui-projects\/forum\/(.*?\.(?:gif|png)))\)/g;

  let match;
  const downloadPromises = [];
  const replacementMap = new Map();
  // key = the exact substring we want to replace (e.g. ![p.gif](...)),
  // value = the new substring referencing the GitHub URL

  // 3) Scan through all matches and queue any needed downloads
  while ((match = imageRegex.exec(originalText)) !== null) {
    const fullMatch = match[0]; // e.g. ![p.gif](https://cdn.creaticode.com/.../something.gif)
    const altText = match[1]; // e.g. p.gif
    const originalUrl = match[2]; // e.g. https://cdn.creaticode.com/.../something.gif
    const fileName = match[3]; // e.g. something.gif

    // Construct the local path to ../images/<fileName>
    const localPath = path.join(__dirname, "..", "images", fileName);

    // The final GitHub URL for the image
    const newUrl = `https://github.com/cake2000/creaticodesharing/blob/main/images/${fileName}?raw=true`;

    // If we've not already processed this exact reference, add it to the map
    if (!replacementMap.has(fullMatch)) {
      replacementMap.set(fullMatch, `![${altText}](${newUrl})`);

      // Check if the image file already exists locally
      if (!fs.existsSync(localPath)) {
        // Queue a download if it doesn’t exist
        downloadPromises.push(
          downloadFile(originalUrl, localPath).catch((err) => {
            console.error(`Failed to download ${originalUrl}:`, err);
          })
        );
      }
    }
  }

  // 4) Download any missing images
  if (downloadPromises.length > 0) {
    console.log("Downloading missing image files...");
    await Promise.all(downloadPromises);
    console.log("All missing images have been downloaded.");
  }

  // 5) Replace references in the text with the new GitHub-based references
  let updatedText = originalText;
  for (const [oldRef, newRef] of replacementMap.entries()) {
    // Perform a direct global string replacement for the exact match
    updatedText = updatedText.split(oldRef).join(newRef);
  }

  // 6) Write the updated text to output.txt
  try {
    fs.writeFileSync("output.txt", updatedText, "utf8");
    console.log("Successfully wrote updated content to output.txt");
  } catch (err) {
    console.error("Error writing to output.txt:", err);
  }
}

// Execute the script
convertImages().catch(console.error);
