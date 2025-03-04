/**
 * convertImages.js
 *
 * Reads "orig.txt" and searches for lines containing references to .gif, .png,
 * .webp, or .jpg images hosted at either:
 *   - https://cdn.creaticode.com/...
 *   - https://ccdn.creaticode.com/...
 *
 * For each match:
 *   1) Extract the file name (e.g. "watercolor_parking_lot_56335178_203676.webp").
 *   2) Check if the file already exists in "../images".
 *      - If not, download it from the original URL into "../images".
 *   3) Replace the URL with:
 *      https://github.com/cake2000/creaticodesharing/blob/main/images/[filename]?raw=true
 *
 * Finally, the script writes the updated text to "output.txt".
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

// Helper: download a file from a URL to a local 'destination'
function downloadFile(url, destination) {
  console.log("Downloading", url, "to", destination);
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

// Main function to do the conversion
async function convertImages() {
  // 1) Read the "orig.txt" file
  let originalText;
  try {
    originalText = fs.readFileSync("orig.txt", "utf8");
  } catch (err) {
    console.error('Error reading "orig.txt":', err);
    process.exit(1);
  }

  // 2) Regex that handles either cdn.creaticode.com OR ccdn.creaticode.com
  //    and captures .gif, .png, .webp, or .jpg at the end.
  //
  // Explanation:
  //    !\[(.*?)\]                -> Match the start of a markdown image tag, capturing alt text as group #1
  //    \(                        -> Literal "("
  //    (https:\/\/(?:c|cc)dn\.creaticode\.com\/.*?\/([^\/]+\.(?:gif|png|webp|jpg)))\)
  //
  //    - The first part of group #2 (?:c|cc)dn\.creaticode\.com means "cdn.creaticode.com" or "ccdn.creaticode.com"
  //    - .*? matches any path characters (non-greedy)
  //    - /([^\/]+\.(?:gif|png|webp|jpg)) captures the final portion after the last slash,
  //      which is the filename.ext (group #3)
  //
  // So the capturing groups are:
  //   [1] = alt text
  //   [2] = entire URL (e.g., "https://ccdn.creaticode.com/newimages/bg1/file.webp")
  //   [3] = filename.ext (e.g., "file.webp")
  //
  const imageRegex =
    /!\[(.*?)\]\((https:\/\/(?:c|cc)dn\.creaticode\.com\/.*?\/([^\/]+\.(?:gif|png|webp|jpg)))\)/g;

  const downloadPromises = [];
  const replacementMap = new Map();

  // 3) Iterate over matches and queue downloads if needed
  let match;
  while ((match = imageRegex.exec(originalText)) !== null) {
    const fullMatch = match[0]; // e.g. ![alt text](https://ccdn.creaticode.com/.../filename.webp)
    const altText = match[1]; // e.g. alt text
    const originalUrl = match[2]; // e.g. https://ccdn.creaticode.com/.../filename.webp
    const fileName = match[3]; // e.g. filename.webp

    // Local path: ../images/filename.webp
    const localPath = path.join(__dirname, "..", "images", fileName);

    // GitHub URL
    const newUrl = `https://github.com/cake2000/creaticodesharing/blob/main/images/${fileName}?raw=true`;

    // Avoid duplicate replacements for the exact same match
    if (!replacementMap.has(fullMatch)) {
      replacementMap.set(fullMatch, `![${altText}](${newUrl})`);

      // Check if the file already exists locally; if not, download it
      if (!fs.existsSync(localPath)) {
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
    console.log("Downloading missing images...");
    await Promise.all(downloadPromises);
    console.log("All missing images have been downloaded.");
  }

  // 5) Replace references in the original text with the new GitHub-based URLs
  let updatedText = originalText;
  for (const [oldRef, newRef] of replacementMap.entries()) {
    updatedText = updatedText.split(oldRef).join(newRef);
  }

  // 6) Write the result to "output.txt"
  try {
    fs.writeFileSync("output.txt", updatedText, "utf8");
    console.log('Successfully wrote updated content to "output.txt".');
  } catch (err) {
    console.error('Error writing to "output.txt":', err);
  }
}

// Run the script
convertImages().catch((err) => {
  console.error("An unexpected error occurred:", err);
});
