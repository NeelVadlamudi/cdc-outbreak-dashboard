const root = new URL(`${import.meta.env.BASE_URL}../data/static/`, window.location.origin);
let manifestPromise;
let plansPromise;

async function readJSON(url, cache = 'default') {
  const response = await fetch(url, { cache });
  if (!response.ok) throw new Error(`Published data unavailable (${response.status}). Please retry later.`);
  return response.json();
}

export function getStaticManifest() {
  if (!manifestPromise) {
    manifestPromise = readJSON(new URL('manifest.json', root), 'no-cache').catch(error => {
      manifestPromise = undefined;
      throw error;
    });
  }
  return manifestPromise;
}

export async function readStatic(endpoint) {
  const url = new URL(endpoint, window.location.origin);
  const path = decodeURIComponent(url.pathname);
  const manifest = await getStaticManifest();
  if (path === '/health') {
    const tables = Object.entries(manifest.data_dates).map(([table, as_of]) => ({
      table, as_of, latest_week: as_of, stale: (Date.now() - Date.parse(as_of)) / 86400000 > manifest.stale_after_days,
    }));
    return {
      status: tables.some(table => table.stale) ? 'stale' : 'ok', database: 'ok',
      as_of: manifest.data_date, latest_week: manifest.data_date, checked_at: manifest.built_at,
      tables, stale_tables: tables.filter(table => table.stale).map(table => table.table),
      data_plane: 'static_pages', data_plane_detail: `Published data through ${manifest.data_date}`,
    };
  }
  const params = Object.fromEntries(url.searchParams);
  if (path === '/wastewater/latest' || path === '/wastewater/states') {
    params.dataset ||= 'current';
    if (params.dataset === 'current') params.pathogen ||= 'SARS-CoV-2';
    else delete params.pathogen;
  }
  const query = new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))).toString();
  const key = path + (query ? `?${query}` : '');
  if (manifest.endpoints[key]) return readJSON(new URL(manifest.endpoints[key], root));

  if (!plansPromise) {
    plansPromise = readJSON(new URL(manifest.queries, root)).catch(error => {
      plansPromise = undefined;
      throw error;
    });
  }
  const plans = await plansPromise;
  const county = path.match(/^\/wastewater\/county\/([^/]+)$/);
  const spec = plans[county ? '/wastewater/county/{fips}' : path];
  if (!spec) throw new Error('This read-only view is not in the published data.');
  if (county) params.fips = county[1];
  const values = { ...spec.defaults, ...params };
  for (const name of spec.integers || []) {
    if (!/^[+-]?\d+$/.test(String(values[name]))) throw new Error(`Invalid ${name}`);
    values[name] = Number(values[name]);
    if (!Number.isSafeInteger(values[name]) || values[name] < 0) throw new Error(`Invalid ${name}`);
    if (spec.max_limit && values[name] > spec.max_limit) throw new Error(`Invalid ${name}`);
  }
  const plan = spec.plans.find(candidate =>
    (!candidate.dataset || candidate.dataset === values.dataset) &&
    Object.entries(candidate.present).every(([name, enabled]) => Boolean(values[name]) === enabled));
  if (!plan) throw new Error('Unsupported data filter.');
  const { queryPublicDatabase } = await import('./staticDatabase');
  const data = await queryPublicDatabase(new URL(manifest.database, root), plan.sql,
    plan.bindings.map(name => values[name]));
  return {
    ...plan.meta, data,
    ...(plan.count ? { count: data.length } : {}),
    ...(county ? { county_fips: county[1] } : {}),
  };
}
