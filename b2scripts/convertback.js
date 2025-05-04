/**

https://ccdn.creaticode.com/newimages/bg1/red_anime_castle_image_83097681_196744.webp

https://ccdncreaticodecom.b-cdn.net/newimages/bg1/red_anime_castle_image_83097681_196744.webp

https://ccdncreaticodecom.s3.us-east-005.backblazeb2.com/newimages/bg1/red_anime_castle_image_83097681_196744.webp

https://ccdncreaticodecom.s3.us-east-005.backblazeb2.com/newimages/fg1/2023_dodge_charger_srt_41637807_381750.webp


* convertImagesBack.js
 *
 * 1) Reads "orig.txt".
 * 2) Finds:
 *    A) Markdown image references:
 *       ![altText](https://github.com/.../images/filename.ext?raw=true)
 *    B) HTML <img> tags:
 *       <img src="https://github.com/.../images/filename.ext?raw=true" ...>
 * 3) For each filename, probes these bases in order:
 *       https://cdn.creaticode.com/scratch-gui-projects/forum/
 *       https://ccdn.creaticode.com/newimages/bg1/
 *       https://ccdn.creaticode.com/newimages/fg1/
 *       https://ccdn.creaticode.com/newimages/fg2/
 *    Uses the first that returns HTTP 200. If none work, logs an error and skips.
 * 4) Replaces each reference with the matching CDN URL:
 *       Markdown → ![alt](<newUrl>)
 *       HTML     → <img src="<newUrl>" …>
 * 5) Writes modified content to "output.txt".
 */

const fs = require("fs");
const https = require("https"); 

// All possible CDN bases to try (in priority order)
const CDN_BASES = [
  "https://cdn.creaticode.com/scratch-gui-projects/forum/",
  "https://ccdn.creaticode.com/newimages/bg1/",
  "https://ccdn.creaticode.com/newimages/fg1/",
  "https://ccdn.creaticode.com/newimages/fg2/"
];

// Check via HTTP HEAD whether a URL exists (status 200)
function urlExists(url) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: "HEAD" }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.end();
  });
}

// Find Markdown ![alt](github-raw-url) refs
function findMarkdownImageReferences(text) {
  const regex = /!\[(.*?)\]\(https:\/\/github\.com\/cake2000\/creaticodesharing\/blob\/main\/images\/([^\/\?]+)\?raw=true\)/g;
  const results = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    results.push({
      original: m[0],
      altText: m[1],
      fileName: m[2],
      type: "markdown"
    });
  }
  return results;
}

// Find HTML <img src="github-raw-url" …> refs
function findHtmlImageReferences(text) {
  const regex = /<img\s+([^>]*?)src="https:\/\/github\.com\/cake2000\/creaticodesharing\/blob\/main\/images\/([^\/\?]+)\?raw=true"([^>]*?)>/g;
  const results = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    results.push({
      original: m[0],
      attrsBefore: m[1],
      fileName: m[2],
      attrsAfter: m[3],
      type: "html"
    });
  }
  return results;
}

async function convertImagesBack() {
  // 1) Read orig.txt
  let content;
  try {
    content = fs.readFileSync("orig.txt", "utf8");
  } catch (err) {
    console.error('Error reading "orig.txt":', err);
    process.exit(1);
  }

  // 2) Collect all refs
  const mdRefs   = findMarkdownImageReferences(content);
  const htmlRefs = findHtmlImageReferences(content);
  const allRefs  = [...mdRefs, ...htmlRefs];

  if (allRefs.length === 0) {
    console.log("No GitHub raw image references found. Writing original to output.txt.");
    fs.writeFileSync("output.txt", content, "utf8");
    return;
  }

  // 3) For each ref, resolve the new CDN URL (or skip on error)
  const replacements = [];
  for (const ref of allRefs) {
    let foundUrl = null;

    for (const base of CDN_BASES) {
      const candidate = base + ref.fileName;
      // eslint-disable-next-line no-await-in-loop
      if (await urlExists(candidate)) {
        foundUrl = candidate;
        break;
      }
    }

    if (!foundUrl) {
      console.error(`⚠️  Image not found in any CDN for "${ref.fileName}". Skipping replacement.`);
      continue;
    }

    // Build replacement snippet
    let replacement;
    if (ref.type === "markdown") {
      replacement = `![${ref.altText}](${foundUrl})`;
    } else {
      // html
      replacement = `<img ${ref.attrsBefore}src="${foundUrl}"${ref.attrsAfter}>`;
    }

    replacements.push({ original: ref.original, replacement });
  }

  // 4) Apply all replacements
  let updated = content;
  for (const { original, replacement } of replacements) {
    updated = updated.split(original).join(replacement);
  }

  // 5) Write output.txt
  try {
    fs.writeFileSync("output.txt", updated, "utf8");
    console.log('✅ Successfully wrote updated content to "output.txt".');
  } catch (err) {
    console.error('Error writing "output.txt":', err);
    process.exit(1);
  }
}

// Kick it off
convertImagesBack().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
