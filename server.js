const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');
const mimeTypes = require('mime-types');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const FILE_ROOT = process.env.FILE_ROOT || '/data';
const SERVER_NAME = process.env.SERVER_NAME || 'MT File Manager';

// Body parsers
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ limit: '50mb', type: 'text/plain' }));

// ----- Helpers -----

function safePath(reqPath) {
  // Normalize and resolve the path, prevent directory traversal
  if (!reqPath) return FILE_ROOT;
  const resolved = path.resolve(FILE_ROOT, reqPath.replace(/^\/+/, ''));
  if (!resolved.startsWith(FILE_ROOT)) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

function getTypeIcon(name, isDir) {
  if (isDir) return 'folder';
  const ext = path.extname(name).toLowerCase().replace('.', '');
  const iconMap = {
    // Images
    jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', bmp: 'image',
    svg: 'image', webp: 'image', ico: 'image', tiff: 'image', tif: 'image',
    // Video
    mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', wmv: 'video',
    flv: 'video', webm: 'video', m4v: 'video', '3gp': 'video',
    // Audio
    mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', ogg: 'audio',
    wma: 'audio', m4a: 'audio', opus: 'audio',
    // Archives
    zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive',
    gz: 'archive', bz2: 'archive', xz: 'archive', zst: 'archive',
    // Code
    js: 'code', ts: 'code', py: 'code', java: 'code', c: 'code',
    cpp: 'code', h: 'code', cs: 'code', go: 'code', rs: 'code',
    rb: 'code', php: 'code', swift: 'code', kt: 'code', scala: 'code',
    // Web
    html: 'web', htm: 'web', css: 'web', scss: 'web', less: 'web',
    // Data
    json: 'data', xml: 'data', yaml: 'data', yml: 'data', toml: 'data',
    csv: 'data', sql: 'data', db: 'data', sqlite: 'data',
    // Text
    txt: 'text', md: 'text', log: 'text', cfg: 'text', conf: 'text',
    ini: 'text', env: 'text', properties: 'text', sh: 'text', bash: 'text',
    // Documents
    pdf: 'pdf', doc: 'document', docx: 'document', xls: 'spreadsheet',
    xlsx: 'spreadsheet', ppt: 'presentation', pptx: 'presentation',
    // APK
    apk: 'apk',
    // Executable
    exe: 'executable', msi: 'executable', deb: 'executable', rpm: 'executable',
    // Font
    ttf: 'font', otf: 'font', woff: 'font', woff2: 'font',
  };
  return iconMap[ext] || 'file';
}

function getMimeType(filePath) {
  return mimeTypes.lookup(filePath) || 'application/octet-stream';
}

function getRelativePath(absPath) {
  let rel = path.relative(FILE_ROOT, absPath);
  if (rel === '') return '/';
  return '/' + rel.split(path.sep).join('/');
}

// ----- API Routes -----

// Auth endpoints (always return authenticated)
app.get('/api/auth/status', (req, res) => {
  res.json({ authenticated: true, pairingExpiresInMs: 0 });
});

app.get('/api/auth/session', (req, res) => {
  res.json({ authenticated: true, deviceId: 'web-standalone' });
});

app.post('/api/auth/pair', (req, res) => {
  res.json({ deviceId: 'web-standalone' });
});

app.post('/api/auth/content-ticket', (req, res) => {
  const ticket = crypto.randomBytes(16).toString('hex');
  res.json({ ticket });
});

app.post('/api/auth/archive-ticket', (req, res) => {
  const ticket = crypto.randomBytes(16).toString('hex');
  res.json({ ticket });
});

// Web config
app.get('/api/web-config', (req, res) => {
  res.json({
    name: SERVER_NAME,
    version: '1.0.0',
    language: 'en',
    initialPath: '/',
  });
});

// File listing
app.get('/api/files', async (req, res) => {
  try {
    const reqPath = req.query.path || '/';
    const absPath = safePath(reqPath);

    const entries = await fsp.readdir(absPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      const fullPath = path.join(absPath, entry.name);
      let stat;
      try {
        stat = await fsp.stat(fullPath);
      } catch {
        try {
          stat = await fsp.lstat(fullPath);
        } catch {
          continue; // skip unreadable entries
        }
      }

      const isDir = entry.isDirectory();
      const isSymlink = entry.isSymbolicLink();
      let linkPath = '';
      if (isSymlink) {
        try {
          linkPath = await fsp.readlink(fullPath);
        } catch {}
      }

      files.push({
        name: entry.name,
        path: getRelativePath(fullPath),
        isFile: !isDir,
        isLink: isSymlink,
        linkPath: linkPath,
        size: isDir ? -1 : stat.size,
        time: stat.mtimeMs,
        mime: isDir ? '' : getMimeType(entry.name),
        typeIcon: getTypeIcon(entry.name, isDir),
        permission: 'rwxr-xr-x',
      });
    }

    // Sort
    const sortMethod = req.query.sortMethod || 'name';
    const sortReverse = req.query.sortReverse === 'true';

    files.sort((a, b) => {
      // Directories first
      if (!a.isFile && b.isFile) return -1;
      if (a.isFile && !b.isFile) return 1;

      let cmp = 0;
      switch (sortMethod) {
        case 'name':
          cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
          break;
        case 'size':
          cmp = a.size - b.size;
          break;
        case 'time':
          cmp = a.time - b.time;
          break;
        case 'type':
          cmp = path.extname(a.name).localeCompare(path.extname(b.name));
          break;
        default:
          cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      }

      return sortReverse ? -cmp : cmp;
    });

    res.json({
      path: reqPath,
      files,
    });
  } catch (err) {
    console.error('Error listing files:', err.message);
    res.status(err.code === 'ENOENT' ? 404 : 500).json({
      error: err.message,
    });
  }
});

// File content download
app.get('/api/file-content', async (req, res) => {
  try {
    const reqPath = req.query.path;
    if (!reqPath) return res.status(400).json({ error: 'path required' });

    const absPath = safePath(reqPath);
    const stat = await fsp.stat(absPath);

    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'Cannot download directory' });
    }

    const disposition = req.query.disposition || 'attachment';
    const mime = getMimeType(absPath);
    const filename = path.basename(absPath);

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', stat.size);
    if (disposition === 'attachment') {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    }

    const stream = fs.createReadStream(absPath);
    stream.pipe(res);
  } catch (err) {
    res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: err.message });
  }
});

