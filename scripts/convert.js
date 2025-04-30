/**
 * convertImages.js
 *
 * 1) Reads "orig.txt".
 * 2) Finds two kinds of image references:
 *    A) Markdown references for .gif, .png, .webp, or .jpg from:
 *       - https://cdn.creaticode.com/...
 *       - https://ccdn.creaticode.com/...
 *       in the pattern:
 *          ![alt text](https://(c|cc)dn.creaticode.com/.../filename.ext)
 *
 *    B) Custom ccimg references for .gif only, which may look like:
 *       ccimg||470||https://cdn.creaticode.com/.../someGif.gif
 *       OR
 *       ccimg2||1000||https://cdn.creaticode.com/.../anotherGif.gif
 *       etc.
 *
 *       The pattern is:
 *         ccimg\d*\|\|\d+\|\|https://...someFile.gif
 *
 * 3) For each found reference:
 *    - Extract filename (e.g. "someGif.gif")
 *    - If not in ../images, download it there
 *    - Replace the original reference with:
 *         ![filename.gif](https://github.com/cake2000/creaticodesharing/blob/main/images/filename.gif?raw=true)
 *
 * 4) Writes the modified content to "output.txt".
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

// ===================
//  Helper functions
// ===================

// Downloads a file from `url` and saves it as `destination`.
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

// Generates the GitHub-based URL for your images
function makeGitHubURL(filename) {
  return `https://github.com/cake2000/creaticodesharing/blob/main/images/${filename}?raw=true`;
}

/**
 * This function scans `text` for markdown-style references of the form:
 *    ![someAlt](https://(c|cc)dn.creaticode.com/.../filename.(gif|png|webp|jpg))
 * and returns an array of objects describing each match:
 *    {
 *      originalText: "![someAlt](...)",  // entire match to replace
 *      altText: "someAlt",
 *      originalURL: "https://(c|cc)dn.creaticode.com/.../filename.gif",
 *      fileName: "filename.gif"
 *    }
 */
function findMarkdownImageReferences(text) {
  const markdownRegex =
    /!\[(.*?)\]\((https:\/\/(?:c|cc)dn\.creaticode\.com\/.*?\/([^/]+\.(?:gif|png|webp|jpg)))\)/g;

  const results = [];
  let match;
  while ((match = markdownRegex.exec(text)) !== null) {
    const [fullMatch, altText, originalUrl, fileName] = match;
    results.push({
      originalText: fullMatch,
      altText,
      originalURL: originalUrl,
      fileName,
    });
  }
  return results;
}

/**
 * This function scans `text` for lines of the form:
 *    ccimg||<anyNumber>||<URL.gif>
 * or
 *    ccimg2||<anyNumber>||<URL.gif>
 * or ccimg10||... etc.
 *
 * The key points are:
 *  - "ccimg" possibly followed by digits (\d*)
 *  - double pipes
 *  - some integer size
 *  - double pipes
 *  - a https://...someFile.gif
 *
 * Returns an array of objects describing each match:
 *    {
 *      originalText: "ccimg2||1000||https://cdn.creaticode.com/.../someFile.gif",
 *      fileName: "someFile.gif",
 *      originalURL: "https://cdn.creaticode.com/.../someFile.gif"
 *    }
 */
function findCCimgReferences(text) {
  // Regex explanation:
  //   ccimg\d*\|\|\d+\|\|(https:\/\/.*?\.gif)
  //   - ccimg\d*   : "ccimg" followed by zero or more digits
  //   - \|\|\d+\|\| : e.g. "||470||"
  //   - (https:\/\/.*?\.(gif|png|webp|jpg))i : group #1 = the entire URL, ending with supported image extension
  const ccimgRegex = /ccimg\d*\|\|\d+\|\|(https:\/\/.*?\.(gif|png|webp|jpg))/gi;

  const results = [];
  let match;
  while ((match = ccimgRegex.exec(text)) !== null) {
    const fullMatch = match[0]; // e.g. "ccimg2||1000||https://cdn.creaticode.com/.../someGif.gif"
    const originalUrl = match[1]; // e.g. "https://cdn.creaticode.com/.../someGif.gif"

    // Extract just the filename from the URL:
    // We'll assume everything after the last "/" is the filename
    const fileName = originalUrl.substring(originalUrl.lastIndexOf("/") + 1);

    results.push({
      originalText: fullMatch,
      fileName,
      originalURL: originalUrl,
    });
  }
  return results;
}

