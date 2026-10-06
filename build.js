// Fetches recent recalls from the U.S. Consumer Product Safety Commission (CPSC) and
// builds a static site into dist/. Runs on Netlify at deploy time: node build.js
// If the data can't be fetched, the build fails on purpose so the last good site stays live.
const fs = require('fs');
const site = JSON.parse(fs.readFileSync('site.json', 'utf8'));
const OUT = 'dist';

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const names = arr => (Array.isArray(arr) ? arr : []).map(x => (x && (x.Name || x.Option) || '').trim()).filter(Boolean);
const paras = list => list.map(t => `<p>${esc(t).replace(/\n+/g, '<br>')}</p>`).join('\n');
const safeUrl = u => /^https:\/\/(www\.)?cpsc\.gov\//.test(u || '') ? u : '';
const niceDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

async function load() {
  if (process.env.RECALLS_FILE) return JSON.parse(fs.readFileSync(process.env.RECALLS_FILE, 'utf8'));
  const start = new Date(Date.now() - site.days * 864e5).toISOString().slice(0, 10);
  const url = `https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=${start}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'RecallRoundup/1.0', Accept: 'application/json' } });
  if (!res.ok) throw new Error(`CPSC API returned ${res.status}`);
  return res.json();
}

const page = (path, title, desc, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${site.verification ? `<meta name="google-site-verification" content="${esc(site.verification)}" />\n` : ''}${site.url ? `<link rel="canonical" href="${site.url}${path}">\n` : ''}<link rel="stylesheet" href="/style.css">
</head>
<body>
<header><a href="/">${esc(site.name)}</a></header>
<main>
${body}
</main>
<footer>Recall information comes from the U.S. Consumer Product Safety Commission (CPSC). This site is not affiliated with the CPSC. Always confirm details on the official notice.</footer>
</body>
</html>
`;

const write = (path, html) => {
  const file = `${OUT}${path === '/' ? '/index' : path}.html`;
  fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true });
  fs.writeFileSync(file, html);
};

