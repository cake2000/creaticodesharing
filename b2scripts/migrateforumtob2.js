#!/usr/bin/env node
'use strict';

/*


https://docs.nodebb.org/api/#tag/topics
https://docs.nodebb.org/api/write/

 * Bulk migrate forum images onto Backblaze B2 and rewrite in posts.
 *
 * Dependencies:
 *   npm install axios backblaze-b2 mime-types
 */

const axios = require('axios');
const B2    = require('backblaze-b2');
const mime  = require('mime-types');
const fs    = require('fs');
const path  = require('path');

// ─── Configuration ────────────────────────────────────────────────────────────
// REST API
const BASE_URL    = process.env.BASE_URL    || 'https://www.forum.creaticode.com/api';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'cab4955d-2851-4936-b72d-dddb05c6fd84';
// Backblaze B2
const B2_ACCOUNT_ID      = process.env.B2_ACCOUNT_ID      || '005d07019053ff60000000001';
const B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY || 'K0050Hrpxf/fhLY98rxuEX7kjxHqhpQ';

// Pagination
const PER_PAGE = 100;

// File to store post IDs
const POST_IDS_FILE = path.join(__dirname, 'post_ids.json');

// ─── HTTP Clients ──────────────────────────────────────────────────────────────
const api = axios.create({
  baseURL: BASE_URL,
  headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
});


const api3 = axios.create({
  baseURL: BASE_URL + '/v3',
  headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
});


// ─── Step 1: Fetch all post IDs via categories → subcategories → topics → posts ─
async function fetchAllPostIds() {
  const pids = [];

  // 1) Fetch all categories in one go (no pagination)
  const catRes   = await api.get('/categories');
  let allCats  = catRes.data.categories || catRes.data;

  // filter for only cid = 17
  allCats = allCats.filter(cat => cat.cid === 2);

  // // 2) Build a parentCid → [child categories] map
  // const childrenMap = {};
  // allCats.forEach(cat => {
  //   const parent = cat.parentCid || 0;
  //   childrenMap[parent] = childrenMap[parent] || [];
  //   childrenMap[parent].push(cat);
  // });

  const subCats = allCats[0].children;
  for (const subCat of subCats) {
    // 4) Page through topics in this sub-category
    let topicStart = 0;
    if (1) {
      const tRes   = await api.get(`/category/${subCat.slug}`);
      const topics = tRes.data.topics || tRes.data;
      if (!topics.length) break;

      // 5) For each topic, page through its posts
      for (const { tid } of topics) {
        console.log(`Fetching posts for topic ${tid}`);
        let postStart = 0;
        while (true) {
          const pRes  = await api.get(`/topic/${tid}`, {
            params: { start: postStart, limit: PER_PAGE }
          });
          const posts = pRes.data.posts || pRes.data;
          if (!posts.length) break;
          console.log(`  Found ${posts.length} posts`);
          posts.forEach(p => pids.push(p.pid));
          postStart += posts.length;
          break;
        }
      }
      topicStart += topics.length;
    }
  }

  return pids;
}


// ─── Functions to save and load post IDs from file ──────────────────────────────
function savePostIds(postIds) {
  try {
    fs.writeFileSync(POST_IDS_FILE, JSON.stringify(postIds), 'utf8');
    console.log(`Saved ${postIds.length} post IDs to ${POST_IDS_FILE}`);
    return true;
  } catch (err) {
    console.error(`Error saving post IDs to file: ${err.message}`);
    return false;
  }
}

function loadPostIds() {
  try {
    if (fs.existsSync(POST_IDS_FILE)) {
      const data = fs.readFileSync(POST_IDS_FILE, 'utf8');
      if (data) {
        const postIds = JSON.parse(data);
        console.log(`Loaded ${postIds.length} post IDs from ${POST_IDS_FILE}`);
        return postIds;
      }
    }
    return null;
  } catch (err) {
    console.error(`Error loading post IDs from file: ${err.message}`);
    return null;
  }
}

