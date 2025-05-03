#!/usr/bin/env node
'use strict';

/*

D:\setup\bin\rclone.exe copy aws_s3:ccdn.creaticode.com b2:ccdncreaticodecom --progress --dry-run

D:\setup\bin\rclone.exe copy aws_s3:scratch-gui-projects/scratch-gui-projects b2:cdncreaticodecom/scratch-gui-projects --progress --dry-run


D:\setup\bin\rclone.exe copy aws_s3:cc3dmodels b2:cdncreaticodecom/cc3dmodels --progress --dry-run


D:\setup\bin\rclone.exe copy aws_s3:community-models b2:cdncreaticodecom/community-models --progress --dry-run

D:\setup\bin\rclone.exe copy aws_s3:scratch3-assets b2:cdncreaticodecom/scratch3-assets --progress --dry-run

D:\setup\bin\rclone.exe copy aws_s3:creaticode-data b2:cdncreaticodecom/creaticode-data --progress --dry-run


*/

/*
 * Bulk migrate forum images onto Backblaze B2 and rewrite in posts.
 *
 * Dependencies:
 *   npm install axios backblaze-b2 mime-types
 */

const axios = require('axios');
const B2 = require('backblaze-b2');
const mime = require('mime-types');

// ─── Configuration ────────────────────────────────────────────────────────────
// REST API
const BASE_URL    = process.env.BASE_URL    || 'http://www.forum.creaticode.com/api/v3';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'cab4955d-2851-4936-b72d-dddb05c6fd84';
// Backblaze B2
const B2_ACCOUNT_ID       = process.env.B2_ACCOUNT_ID       || '005d07019053ff60000000001';
const B2_APPLICATION_KEY  = process.env.B2_APPLICATION_KEY  || 'K0050Hrpxf/fhLY98rxuEX7kjxHqhpQ';

// Pagination
const PER_PAGE = 100;

// ─── HTTP Clients ──────────────────────────────────────────────────────────────
const api = axios.create({
  baseURL: BASE_URL,
  headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
});

// ─── Step 1: Fetch all post IDs ────────────────────────────────────────────────
async function fetchAllPostIds() {
  let page = 1;
  const all = [];
  while (true) {
    const res = await api.get(`/posts?page=${page}&per_page=${PER_PAGE}`);
    const posts = res.data.posts;
    if (!posts || posts.length === 0) break;
    all.push(...posts.map(p => p.pid));
    page++;
  }
  return all;
}

// ─── Step 2: Extract image URLs from post content ──────────────────────────────
function extractImageUrls(content) {
  const urls = new Set();
  // Markdown: ![alt](URL)
  const md = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
  let m;
  while ((m = md.exec(content))) urls.add(m[1]);

  // ccimg, ccimg2, ccimg3 formats
  const cc = /ccimg(?:2|3)?\|\|\d+\|\|(https?:\/\/\S+?)(?:\|\|\d+)?/g;
  while ((m = cc.exec(content))) {
    let u = m[1].replace(/[.,)]$/, '');  // trim trailing punctuation
    urls.add(u);
  }
  console.log(`Found ${urls.size} image URLs: `, [...urls].slice(0, 10).join(', '));
  return [...urls];
}

// ─── Step 3: Init B2 client & bucket map ───────────────────────────────────────
async function initB2() {
  const b2 = new B2({
    accountId:      B2_ACCOUNT_ID,
    applicationKey: B2_APPLICATION_KEY,
  });
  const auth = await b2.authorize();
  const downloadUrl = auth.data.downloadUrl;

  // build name→ID map
  const buckets = await b2.listBuckets({ accountId: B2_ACCOUNT_ID });
  const map = {};
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
    console.log(`!! skipping ${url} (${u.host})`);
    // skip hosts we don't handle
    return url;
  }

  console.log(`→ ${url} → ${bucketName}/${fileName}`);

  const bucketId = bucketMap[bucketName];
  if (!bucketId) throw new Error(`Bucket "${bucketName}" not found in B2`);

  return;
  // check existence
  const list = await b2Client.listFileNames({
    bucketId,
    prefix:       fileName,
    maxFileCount: 1,
  });
  const exists = list.data.files.some(f => f.fileName === fileName);

  if (!exists) {
    console.log(`→ uploading ${url} → ${bucketName}/${fileName}`);
    const imgRes = await axios.get(url, { responseType: 'arraybuffer' });
    const data   = imgRes.data;
    await b2Client.uploadFile({
      bucketId,
      fileName,
      data: Buffer.from(data),
      // you can pass mime: mime.lookup(fileName) if desired
    });
  }

  // construct new public URL
  return `${downloadUrl}/file/${bucketName}/${encodeURIComponent(fileName)}`;
}

// ─── Step 5: Process one post: migrate its images & rewrite content ──────────
async function processPost(b2Client, downloadUrl, bucketMap, pid) {
  const res     = await api.get(`/posts/${pid}`);
  const post    = res.data.post;
  const content = post.content;
  const urls    = extractImageUrls(content);
  if (urls.length === 0) return;

  let updated = content;
  for (const oldUrl of urls) {
    try {
      const newUrl = await ensureImageOnB2(b2Client, downloadUrl, bucketMap, oldUrl);
      if (newUrl !== oldUrl) {
        updated = updated.split(oldUrl).join(newUrl);
      }
    } catch (err) {
      console.error(`!! error for PID ${pid}, URL ${oldUrl}: ${err.message}`);
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
    console.log('Fetched B2 buckets, ready to go.');

    let pids = await fetchAllPostIds();
    console.log(`Found ${pids.length} posts.`);

    if (1) {
        // testing
        pids = ['6711'];
    }
    for (const pid of pids) {
      await processPost(b2, downloadUrl, bucketNameToId, pid);
    }

    console.log('✅ All done.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Fatal error:', err.response?.data || err.message);
    process.exit(1);
  }
})();
