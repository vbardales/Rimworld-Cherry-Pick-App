using System.Text;
using System.Text.Json;

namespace CherryPick;

// Produces a standalone HTML page for browsing a mod's inventory.
//
// The data is EMBEDDED in the page, not loaded alongside it: a file opened over
// file:// cannot fetch another file, the browser blocks it. Images, on the other
// hand, stay file:// paths to the mod's real textures — copying them in as base64
// would make pages tens of megabytes long.
//
// The page itself stays in French: it is an interface, like the web one.
public static class Viewer
{
    public static string Render(Inventory inv, JsonSerializerOptions json)
    {
        var mod = inv.Mods.FirstOrDefault() ?? new ModInfo();

        // Only what the page displays is sent to it.
        var rows = inv.Defs.Select(d => new
        {
            key = d.Key,
            type = d.DefType,
            defName = d.DefName ?? d.AbstractName,
            label = d.Display,
            isAbstract = d.IsAbstract,
            parent = d.ParentName,
            tech = d.TechLevel,
            techFrom = d.TechLevelFrom,
            archi = d.ArchitectCategory,
            archiFrom = d.ArchitectCategoryFrom,
            research = d.Refs.Research,
            classes = d.Refs.Classes,
            mayRequire = d.MayRequire,
            file = d.File,
            thumb = ToFileUrl(TextureResolver.Thumb(d)),
            texCount = d.TextureFiles.Count,
            missingTex = d.MissingTextures,
        }).ToList();

        var payload = JsonSerializer.Serialize(new
        {
            mod = new
            {
                name = mod.Name,
                packageId = mod.PackageId,
                versions = mod.SupportedVersions,
                dead = mod.DeadBefore16,
                deps = mod.DeclaredDependencies,
                path = mod.Path,
            },
            defs = rows,
            patches = inv.Patches,
            problems = inv.Problems,
        }, json);

        return Html.Replace("/*DATA*/", payload);
    }

    static string? ToFileUrl(string? path)
    {
        if (path is null) return null;
        var p = path.Replace('\\', '/');
        // Uri.EscapeDataString would eat the separators; only what really gets in
        // the way inside a Windows path is encoded.
        p = p.Replace("%", "%25").Replace("#", "%23").Replace("?", "%3F").Replace(" ", "%20");
        return "file:///" + p;
    }

