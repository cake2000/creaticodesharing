export TOKEN="0e9a3c78-2cfb-4e52-b0cb-86c2eb706d81"

curl -s \
  -H "Authorization: Bearer $TOKEN" \
  "https://forum.creaticode.com/api/topics?list=recent&start=0&limit=50"