/**
 * convertImages.js
 *
 * Reads "orig.txt" and searches for lines containing references to image files
 * (gif, png, webp, or jpg) hosted at the Creaticode CDN in this format:
 *   ![altText](https://cdn.creaticode.com/scratch-gui-projects/forum/something.gif)
 *
 * It then:
 *   1) Extracts the file name (e.g., "some-id.gif", "some-id.png", "some-id.webp", or "some-id.jpg").
 *   2) Checks if that file already exists in "../images".
 *       - If not found, downloads it from the CDN into "../images".
 *   3) Replaces the reference so it points to:
 *       https://github.com/cake2000/creaticodesharing/blob/main/images/[filename]?raw=true
 *
 * Finally, it writes the updated content to "output.txt".
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

// Utility function to download a file from a URL, storing it at "destination" locally
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

// Main conversion function
async function convertImages() {
  // 1) Read the source file: "orig.txt"
  let originalText;
  try {
    originalText = fs.readFileSync("orig.txt", "utf8");
  } catch (err) {
    console.error('Error reading "orig.txt":', err);
    process.exit(1);
  }

  // 2) Regex to match references to images (gif, png, webp, or jpg) from the Creaticode CDN
  //
  // Explanation:
  // - !\[(.*?)\] : matches ![...] capturing alt text in group #1
  // - \( : matches "("
  // - (https:\/\/cdn\.creaticode\.com\/scratch-gui-projects\/forum\/(.*?\.(?:gif|png|webp|jpg))) :
  //       group #2 = the entire URL, group #3 = the file name (like "filename.gif")
  // - \) : matches ")"
  //
  const imageRegex =
    /!\[(.*?)\]\((https:\/\/cdn\.creaticode\.com\/scratch-gui-projects\/forum\/(.*?\.(?:gif|png|webp|jpg)))\)/g;

  const downloadPromises = [];
  const replacementMap = new Map();

  // 3) Find all matches, queue file downloads if needed, and build a map of old -> new references
  let match;
  while ((match = imageRegex.exec(originalText)) !== null) {
    const fullMatch = match[0]; // e.g. ![p.png](https://cdn.creaticode.com/.../someFile.png)
    const altText = match[1]; // e.g. p.png
    const originalUrl = match[2]; // e.g. https://cdn.creaticode.com/.../someFile.png
    const fileName = match[3]; // e.g. someFile.png

    // Local path in "../images/<fileName>"
    const localPath = path.join(__dirname, "..", "images", fileName);

    // New GitHub-based URL
    const newUrl = `https://github.com/cake2000/creaticodesharing/blob/main/images/${fileName}?raw=true`;

    // If we haven't processed this exact match already (handles duplicates)
    if (!replacementMap.has(fullMatch)) {
      replacementMap.set(fullMatch, `![${altText}](${newUrl})`);

      // If the file does not exist locally, queue a download
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
    console.log("Downloading missing image files...");
    await Promise.all(downloadPromises);
    console.log("All missing images have been downloaded.");
  }

  // 5) Replace all old references in the text with the new GitHub-based references
  let updatedText = originalText;
  for (const [oldRef, newRef] of replacementMap.entries()) {
    // We replace occurrences of oldRef with newRef
    updatedText = updatedText.split(oldRef).join(newRef);
  }

  // 6) Write the updated text to "output.txt"
  try {
    fs.writeFileSync("output.txt", updatedText, "utf8");
    console.log('Successfully wrote updated content to "output.txt"');
  } catch (err) {
    console.error('Error writing to "output.txt":', err);
  }
}

// Execute the script
convertImages().catch((err) => {
  console.error("An unexpected error occurred:", err);
});