    const string Html = """
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>cherrypick</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#1b1b1b; --dim:#666; --line:#dcdcdc; --accent:#2f6f4f; --warn:#8a5a00; --bad:#a33; --panel:#f6f6f6; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16181a; --fg:#e6e6e6; --dim:#9aa0a6; --line:#33383d; --accent:#7bc39a; --warn:#e0a94a; --bad:#e08585; --panel:#1e2124; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.45 "Segoe UI",system-ui,sans-serif; background:var(--bg); color:var(--fg); }
  header { position:sticky; top:0; background:var(--panel); border-bottom:1px solid var(--line); padding:12px 16px; z-index:2; }
  h1 { margin:0 0 2px; font-size:17px; font-weight:600; }
  .meta { color:var(--dim); font-size:12.5px; }
  .tag { display:inline-block; padding:1px 7px; border:1px solid var(--line); border-radius:10px; margin-right:5px; font-size:11.5px; }
  .tag.dead { color:var(--bad); border-color:var(--bad); }
  .bar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:9px; }
  input[type=search], select { padding:5px 8px; border:1px solid var(--line); border-radius:5px; background:var(--bg); color:var(--fg); font:inherit; }
  input[type=search] { min-width:230px; }
  button { padding:5px 11px; border:1px solid var(--line); border-radius:5px; background:var(--bg); color:var(--fg); font:inherit; cursor:pointer; }
  button:hover { border-color:var(--accent); }
  main { padding:14px 16px 60px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim); margin:22px 0 7px; font-weight:600; }
  table { border-collapse:collapse; width:100%; }
  td { border-bottom:1px solid var(--line); padding:5px 8px; vertical-align:middle; }
  tr:hover td { background:var(--panel); }
  td.pic { width:44px; padding:3px; }
  img { width:38px; height:38px; object-fit:contain; image-rendering:pixelated; display:block; }
  .noimg { width:38px; height:38px; border:1px dashed var(--line); border-radius:4px; }
  .name { font-weight:600; }
  .sub { color:var(--dim); font-size:12px; }
  .col { color:var(--dim); font-size:12.5px; white-space:nowrap; }
  .miss { color:var(--bad); font-size:12px; }
  .inh { opacity:.65; font-style:italic; }
  footer { position:fixed; bottom:0; left:0; right:0; background:var(--panel); border-top:1px solid var(--line); padding:8px 16px; display:flex; gap:12px; align-items:center; }
  .count { font-variant-numeric:tabular-nums; }
  pre { background:var(--panel); padding:10px; border-radius:6px; overflow:auto; font-size:12px; }
</style>
</head>
<body>
<header>
  <h1 id="modname"></h1>
  <div class="meta" id="modmeta"></div>
  <div class="bar">
    <input type="search" id="q" placeholder="filtrer par nom, defName, recherche...">
    <select id="type"><option value="">tous les types</option></select>
    <select id="tech"><option value="">tous les niveaux</option></select>
    <label class="col"><input type="checkbox" id="hideabs" checked> masquer les defs abstraites</label>
    <label class="col"><input type="checkbox" id="onlymiss"> seulement les textures manquantes</label>
  </div>
</header>
<main id="out"></main>
<footer>
  <span class="count" id="tally"></span>
  <button id="all">tout cocher (filtre courant)</button>
  <button id="none">tout decocher</button>
  <button id="export">exporter la selection</button>
</footer>
<script>
const DATA = /*DATA*/;
const picked = new Set();

const el = (t,c,x) => { const n=document.createElement(t); if(c)n.className=c; if(x!=null)n.textContent=x; return n; };

function init() {
  const m = DATA.mod;
  document.getElementById('modname').textContent = m.name || '(sans nom)';
  const bits = [];
  if (m.packageId) bits.push(m.packageId);
  if (m.versions && m.versions.length) bits.push(m.versions.join(' '));
  document.getElementById('modmeta').innerHTML =
    (m.dead ? '<span class="tag dead">mort avant 1.6</span>' : '') +
    bits.map(b => '<span class="tag">'+b+'</span>').join('') +
    (m.deps && m.deps.length ? '<div style="margin-top:5px">dependances declarees : '+m.deps.join(', ')+'</div>' : '');

  fill('type', [...new Set(DATA.defs.map(d => d.type))].sort());
  fill('tech', [...new Set(DATA.defs.map(d => d.tech).filter(Boolean))].sort());
  ['q','type','tech','hideabs','onlymiss'].forEach(id =>
    document.getElementById(id).addEventListener('input', render));
  document.getElementById('all').onclick = () => { visible().forEach(d => picked.add(d.key)); render(); };
  document.getElementById('none').onclick = () => { picked.clear(); render(); };
  document.getElementById('export').onclick = exportPick;
  render();
}

function fill(id, values) {
  const s = document.getElementById(id);
  for (const v of values) s.appendChild(new Option(v, v));
}

function visible() {
  const q = document.getElementById('q').value.trim().toLowerCase();
  const type = document.getElementById('type').value;
  const tech = document.getElementById('tech').value;
  const hideabs = document.getElementById('hideabs').checked;
  const onlymiss = document.getElementById('onlymiss').checked;
  return DATA.defs.filter(d => {
    if (hideabs && d.isAbstract) return false;
    if (type && d.type !== type) return false;
    if (tech && d.tech !== tech) return false;
    if (onlymiss && !(d.missingTex && d.missingTex.length)) return false;
    if (!q) return true;
    const hay = [d.label, d.defName, d.type, d.archi, (d.research||[]).join(' ')].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function render() {
  const out = document.getElementById('out');
  out.textContent = '';
  const rows = visible();

  const byType = new Map();
  for (const d of rows) { if (!byType.has(d.type)) byType.set(d.type, []); byType.get(d.type).push(d); }

  for (const [type, list] of [...byType].sort((a,b) => b[1].length - a[1].length)) {
    out.appendChild(el('h2', null, type + '  (' + list.length + ')'));
    const table = el('table'); const tb = el('tbody');
    for (const d of list) tb.appendChild(row(d));
    table.appendChild(tb); out.appendChild(table);
  }

  if (DATA.problems && DATA.problems.length) {
    out.appendChild(el('h2', null, 'problemes de lecture'));
    out.appendChild(el('pre', null, DATA.problems.join('\n')));
  }

  document.getElementById('tally').textContent =
    rows.length + ' defs affichees sur ' + DATA.defs.length + '  —  ' + picked.size + ' cochees';
}

function row(d) {
  const tr = el('tr');

  const cb = el('td'); const box = document.createElement('input');
  box.type = 'checkbox'; box.checked = picked.has(d.key);
  box.onchange = () => { box.checked ? picked.add(d.key) : picked.delete(d.key); tally(); };
  cb.appendChild(box); tr.appendChild(cb);

  const pic = el('td','pic');
  if (d.thumb) { const i = document.createElement('img'); i.src = d.thumb; i.loading='lazy'; i.alt=''; pic.appendChild(i); }
  else pic.appendChild(el('div','noimg'));
  tr.appendChild(pic);

  const name = el('td');
  name.appendChild(el('div','name', d.label));
  const sub = el('div','sub', d.defName + (d.parent ? '  <  ' + d.parent : ''));
  name.appendChild(sub);
  if (d.missingTex && d.missingTex.length)
    name.appendChild(el('div','miss', 'texture introuvable : ' + d.missingTex.join(', ')));
  tr.appendChild(name);

  tr.appendChild(cell(d.tech, d.techFrom));
  tr.appendChild(cell(d.archi, d.archiFrom));

  const res = el('td','col', (d.research||[]).join(', '));
  tr.appendChild(res);
  return tr;
}

// An inherited value is shown set back: it does not come from the def itself.
function cell(value, from) {
  const td = el('td','col');
  if (!value) { td.textContent = ''; return td; }
  td.appendChild(el('span', from ? 'inh' : null, value));
  if (from) td.appendChild(el('div','sub', '< ' + from));
  return td;
}

function tally() {
  document.getElementById('tally').textContent =
    visible().length + ' defs affichees sur ' + DATA.defs.length + '  —  ' + picked.size + ' cochees';
}

function exportPick() {
  const sel = DATA.defs.filter(d => picked.has(d.key));
  const doc = { mod: DATA.mod.packageId, path: DATA.mod.path, picked: sel.map(d => d.key) };
  const blob = new Blob([JSON.stringify(doc, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'pick.json'; a.click();
}

init();
</script>
</body>
</html>
""";
}
