// kid-video-add: 接收网页端添加请求，把规范化的一行追加 commit 到 GitHub 仓库的 videos.txt
// 安全模型：X-Add-Key 口令（网页源码可见，防君子不防小人）+ 严格校验（只接受 YouTube 视频 ID，最多追加一行）
const REPO = 'shuyx/kid-videos';
const FILE_PATH = 'videos.txt';
const ALLOWED_ORIGINS = [
  'https://shuyx.github.io',
  'http://localhost:8763',
  'http://localhost:8899',
  'http://127.0.0.1:8763',
  'http://127.0.0.1:8899',
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Add-Key',
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// 从用户输入规范化出一行 videos.txt 内容；非法输入返回 null
function normalizeLine(raw) {
  if (typeof raw !== 'string') return null;
  let line = raw.trim();
  if (!line || line.length > 500) return null;

  // 拆出备注（:: 之后）
  let note = '';
  const noteIdx = line.indexOf('::');
  if (noteIdx >= 0) {
    note = line.slice(noteIdx + 2).trim().replace(/[\r\n]/g, ' ').slice(0, 100);
    line = line.slice(0, noteIdx).trim();
  }

  // 提取 videoId
  const m = line.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
            line.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
            line.match(/\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/) ||
            line.match(/^([A-Za-z0-9_-]{11})$/);
  if (!m) return null;
  const id = m[1];

  // 标签：白名单字符，最多 5 个，单个 ≤20 字
  const tags = (line.match(/#([\p{L}\p{N}_-]{1,20})/gu) || [])
    .slice(0, 5)
    .map(t => '#' + t.slice(1));

  let out = `https://www.youtube.com/watch?v=${id}`;
  if (tags.length) out += ' ' + tags.join(' ');
  if (note) out += ' :: ' + note;
  return { line: out, id };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return json({ error: 'POST only' }, 405, origin);
    }
    if (request.headers.get('X-Add-Key') !== env.ADD_KEY) {
      return json({ error: 'bad key' }, 403, origin);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400, origin); }

    const parsed = normalizeLine(body.line);
    if (!parsed) return json({ error: 'not a YouTube video url' }, 400, origin);

    const ghHeaders = {
      'Authorization': 'Bearer ' + env.GH_TOKEN,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'kid-video-add-worker',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const api = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;

    // 读当前文件
    const cur = await fetch(api, { headers: ghHeaders });
    if (!cur.ok) return json({ error: 'github read failed: ' + cur.status }, 502, origin);
    const curData = await cur.json();
    const text = new TextDecoder().decode(
      Uint8Array.from(atob(curData.content.replace(/\n/g, '')), c => c.charCodeAt(0))
    );

    if (text.includes(parsed.id)) {
      return json({ status: 'exists', id: parsed.id }, 200, origin);
    }

    const newText = (text.endsWith('\n') ? text : text + '\n') + parsed.line + '\n';
    const newContent = btoa(String.fromCharCode(...new TextEncoder().encode(newText)));

    const put = await fetch(api, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `add: ${parsed.id} (web)`,
        content: newContent,
        sha: curData.sha,
        branch: 'main',
      }),
    });
    if (!put.ok) {
      const err = await put.text();
      return json({ error: 'github write failed: ' + put.status, detail: err.slice(0, 200) }, 502, origin);
    }
    return json({ status: 'committed', id: parsed.id, line: parsed.line }, 200, origin);
  },
};