// ─── Step 2: Extract image URLs from post content ──────────────────────────────
function extractImageUrls(content) {
  const urls = new Set();
  const md = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
  let m;
  while ((m = md.exec(content))) urls.add(m[1]);

  const cc = /ccimg(?:2|3)?\|\|\d+\|\|(https?:\/\/\S+?)(?:\|\|\d+)?/g;
  while ((m = cc.exec(content))) {
    urls.add(m[1].replace(/[.,)]$/, ''));
  }

  return [...urls];
}

// ─── Step 3: Init B2 client & bucket map ───────────────────────────────────────
async function initB2() {
  const b2 = new B2({
    accountId:      B2_ACCOUNT_ID,
    applicationKey: B2_APPLICATION_KEY,
  });
  const auth        = await b2.authorize();
  const downloadUrl = auth.data.downloadUrl;

  const buckets = await b2.listBuckets({ accountId: B2_ACCOUNT_ID });
  const map     = {};
  for (const b of buckets.data.buckets) {
    map[b.bucketName] = b.bucketId;
  }

  return { b2, downloadUrl, bucketNameToId: map };
}

// ─── Step 4: Ensure one image is on B2, return its new URL ───────────────────
async function ensureImageOnB2(b2Client, downloadUrl, bucketMap, url) {
  const u = new URL(url);
  let bucketName, fileName;

  if (u.host === 'cdn.creaticode.com') {
    bucketName = 'cdncreaticodecom';
    fileName   = u.pathname.slice(1);
  } else if (u.host === 'ccdn.creaticode.com') {
    bucketName = 'ccdncreaticodecom';
    fileName   = u.pathname.slice(1);
  } else if (u.host.includes('github.com')) {
    bucketName = 'fromgithub';
    fileName   = `images/${u.pathname.split('/').pop()}`;
  } else {
    console.log(`!! skipping ${url} (unsupported host)`);
    return url;
  }

  const bucketId = bucketMap[bucketName];
  if (!bucketId) throw new Error(`Bucket "${bucketName}" not found`);

  const list = await b2Client.listFileNames({
    bucketId,
    prefix:       fileName,
    maxFileCount: 1,
  });
  const exists = list.data.files.some(f => f.fileName === fileName);

  if (!exists) {
    console.log(`→ Uploading ${url} → ${bucketName}/${fileName}`);
    const imgRes = await axios.get(url, { responseType: 'arraybuffer' });
    await b2Client.uploadFile({
      bucketId,
      fileName,
      data: Buffer.from(imgRes.data),
    });
  }

  return `${downloadUrl}/file/${bucketName}/${encodeURIComponent(fileName)}`;
}

// ─── Step 5: Process one post: migrate its images & rewrite content ──────────
async function processPost(b2Client, downloadUrl, bucketMap, pid) {
  const res     = await api.get(`/posts/${pid}`);
  const post    = res.data.post;
  const content = post.content;
  const urls    = extractImageUrls(content);
  if (!urls.length) return;

  let updated = content;
  for (const oldUrl of urls) {
    try {
      const newUrl = await ensureImageOnB2(b2Client, downloadUrl, bucketMap, oldUrl);
      if (newUrl !== oldUrl) {
        updated = updated.split(oldUrl).join(newUrl);
      }
    } catch (err) {
      console.error(`!! PID ${pid}, URL ${oldUrl}: ${err.message}`);
    }
  }

  if (updated !== content) {
    console.log(`Updating post ${pid}`);
    await api.put(`/posts/${pid}`, { content: updated });
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    const { b2, downloadUrl, bucketNameToId } = await initB2();
    console.log('B2 initialized.');

    // Try to load post IDs from file first
    let allPids = loadPostIds();
    
    // If file doesn't exist or is empty, fetch post IDs and save to file
    if (!allPids) {
      console.log('No saved post IDs found, fetching from API...');
      allPids = await fetchAllPostIds();
      console.log(`Found ${allPids.length} posts.`);
      savePostIds(allPids);
    }

    // For testing only: uncomment to limit to one PID
    // const allPids = ['6711'];

    for (const pid of allPids) {
      await processPost(b2, downloadUrl, bucketNameToId, pid);
    }

    console.log('✅ Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Fatal error:', err.message || err);
    process.exit(1);
  }
})();
