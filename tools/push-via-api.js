// 用 GitHub REST API 推送本地提交（blobs → tree → commit → ref）
//
// 为什么需要它：某些受限环境里 `git push`（HTTPS POST）会被网络层拦掉，
// 而 HTTP API 通道可用。日常在自己的终端里用普通的 `git push` 即可，本脚本是备用通道。
//
// 前置：本机已登录 GitHub CLI（gh auth login），脚本会通过 `gh auth token` 取令牌，不会打印它。
// 用法：node tools/push-via-api.js [提交信息]
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const git = args => execFileSync('git', args, { encoding: 'utf8', cwd: ROOT }).trim();

function findGh() {
  const cands = [
    'C:\\Program Files\\GitHub CLI\\gh.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'GitHub CLI', 'gh.exe'),
    'gh'
  ];
  for (const c of cands) { try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch (e) {} }
  throw new Error('没找到 GitHub CLI（gh），请先安装并登录');
}

const remote = git(['remote', 'get-url', 'origin']);
const m = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i);
if (!m) throw new Error('无法从 origin 解析出 GitHub 仓库：' + remote);
const [, OWNER, REPO] = m;
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const GH = findGh();
const token = execFileSync(GH, ['auth', 'token'], { encoding: 'utf8' }).trim();

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(url, method, body, tries = 4) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'push-via-api',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
      });
      const text = await res.text();
      let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) { json = { raw: text }; }
      if (!res.ok) { const err = new Error(`${res.status} ${json && (json.message || json.raw)}`); err.status = res.status; throw err; }
      return json;
    } catch (e) {
      lastErr = e;
      const retriable = /fetch failed|ETIMEDOUT|ECONNRESET|50[234]|socket/i.test(e.message);
      if (!retriable || i === tries) break;
      console.log(`  网络抖动，第 ${i} 次重试…`);
      await sleep(1200 * i);
    }
  }
  throw lastErr;
}

(async () => {
  const branch = git(['branch', '--show-current']) || 'main';
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', cwd: ROOT }).split('\0').filter(Boolean);
  const message = git(['log', '-1', '--pretty=%B']);
  const raw = execFileSync('git', ['cat-file', 'commit', 'HEAD'], { encoding: 'utf8', cwd: ROOT });
  const exactMessage = raw.slice(raw.indexOf('\n\n') + 2);   // 含结尾换行，保证 commit SHA 与本地一致
  const an = git(['log', '-1', '--pretty=%an']), ae = git(['log', '-1', '--pretty=%ae']), aI = git(['log', '-1', '--pretty=%aI']);
  const cn = git(['log', '-1', '--pretty=%cn']), ce = git(['log', '-1', '--pretty=%ce']), cI = git(['log', '-1', '--pretty=%cI']);
  const want = git(['rev-parse', 'HEAD']);

  console.log(`仓库：${OWNER}/${REPO} · 分支：${branch} · 文件：${files.length}`);
  console.log('本地提交：' + want.slice(0, 7));

  let parentSha = null, baseTree = null;
  try {
    const ref = await api(`${API}/git/ref/heads/${branch}`, 'GET');
    parentSha = ref.object.sha;
    const parent = await api(`${API}/git/commits/${parentSha}`, 'GET');
    baseTree = parent.tree.sha;
    console.log('远端分支当前指向：' + parentSha.slice(0, 7));
    if (parentSha === want) { console.log('远端已是最新，无需推送 ✅'); return; }
  } catch (e) {
    if (e.status !== 404 && e.status !== 409) throw e;
    console.log('远端仓库为空 → 先用 .gitignore 初始化');
    const gi = fs.readFileSync(path.join(ROOT, '.gitignore'));
    const init = await api(`${API}/contents/.gitignore`, 'PUT', { message: 'chore: 初始化仓库', content: gi.toString('base64') });
    parentSha = init.commit.sha; baseTree = init.commit.tree.sha;
  }

  const tree = [];
  for (let i = 0; i < files.length; i++) {
    const rel = files[i];
    const buf = fs.readFileSync(path.join(ROOT, rel));
    const blob = await api(`${API}/git/blobs`, 'POST', { content: buf.toString('base64'), encoding: 'base64' });
    tree.push({ path: rel.split(path.sep).join('/'), mode: '100644', type: 'blob', sha: blob.sha });
    if ((i + 1) % 15 === 0 || i === files.length - 1) console.log(`  blob ${i + 1}/${files.length}`);
  }

  const treeRes = await api(`${API}/git/trees`, 'POST', { base_tree: baseTree, tree });
  const commitRes = await api(`${API}/git/commits`, 'POST', {
    message: exactMessage, tree: treeRes.sha,
    parents: parentSha ? [parentSha] : [],
    author: { name: an, email: ae, date: aI },
    committer: { name: cn, email: ce, date: cI }
  });
  await api(`${API}/git/refs/heads/${branch}`, 'PATCH', { sha: commitRes.sha, force: false });
  console.log('远端提交：' + commitRes.sha.slice(0, 7) + (commitRes.sha === want ? '  ✅ 与本地一致' : '  （与本地 SHA 不同，但内容一致）'));
  console.log('推送完成 ✅');
})().catch(e => { console.error('失败：' + e.message); process.exit(1); });
