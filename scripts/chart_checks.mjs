import assert from 'node:assert/strict';

export function assertNoBrowserErrors(errors) {
  assert.deepEqual(errors, [], `Browser errors: ${errors.join(' | ')}`);
}

export function assertChartSnapshots(charts, { minimum = 1, titles = [], map = false } = {}) {
  assert.ok(charts.length >= minimum, `Expected at least ${minimum} charts, found ${charts.length}`);
  for (const [index, chart] of charts.entries()) {
    assert.ok(chart.svg && chart.marks > 0 && chart.hasData, `Blank chart ${index}: ${JSON.stringify(chart)}`);
    assert.deepEqual(chart.stringTitles, [], `String titles in chart ${index}`);
    for (const title of chart.declaredTitles) {
      assert.ok(chart.renderedText.includes(title), `Declared chart title not rendered: ${title}`);
    }
  }
  const rendered = charts.flatMap(chart => chart.renderedText);
  for (const title of titles) assert.ok(rendered.includes(title), `Expected chart title not rendered: ${title}`);
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
      svg: Boolean(node.querySelector('.main-svg')),
      marks: paths.filter(validPath).length + images.length,
      mapPaths: [...node.querySelectorAll('.choroplethlayer path.choroplethlocation')].filter(validPath).length,
      hasData,
      stringTitles: inputTitles.filter(title => typeof title === 'string'),
      declaredTitles: inputTitles.map(title => title.text).filter(Boolean),
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

export async function hoverChart(page) {
  for (const selector of ['.scatterlayer .points path.point', '.barlayer .point path', '.choroplethlayer path.choroplethlocation']) {
    const marks = page.locator(selector);
    for (let index = 0; index < Math.min(await marks.count(), 4); index++) {
      const mark = marks.nth(index);
      await mark.scrollIntoViewIfNeeded();
      await mark.hover({ force: true });
      try {
        await page.waitForFunction(() => [...document.querySelectorAll('.hoverlayer text')].some(text => text.textContent.trim()),
          null, { timeout: 1500 });
        const text = (await page.locator('.hoverlayer text').allTextContents()).map(value => value.trim()).filter(Boolean);
        assert.ok(text.length, 'Hover labels must contain text');
        return { selector, text };
      } catch { /* Another data mark may be a disconnected geographic fragment. */ }
    }
  }
  throw new Error('A real pointer hover did not produce a chart hover label');
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
