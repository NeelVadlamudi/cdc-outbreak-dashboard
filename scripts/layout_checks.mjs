import assert from 'node:assert/strict';

export function assertMobileLayout(layout) {
  assert.deepEqual(layout.outsideViewport, [], `Elements extend past the viewport: ${JSON.stringify(layout.outsideViewport)}`);
  assert.deepEqual(layout.wideContainers, [], `Main containers conceal overflow: ${JSON.stringify(layout.wideContainers)}`);
  assert.deepEqual(layout.overflowingElements, [], `Elements conceal horizontal content: ${JSON.stringify(layout.overflowingElements)}`);
  assert.deepEqual(layout.invalidScrollports, [], `Marked elements are not usable horizontal scrollports: ${JSON.stringify(layout.invalidScrollports)}`);
}

export async function inspectMobileLayout(page) {
  return page.evaluate(() => {
    const width = innerWidth;
    const identify = node => node.id ? `#${node.id}` : `${node.tagName.toLowerCase()}.${String(node.getAttribute('class') || '').trim().replaceAll(' ', '.')}`;
    const isShown = node => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    // Internal SVG text/path dimensions describe transformed geometry, not CSS scroll boxes.
    // Inspect every HTML element and root SVG, including nested badges and table wrappers.
    const elements = [...document.querySelectorAll('*')]
      .filter(node => node instanceof HTMLElement || node instanceof SVGSVGElement).filter(isShown);
    const scrollports = new Map();
    const invalidScrollports = [];
    for (const node of elements.filter(node => node.hasAttribute('data-scroll-x'))) {
      const overflowX = getComputedStyle(node).overflowX;
      const box = node.getBoundingClientRect();
      const before = node.scrollLeft;
      node.scrollLeft = node.scrollWidth - node.clientWidth;
      const reached = node.scrollLeft;
      node.scrollLeft = before;
      const detail = { element: identify(node), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, overflowX, reached };
      if (/^(auto|scroll)$/.test(overflowX) && node.scrollWidth > node.clientWidth + 1 && reached > 0 && box.left >= 0 && box.right <= width + 1) {
        scrollports.set(node, detail);
      } else invalidScrollports.push(detail);
    }
    const outsideViewport = [];
    const containedByScrollport = [];
    const overflowingElements = [];
    for (const node of elements) {
      if (node.scrollWidth > node.clientWidth + 1 && !scrollports.has(node)) {
        overflowingElements.push({ element: identify(node), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
          text: node.textContent.trim().slice(0, 100) });
      }
      const rect = node.getBoundingClientRect();
      if (rect.right <= width + 1) continue;
      let scrollport;
      for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (scrollports.has(parent)) {
          scrollport = parent;
          break;
        }
      }
      const entry = { element: identify(node), right: Number(rect.right.toFixed(2)), text: node.textContent.trim().slice(0, 100) };
      if (scrollport) containedByScrollport.push({ ...entry, scrollport: identify(scrollport) });
      else outsideViewport.push(entry);
    }
    const containers = [...document.querySelectorAll('html, body, #root, .app-layout, .main-content, .page-container, .page-header, .charts-grid, .simulator-layout, .card, .stat-cards-grid')]
      .filter(isShown).map(node => ({ element: identify(node), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
    return { width, visibleElements: elements.length, outsideViewport, containedByScrollport, overflowingElements,
      scrollports: [...scrollports.values()], invalidScrollports, containers,
      wideContainers: containers.filter(node => node.scrollWidth > node.clientWidth) };
  });
}

export function assertScrollableTable(table) {
  assert.ok(table.exists && table.overflowX === 'auto' && table.scrollWidth > table.clientWidth,
    `The hospitalization table needs its own horizontal scrollport: ${JSON.stringify(table)}`);
  assert.ok(table.scrollLeft > 0 && table.lastColumnVisible, 'The final rate column must be reachable by scrolling the table');
}

export async function inspectHospitalizationScroll(page) {
  return page.evaluate(() => {
    const node = document.getElementById('hospitalization-table-scroll');
    if (!node) return { exists: false };
    node.scrollLeft = node.scrollWidth;
    const box = node.getBoundingClientRect();
    const last = node.querySelector('thead th:last-child').getBoundingClientRect();
    const result = { exists: true, overflowX: getComputedStyle(node).overflowX,
      clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, scrollLeft: node.scrollLeft,
      lastColumnVisible: last.left >= box.left && last.right <= box.right + 1 };
    node.scrollLeft = 0;
    return result;
  });
}
