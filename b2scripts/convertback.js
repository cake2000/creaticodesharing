/**
 * convertImagesBack.js
 *
 * 1) Reads "orig.txt".
 * 2) Finds:
 *    A) Markdown image references:
 *       ![altText](https://github.com/cake2000/creaticodesharing/blob/main/images/filename.ext?raw=true)
 *    B) HTML <img> tags:
 *       <img src="https://github.com/cake2000/creaticodesharing/blob/main/images/filename.ext?raw=true" ...>
 * 3) Replaces each with the equivalent CDN URL:
 *       https://cdn.creaticode.com/images/filename.ext
 *    - Markdown stays Markdown
 *    - HTML tags keep all other attributes (width, class, etc.)
 * 4) Writes modified content to "output.txt".
 */

const fs = require("fs");
const path = require("path");

// Build the CDN URL for a given filename
function makeCDNURL(filename) {
  return `https://cdn.creaticode.com/scratch-gui-projects/forum/${filename}`;
}

/**
 * Find all GitHub-hosted Markdown image refs.
 * Returns [{ originalText, altText, fileName }]
 */
function findMarkdownImageReferences(text) {
  const ghMdRegex = /!\[(.*?)\]\(https:\/\/github\.com\/cake2000\/creaticodesharing\/blob\/main\/images\/([^\/\?]+)\?raw=true\)/g;
  const results = [];
  let m;
  while ((m = ghMdRegex.exec(text)) !== null) {
    results.push({
      originalText: m[0],
      altText: m[1],
      fileName: m[2],
    });
  }
  return results;
}

/**
 * Find all GitHub-hosted HTML <img> tags.
 * Returns [{ originalText, attrsBefore, fileName, attrsAfter }]
 */
function findHtmlImageReferences(text) {
  const ghHtmlRegex = /<img\s+([^>]*?)src="https:\/\/github\.com\/cake2000\/creaticodesharing\/blob\/main\/images\/([^\/\?]+)\?raw=true"([^>]*?)>/g;
  const results = [];
  let m;
  while ((m = ghHtmlRegex.exec(text)) !== null) {
    results.push({
      originalText: m[0],
      attrsBefore: m[1],
      fileName: m[2],
      attrsAfter: m[3],
    });
  }
  return results;
}

function convertImagesBack() {
  // 1) Load orig.txt
  let content;
  try {
    content = fs.readFileSync("orig.txt", "utf8");
  } catch (err) {
    console.error('Error reading "orig.txt":', err);
    process.exit(1);
  }

  // 2A) Markdown refs
  const mdRefs = findMarkdownImageReferences(content);

  // 2B) HTML <img> refs
  const htmlRefs = findHtmlImageReferences(content);

  // If nothing found, still write original out
  if (mdRefs.length === 0 && htmlRefs.length === 0) {
    console.log("No GitHub raw image references found. Writing original content to output.txt.");
    fs.writeFileSync("output.txt", content, "utf8");
    return;
  }

  // 3A) Replace Markdown refs
  let updated = content;
  for (const { originalText, altText, fileName } of mdRefs) {
    const newUrl = makeCDNURL(fileName);
    const newMd  = `![${altText}](${newUrl})`;
    updated = updated.split(originalText).join(newMd);
  }

  // 3B) Replace HTML <img> refs
  for (const { originalText, attrsBefore, fileName, attrsAfter } of htmlRefs) {
    const newUrl = makeCDNURL(fileName);
    const newTag = `<img ${attrsBefore}src="${newUrl}"${attrsAfter}>`;
    updated = updated.split(originalText).join(newTag);
  }

  // 4) Write output.txt
  try {
    fs.writeFileSync("output.txt", updated, "utf8");
    console.log('Successfully wrote updated content to "output.txt".');
  } catch (err) {
    console.error('Error writing "output.txt":', err);
    process.exit(1);
  }
}

// Run it
convertImagesBack();