// File content upload (POST /api/file-content?path=...)
const rawUpload = multer({ storage: multer.memoryStorage() });
app.post('/api/file-content', rawUpload.single('file'), async (req, res) => {
  try {
    const reqPath = req.query.path;
    if (!reqPath) return res.status(400).json({ error: 'path required' });

    const absPath = safePath(reqPath);

    if (req.file) {
      await fsp.writeFile(absPath, req.file.buffer);
    } else if (req.body && typeof req.body === 'string') {
      await fsp.writeFile(absPath, req.body);
    } else {
      // Raw body
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      await new Promise((resolve, reject) => {
        req.on('end', resolve);
        req.on('error', reject);
      });
      await fsp.writeFile(absPath, Buffer.concat(chunks));
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create file/folder
app.post('/api/file-create', async (req, res) => {
  try {
    const { targetPath, name, isDirectory } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const base = safePath(targetPath || '/');
    const fullPath = path.join(base, name);

    // Safety check
    if (!fullPath.startsWith(FILE_ROOT)) {
      return res.status(403).json({ error: 'Path traversal detected' });
    }

    if (isDirectory) {
      await fsp.mkdir(fullPath, { recursive: true });
    } else {
      await fsp.writeFile(fullPath, '');
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rename file
app.post('/api/file-rename', async (req, res) => {
  try {
    const reqPath = req.query.path;
    const newName = req.query.newName;
    if (!reqPath || !newName) {
      return res.status(400).json({ error: 'path and newName required' });
    }

    const absPath = safePath(reqPath);
    const newPath = path.join(path.dirname(absPath), newName);

    if (!newPath.startsWith(FILE_ROOT)) {
      return res.status(403).json({ error: 'Path traversal detected' });
    }

    await fsp.rename(absPath, newPath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// File transfer (move/copy/delete) - synchronous implementation
app.post('/api/file-transfer', async (req, res) => {
  try {
    const { operation, items, targetPath } = req.body;
    const taskId = crypto.randomBytes(8).toString('hex');

    if (operation === 'delete') {
      for (const item of (items || [])) {
        const itemPath = item.itemPath || item.path || item;
        const absPath = safePath(typeof itemPath === 'string' ? itemPath : '');
        const stat = await fsp.stat(absPath);
        if (stat.isDirectory()) {
          await fsp.rm(absPath, { recursive: true, force: true });
        } else {
          await fsp.unlink(absPath);
        }
      }
    } else if (operation === 'move') {
      const target = safePath(targetPath);
      for (const item of (items || [])) {
        const itemPath = item.itemPath || item.path || item;
        const src = safePath(typeof itemPath === 'string' ? itemPath : '');
        const dest = path.join(target, path.basename(src));
        await fsp.rename(src, dest);
      }
    } else if (operation === 'copy') {
      const target = safePath(targetPath);
      for (const item of (items || [])) {
        const itemPath = item.itemPath || item.path || item;
        const src = safePath(typeof itemPath === 'string' ? itemPath : '');
        const dest = path.join(target, path.basename(src));
        await fsp.cp(src, dest, { recursive: true });
      }
    }

    res.json({ taskId, status: 'completed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// File transfer status check
app.get('/api/file-transfer', (req, res) => {
  res.json({ taskId: req.query.taskId, status: 'completed', progress: 1 });
});

app.put('/api/file-transfer', (req, res) => {
  res.json({ success: true });
});

app.delete('/api/file-transfer', (req, res) => {
  res.json({ success: true });
});

// Upload session (simplified - store in memory)
const uploadSessions = new Map();

app.post('/api/file-upload-session', (req, res) => {
  const taskId = crypto.randomBytes(8).toString('hex');
  uploadSessions.set(taskId, { files: [], targetPath: req.body.targetPath || '/' });
  res.json({ taskId });
});

app.get('/api/file-upload-session', (req, res) => {
  const session = uploadSessions.get(req.query.taskId);
  res.json({ taskId: req.query.taskId, status: session ? 'active' : 'unknown' });
});

app.put('/api/file-upload-session', (req, res) => {
  res.json({ success: true });
});

app.delete('/api/file-upload-session', (req, res) => {
  uploadSessions.delete(req.query.taskId);
  res.json({ success: true });
});

app.post('/api/file-upload-prepare', (req, res) => {
  res.json({ success: true });
});

app.post('/api/file-upload-begin', (req, res) => {
  const armToken = crypto.randomBytes(8).toString('hex');
  res.json({ armToken });
});

// Upload content
app.post('/api/file-upload-content', async (req, res) => {
  try {
    const taskId = req.query.taskId;
    const filePath = req.query.path;
    const session = uploadSessions.get(taskId);
    const targetDir = session ? safePath(session.targetPath) : safePath('/');

    const absPath = path.join(targetDir, filePath);
    if (!absPath.startsWith(FILE_ROOT)) {
      return res.status(403).json({ error: 'Path traversal' });
    }

    // Ensure parent directory exists
    await fsp.mkdir(path.dirname(absPath), { recursive: true });

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    await new Promise((resolve, reject) => {
      req.on('end', resolve);
      req.on('error', reject);
    });

    await fsp.writeFile(absPath, Buffer.concat(chunks));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/file-upload-complete', (req, res) => {
  const taskId = req.query.taskId;
  uploadSessions.delete(taskId);
  res.json({ success: true });
});

// File properties
app.post('/api/file-property', async (req, res) => {
  try {
    const { basePath, paths } = req.body;
    const taskId = crypto.randomBytes(8).toString('hex');
    const base = safePath(basePath || '/');
    const results = [];

    for (const p of (paths || [])) {
      const fullPath = path.join(base, p);
      try {
        const stat = await fsp.stat(fullPath);
        results.push({
          path: p,
          size: stat.size,
          lastModified: stat.mtimeMs,
          isDirectory: stat.isDirectory(),
          permission: 'rwxr-xr-x',
        });
      } catch (e) {
        results.push({ path: p, error: e.message });
      }
    }

    res.json({ taskId, status: 'completed', results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/file-property', (req, res) => {
  res.json({ taskId: req.query.taskId, status: 'completed' });
});

app.delete('/api/file-property', (req, res) => {
  res.json({ success: true });
});

// Sort settings
app.get('/api/file-sort', (req, res) => {
  res.json({ enabled: false, method: 'name', reverse: false });
});

app.post('/api/file-sort', (req, res) => {
  res.json({ success: true });
});

app.post('/api/file-sort/folder', (req, res) => {
  res.json({ success: true });
});

// Hidden files
app.get('/api/hidden-files', (req, res) => {
  res.json({
    showSystemHiddenFiles: true,
    showManuallyHiddenFiles: true,
    patterns: [],
  });
});

app.post('/api/hidden-files/settings', (req, res) => {
  res.json({ success: true });
});

app.post('/api/hidden-files/hide-selected', (req, res) => {
  res.json({ success: true });
});

app.post('/api/hidden-files/list', (req, res) => {
  res.json({ success: true });
});

// File icon (return 204 - no custom icons)
app.get('/api/file-icon', (req, res) => {
  res.status(204).end();
});

// Text file read - uses custom binary frame protocol: MTTEXTREAD/1
app.get('/api/text-file', async (req, res) => {
  try {
    const reqPath = req.query.path;
    if (!reqPath) return res.status(400).json({ error: 'path required' });

    const absPath = safePath(reqPath);
    const content = await fsp.readFile(absPath);
    const text = content.toString('utf-8');

    // Detect line break style
    let lineBreak = '\n';
    if (text.includes('\r\n')) lineBreak = '\r\n';
    else if (text.includes('\r')) lineBreak = '\r';

    const metadata = JSON.stringify({
      path: reqPath,
      textFormatType: 'text',
      textFormatName: 'UTF-8',
      charsetIndex: 0,
      availableCharsets: [{ index: 0, name: 'UTF-8' }],
      lineBreak: lineBreak,
      largeFileMode: false,
      canSave: true,
    });

    const metadataBytes = Buffer.from(metadata, 'utf-8');
    const metadataLenStr = String(metadataBytes.length);

    // Build the binary frame: MTTEXTREAD/1\n<len>\n<metadata><text>
    const magic = Buffer.from('MTTEXTREAD/1\n', 'ascii');
    const lenLine = Buffer.from(metadataLenStr + '\n', 'ascii');

    res.setHeader('Content-Type', 'application/octet-stream');
    res.write(magic);
    res.write(lenLine);
    res.write(metadataBytes);
    res.write(content);
    res.end();
  } catch (err) {
    res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: err.message });
  }
});

// Text file write (PUT /api/text-file?path=...&lineBreak=...)
app.put('/api/text-file', async (req, res) => {
  try {
    const reqPath = req.query.path;
    if (!reqPath) return res.status(400).json({ error: 'path required' });

    const absPath = safePath(reqPath);

    // Collect raw body
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    await new Promise((resolve, reject) => {
      req.on('end', resolve);
      req.on('error', reject);
    });
    const body = Buffer.concat(chunks);

    await fsp.writeFile(absPath, body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Also handle POST for text-file (some versions use POST)
app.post('/api/text-file', async (req, res) => {
  try {
    const reqPath = req.query.path || (req.body && req.body.path);
    if (!reqPath) return res.status(400).json({ error: 'path required' });

    const absPath = safePath(reqPath);
    const content = req.body.text || req.body.content || '';

    await fsp.writeFile(absPath, content);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Archive download (zip)
app.get('/api/file-archive', async (req, res) => {
  // Simplified - just return 501 for now, zip requires archiver package
  res.status(501).json({ error: 'Archive download not implemented' });
});

// Devices endpoint
app.delete('/api/auth/devices', (req, res) => {
  res.json({ success: true });
});

// ----- Static files (patched web UI) -----
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`MT File Manager running on port ${PORT}`);
  console.log(`File root: ${FILE_ROOT}`);
  console.log(`Server name: ${SERVER_NAME}`);
});