/**
 * Given our arrays of references, this merges them into a single array
 * of objects in a consistent format so we can handle downloads and replacements uniformly.
 */
function mergeAllReferences(markdownRefs, ccimgRefs) {
  // Convert markdown references to a consistent shape:
  const mergedMarkdown = markdownRefs.map((ref) => ({
    originalText: ref.originalText,
    fileName: ref.fileName,
    originalURL: ref.originalURL,
    // For markdown references, we have an altText.
    // We'll use it in the final replacement.
    altText: ref.altText,
  }));

  // Convert ccimg references to the same shape:
  const mergedCCimg = ccimgRefs.map((ref) => ({
    originalText: ref.originalText,
    fileName: ref.fileName,
    originalURL: ref.originalURL,
    // We'll set altText to the fileName for the ccimg references:
    altText: ref.fileName,
  }));

  return [...mergedMarkdown, ...mergedCCimg];
}

// Main function
async function convertImages() {
  // 1) Read the "orig.txt" file
  let originalText;
  try {
    originalText = fs.readFileSync("orig.txt", "utf8");
  } catch (err) {
    console.error('Error reading "orig.txt":', err);
    process.exit(1);
  }

  // 2) Find references in two categories:
  //    (A) Markdown image references
  //    (B) ccimg||...|| references (including ccimg2||...||, etc. for .gif only)
  const markdownRefs = findMarkdownImageReferences(originalText);
  const ccimgRefs = findCCimgReferences(originalText);

  // Combine them into a single list to process
  const allRefs = mergeAllReferences(markdownRefs, ccimgRefs);

  // We'll track which references we've processed so we don't re-download or re-replace duplicates
  const uniqueRefsMap = new Map();

  // 3) Populate the Map with reference info
  for (const ref of allRefs) {
    const { originalText, fileName, originalURL, altText } = ref;

    // Only add to our map if we haven't handled this exact text snippet
    if (!uniqueRefsMap.has(originalText)) {
      uniqueRefsMap.set(originalText, { fileName, originalURL, altText });
    }
  }

  // 4) Download any missing files to "../images"
  const downloadPromises = [];
  for (const { fileName, originalURL } of uniqueRefsMap.values()) {
    const localPath = path.join(__dirname, "..", "images", fileName);
    if (!fs.existsSync(localPath)) {
      downloadPromises.push(
        downloadFile(originalURL, localPath).catch((err) => {
          console.error(`Failed to download ${originalURL}:`, err);
        })
      );
    }
  }

  // Wait for downloads to complete
  if (downloadPromises.length > 0) {
    console.log("Downloading missing image files...");
    await Promise.all(downloadPromises);
    console.log("All missing images have been downloaded.");
  }

  // 5) Replace references in the text with the new GitHub-based URLs
  let updatedText = originalText;
  for (const [oldString, { fileName, altText }] of uniqueRefsMap.entries()) {
    const newUrl = makeGitHubURL(fileName);
    // For final display, we do a markdown image with the altText:
    const newMarkdown = `![${altText}](${newUrl})`;
    // Replace all occurrences of oldString in updatedText
    updatedText = updatedText.split(oldString).join(newMarkdown);
  }

  // 6) Write the updated text to "output.txt"
  try {
    fs.writeFileSync("output.txt", updatedText, "utf8");
    console.log('Successfully wrote updated content to "output.txt".');
  } catch (err) {
    console.error('Error writing "output.txt":', err);
  }
}

// Kick off the script
convertImages().catch((err) => {
  console.error("Unexpected error:", err);
});