(async () => {
  const raw = await load();
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('CPSC API returned no recalls; keeping the previous site.');

  const recalls = raw.filter(r => r && r.RecallNumber && r.Title && r.RecallDate).map(r => {
    const products = (r.Products || []).filter(p => p && p.Name);
    return {
      number: String(r.RecallNumber),
      date: String(r.RecallDate).slice(0, 10),
      title: r.Title.trim(),
      product: products[0] ? products[0].Name.trim() : r.Title.trim(),
      units: products.map(p => p.NumberOfUnits).filter(Boolean).join('; '),
      category: (products[0] && products[0].Type || '').trim() || 'Other products',
      description: (r.Description || '').trim(),
      hazards: names(r.Hazards), remedies: names(r.Remedies), options: names(r.RemedyOptions),
      injuries: names(r.Injuries), sold: names(r.Retailers),
      contact: (r.ConsumerContact || '').trim(),
      url: safeUrl(r.URL),
      images: (r.Images || []).map(i => ({ url: safeUrl(i && i.URL), caption: i && i.Caption && !/^https?:/.test(i.Caption) ? i.Caption : '' })).filter(i => i.url).slice(0, 4),
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  if (recalls.length === 0) throw new Error(`No usable recall records; keeping the previous site. got ${raw.length} raw; first keys: ${Object.keys(raw[0] || {}).join(',')}; sample: ${JSON.stringify(raw[0]).slice(0, 600)}`);
  for (const r of recalls) r.path = `/recall/${slugify(r.number)}-${slugify(r.product)}`;

  const cats = {};
  for (const r of recalls) (cats[r.category] = cats[r.category] || []).push(r);
  const catPath = c => `/category/${slugify(c)}`;
  const row = r => `<li><a href="${r.path}">${esc(r.product)}</a><span>${niceDate(r.date)} · ${esc(r.hazards[0] ? r.hazards[0].slice(0, 140) + (r.hazards[0].length > 140 ? '…' : '') : r.category)}</span></li>`;

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync('style.css', `${OUT}/style.css`);

  for (const r of recalls) {
    write(r.path, page(r.path, `${r.product} Recall (${niceDate(r.date)}): What to Do`, (r.hazards[0] || r.title).slice(0, 155), `<p class="meta">Recalled ${niceDate(r.date)} · CPSC recall #${esc(r.number)} · <a href="${catPath(r.category)}">${esc(r.category)}</a></p>
<h1>${esc(r.product)} recall</h1>
<p><strong>${esc(r.title)}</strong></p>
<div class="box">
<h2>What to do</h2>
${r.remedies.length ? paras(r.remedies) : '<p>See the official notice for instructions.</p>'}
${r.options.length ? `<p><strong>Remedy offered:</strong> ${esc(r.options.join(', '))}</p>` : ''}
${r.contact ? `<p><strong>Contact:</strong> ${esc(r.contact)}</p>` : ''}
</div>
<h2>The hazard</h2>
${r.hazards.length ? paras(r.hazards) : '<p>See the official notice.</p>'}
${r.injuries.length ? `<p><strong>Injuries reported:</strong> ${esc(r.injuries.join(' '))}</p>` : ''}
<h2>Which products</h2>
${r.description ? paras([r.description]) : ''}
${r.units ? `<p><strong>Units:</strong> ${esc(r.units)}</p>` : ''}
${r.images.map(i => `<img src="${esc(i.url)}" alt="${esc(i.caption || r.product)}" loading="lazy">`).join('\n')}
${r.sold.length ? `<h2>Where it was sold</h2>\n${paras(r.sold)}` : ''}
${r.url ? `<p><a href="${esc(r.url)}" rel="nofollow">Read the official CPSC notice</a></p>` : ''}`));
  }

  for (const [c, list] of Object.entries(cats)) {
    write(catPath(c), page(catPath(c), `${c} Recalls: Latest List`, `Recent U.S. recalls of ${c.toLowerCase()}, with what to do for each one.`, `<h1>${esc(c)} recalls</h1>
<p>${list.length} recall${list.length === 1 ? '' : 's'} in the last ${site.days} days.</p>
<ul class="list">
${list.map(row).join('\n')}
</ul>`));
  }

  const updated = niceDate(new Date().toISOString().slice(0, 10));
  write('/', page('/', `${site.name}: Latest U.S. Product Recalls in Plain View`, 'The latest U.S. consumer product recalls: what was recalled, why, and exactly what to do. Updated daily from official CPSC data.', `<h1>Latest product recalls</h1>
<p>${recalls.length} U.S. consumer product recalls from the last ${site.days} days. Each page tells you the hazard and what to do.</p>
<p class="meta">Updated ${updated}</p>
<ul class="list">
${recalls.slice(0, 40).map(row).join('\n')}
</ul>
<h2>Browse by product type</h2>
<ul class="list">
${Object.keys(cats).sort().map(c => `<li><a href="${catPath(c)}">${esc(c)}</a><span>${cats[c].length} recall${cats[c].length === 1 ? '' : 's'}</span></li>`).join('\n')}
</ul>`));

  if (site.url) {
    const paths = ['/', ...Object.keys(cats).map(catPath), ...recalls.map(r => r.path)];
    fs.writeFileSync(`${OUT}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map(p => `<url><loc>${site.url}${p === '/' ? '/' : p}</loc></url>`).join('\n')}\n</urlset>\n`);
    fs.writeFileSync(`${OUT}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${site.url}/sitemap.xml\n`);
  }
  console.log(`Built ${recalls.length} recall pages in ${Object.keys(cats).length} categories.`);
})().catch(e => {
  const detail = [`BUILD FAILED: ${e.message}`, `cause: ${e.cause ? (e.cause.code || '') + ' ' + e.cause.message : 'none'}`, `node: ${process.version}`, `time: ${new Date().toISOString()}`].join('\n');
  console.error(detail);
  // TEMPORARY diagnostic: if no site has ever been published, publish the error so it can be read remotely.
  if (process.env.DIAG_ON_FAIL === '1' && !fs.existsSync(`${OUT}/index.html`)) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(`${OUT}/debug.txt`, detail + '\n');
    fs.writeFileSync(`${OUT}/index.html`, '<!doctype html><title>Recall Roundup</title><p>Setting up. Check back soon.</p>');
    process.exit(0);
  }
  process.exit(1);
});
