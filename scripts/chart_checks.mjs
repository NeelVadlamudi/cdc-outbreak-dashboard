import assert from 'node:assert/strict';

export function assertNoBrowserErrors(errors) {
  assert.deepEqual(errors, [], `Browser errors: ${errors.join(' | ')}`);
}

export function assertChartSnapshots(charts, { minimum = 1, titlesById = {}, optionalIds = [], map = false } = {}) {
  assert.ok(charts.length >= minimum, `Expected at least ${minimum} charts, found ${charts.length}`);
  const ids = new Set();
  for (const [index, chart] of charts.entries()) {
    assert.ok(chart.svg && chart.marks > 0 && chart.hasData, `Blank chart ${index}: ${JSON.stringify(chart)}`);
    assert.ok(chart.id && !ids.has(chart.id), `Missing or duplicate chart container ID: ${chart.id}`);
    ids.add(chart.id);
    assert.deepEqual(chart.stringTitles, [], `String titles in ${chart.id}`);
    for (const title of chart.declaredTitles) {
      assert.ok(chart.renderedTitles.includes(title), `Declared chart title not rendered in ${chart.id}: ${title}`);
    }
    if (Object.keys(titlesById).length) {
      assert.ok(Object.hasOwn(titlesById, chart.id), `Unexpected chart container: ${chart.id}`);
      for (const title of titlesById[chart.id]) {
        assert.ok(chart.declaredTitles.includes(title), `Missing title declaration in ${chart.id}: ${title}`);
        assert.ok(chart.renderedTitles.includes(title), `Expected chart title not rendered in ${chart.id}: ${title}`);
      }
    }
  }
  for (const id of Object.keys(titlesById)) {
    if (!optionalIds.includes(id)) assert.ok(ids.has(id), `Missing required chart container: ${id}`);
  }
  if (map) assert.ok(charts.some(chart => chart.mapPaths > 0), 'Geographic data paths did not render');
}

export async function inspectCharts(page) {
  return page.locator('.js-plotly-plot').evaluateAll(nodes => nodes.map(node => {
    const paths = [...node.querySelectorAll('.scatterlayer path.js-line, .scatterlayer path.point, .barlayer .point path, .choroplethlayer path.choroplethlocation')];
    const validPath = path => {
      const d = path.getAttribute('d') || '';
      const box = path.getBBox();
      return d.length > 5 && !/NaN|Infinity/.test(d) && (box.width > 0 || box.height > 0);
    };
    const images = [...node.querySelectorAll('.heatmaplayer image, .hm image')].filter(image =>
      (image.getAttribute('href') || image.getAttribute('xlink:href') || '').startsWith('data:image/') &&
      Number(image.getAttribute('width')) > 0 && Number(image.getAttribute('height')) > 0);
    const inputTitles = [node.layout?.title,
      ...Object.entries(node.layout || {}).filter(([key]) => /^[xyz]axis\d*$/.test(key)).map(([, axis]) => axis.title),
      ...(node.data || []).map(trace => trace.colorbar?.title),
    ].filter(Boolean);
    const hasData = (node.data || []).some(trace => {
      if (trace.visible === false || trace.visible === 'legendonly') return false;
      const values = trace.type === 'choropleth' || trace.type === 'heatmap' ? trace.z : trace.y || trace.x;
      return Array.isArray(values) && values.flat().some(value => value !== null && value !== undefined && value !== '');
    });
    return {
      id: node.id,
      svg: Boolean(node.querySelector('.main-svg')),
      marks: paths.filter(validPath).length + images.length,
      mapPaths: [...node.querySelectorAll('.choroplethlayer path.choroplethlocation')].filter(validPath).length,
      hasData,
      stringTitles: inputTitles.filter(title => typeof title === 'string'),
      declaredTitles: inputTitles.map(title => title.text).filter(Boolean),
      renderedTitles: [...node.querySelectorAll('text')].filter(text =>
        text.closest('.cbtitle') || [...text.classList].some(name => /^(gtitle|[xyz]\d*title)$/.test(name)))
        .map(text => text.textContent.trim()),
      renderedText: [...node.querySelectorAll('text')].map(text => text.textContent.trim()),
      types: (node.data || []).map(trace => trace.type || 'scatter'),
      xaxisType: node._fullLayout?.xaxis?.type,
      samples: (node.data || []).map(trace => ({ x: trace.x?.slice(0, 3), y: trace.y?.slice(0, 3) })),
      pathSamples: paths.slice(0, 3).map(path => path.getAttribute('d')),
    };
  }));
}

