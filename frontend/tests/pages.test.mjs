import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { createStaticServer, siteFiles, projectPath } from '../tools/static-site.mjs';
import { parseHtml, elements } from './html-fixture.mjs';

test('Pages artifact contains only public files; all assets load under root and project path', async t => {
  const build = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/build-pages.mjs', import.meta.url))], { encoding: 'utf8', windowsHide: true });
  assert.equal(build.status, 0, build.stderr);
  const root = new URL('../dist/', import.meta.url);
  // Independent expected manifest: an accidental publication-boundary change fails.
  assert.deepEqual((await readdir(root)).sort(), [
    'app.js', 'brightness.js', 'color-bar.js', 'config.js', 'epochs.js',
    'index.html', 'styles.css', 'wcs-axes.js',
  ]);
  for (const file of siteFiles) {
    assert.deepEqual(await readFile(new URL(file, root)), await readFile(new URL(`../${file}`, import.meta.url)));
    if (file.endsWith('.js')) new vm.Script(await readFile(new URL(file, root), 'utf8'), { filename: file });
  }
  const server = createStaticServer(fileURLToPath(root));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const prefix of ['/', projectPath]) {
    const page = new URL(prefix, origin);
    const response = await fetch(page);
    assert.equal(response.status, 200);
    const html = await response.text();
    const links = elements(parseHtml(html), node => node.tag === 'a');
    assert.doesNotMatch(html, /<base\b/i);
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
    assert.ok(assets.includes('./epochs.js'));
    assert.ok(assets.indexOf('./config.js') < assets.indexOf('./app.js'));
    for (const asset of assets) {
      if (['https://spherex.caltech.edu', 'https://irsa.ipac.caltech.edu/Missions/spherex.html'].includes(asset)) {
        const link = links.find(node => node.attrs.href === asset);
        assert.equal(link?.attrs.target, '_blank');
        const rel = new Set(link.attrs.rel?.split(/\s+/));
        assert.ok(rel.has('noopener') && rel.has('noreferrer'));
        continue; // Official navigation links are never fetched offline.
      }
      if (asset === 'https://caltech-ipac.github.io/irsa-tutorials/spherex-intro/') {
        const link = links.find(node => node.attrs.href === asset);
        assert.equal(link?.attrs.target, '_blank');
        assert.ok(link.attrs.rel?.split(/\s+/).includes('noopener'));
        continue; // Documentation link, never fetched by this offline test.
      }
      assert.ok(asset.startsWith('./'), `Asset must be relative: ${asset}`);
      const url = new URL(asset, page);
      assert.ok(url.pathname.startsWith(prefix));
      const result = await fetch(url);
      assert.equal(result.status, 200, url.href);
      assert.match(result.headers.get('content-type'), asset.endsWith('.js') ? /javascript/ : asset.endsWith('.css') ? /css/ : /html/);
    }
  }
  const css = await readFile(new URL('styles.css', root), 'utf8');
  // Currently no secondary CSS assets; fail if this changes so coverage is extended.
  assert.doesNotMatch(css, /url\s*\(|@import/i);
  for (const file of siteFiles.filter(file => file.endsWith('.js'))) {
    assert.doesNotMatch(await readFile(new URL(file, root), 'utf8'), /\bimport\s*(?:\(|[{'"*])/);
  }
  for (const path of ['tools/serve.mjs', 'tools/epochs-fixture.mjs', 'tests/app.test.mjs', 'backend/app/main.py', 'research/outputs/metadata.json', '.env']) {
    assert.equal((await fetch(`${origin}${projectPath}${path}`)).status, 404);
  }
  const redirect = await fetch(`${origin}/planet-x-spherex`, { redirect: 'manual' });
  assert.equal(redirect.status, 301); assert.equal(redirect.headers.get('location'), projectPath);
  const config = { window: {} };
  vm.runInNewContext(await readFile(new URL('config.js', root), 'utf8'), config);
  assert.equal(config.window.SPHEREX_CONFIG.renderApiBase, 'https://planet-x-spherex.onrender.com');
});