export async function assertRenderedCharts(page, expected) {
  await page.waitForFunction(minimum => document.querySelectorAll('.js-plotly-plot .main-svg').length >= minimum,
    expected.minimum || 1, { timeout: 15000 });
  const charts = await inspectCharts(page);
  assertChartSnapshots(charts, expected);
  return charts;
}

export async function hoverChart(page, id, { timeout = 1500 } = {}) {
  assert.match(id, /^[a-z][a-z0-9-]*$/, 'A stable chart container ID is required');
  const chart = page.locator(`[id="${id}"]`);
  assert.equal(await chart.count(), 1, `Missing chart container: ${id}`);
  await chart.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await page.waitForFunction(id => ![...document.getElementById(id).querySelectorAll('.hoverlayer text')]
    .some(text => text.textContent.trim()), id, { timeout });
  const readHover = async selector => {
    await page.waitForFunction(id => [...document.getElementById(id).querySelectorAll('.hoverlayer text')]
      .some(text => text.textContent.trim()), id, { timeout });
    const text = (await chart.locator('.hoverlayer text').allTextContents()).map(value => value.trim()).filter(Boolean);
    assert.ok(text.length, `Hover labels must contain text in ${id}`);
    return { id, selector, text };
  };
  for (const selector of ['.scatterlayer .points path.point', '.barlayer .point path', '.choroplethlayer path.choroplethlocation', '.scatterlayer path.js-line']) {
    const marks = chart.locator(selector);
    for (let index = 0; index < Math.min(await marks.count(), 4); index++) {
      const mark = marks.nth(index);
      try {
        await mark.scrollIntoViewIfNeeded();
        if (selector.endsWith('path.js-line')) {
          const point = await mark.evaluate(path => {
            const matrix = path.getScreenCTM();
            const local = path.getPointAtLength(path.getTotalLength() * 0.01);
            return { x: local.x * matrix.a + local.y * matrix.c + matrix.e,
              y: local.x * matrix.b + local.y * matrix.d + matrix.f };
          });
          await page.mouse.move(point.x, point.y);
        } else await mark.hover({ force: true });
        return await readHover(selector);
      } catch { /* Try another actual data mark in this same chart. */ }
    }
  }
  const images = chart.locator('.heatmaplayer image, .hm image');
  for (let index = 0; index < await images.count(); index++) {
    await images.nth(index).scrollIntoViewIfNeeded();
    const box = await images.nth(index).boundingBox();
    if (!box) continue;
    for (const x of [0.1, 0.5, 0.9]) for (const y of [0.1, 0.5, 0.9]) {
      try {
        await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
        return await readHover('heatmap cell');
      } catch { /* Empty heatmap cells have no label. */ }
    }
  }
  throw new Error(`A real pointer hover did not produce a chart hover label in ${id}`);
}

export async function inspectGlobe(page) {
  const canvas = page.locator('#globe-container canvas');
  await canvas.waitFor({ state: 'visible' });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const screenshot = await canvas.screenshot();
  const pixels = await page.evaluate(async png => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const surface = document.createElement('canvas');
    surface.width = image.width;
    surface.height = image.height;
    const context = surface.getContext('2d');
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    const colors = new Set();
    for (let index = 0; index < data.length; index += 16) {
      if (data[index + 3]) colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
    }
    return { width: image.width, height: image.height, colors: colors.size };
  }, screenshot.toString('base64'));
  assert.ok(pixels.width > 0 && pixels.height > 0 && pixels.colors > 16, 'Globe canvas is blank');
  return pixels;
}
