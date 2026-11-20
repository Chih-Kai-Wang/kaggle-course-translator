import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PDF_OUTPUT_DIR = path.join(__dirname, 'pdfs');

function escapePdfText(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, (ch) => {
      // Map common WinAnsi chars or fallback to octal
      if (ch === '\u2022') return '\\225'; // bullet in WinAnsiEncoding
      if (ch === '\u2014') return '\\227'; // em-dash
      if (ch === '\u2013') return '\\226'; // en-dash
      const code = ch.charCodeAt(0);
      if (code <= 0xff) {
        return '\\' + code.toString(8).padStart(3, '0');
      }
      return '?';
    });
}

function textLine(font, size, x, y, text, color = null) {
  const parts = [];
  if (color) parts.push(`${color} rg`);
  parts.push(`BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapePdfText(text)}) Tj ET`);
  if (color) parts.push('0 0 0 rg');
  return parts.join('\n');
}

function buildPdfBuffer({ title, pages }) {
  // Objects:
  // 1: Catalog -> Pages (2)
  // 2: Pages -> Kids [...]
  // 3: Info -> Title
  // 4..9: Standard 14 Fonts:
  //   F1 Helvetica, F2 Helvetica-Bold, F3 Times-Roman, F4 Times-Bold, F5 Courier, F6 Symbol
  // Then for each page i: contentObj, pageObj
  const objects = [];
  const addObj = (body) => {
    const id = objects.length + 1;
    objects.push({ id, body });
    return id;
  };

  addObj(''); // placeholder 1: Catalog
  addObj(''); // placeholder 2: Pages
  const infoId = addObj(`<< /Title (${escapePdfText(title)}) /Producer (NativeRead E2E PDF 1.4 Generator) >>`);

  const f1 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const f3 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>');
  const f4 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>');
  const f5 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
  const f6 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>');

  const fontDict = `/Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R /F4 ${f4} 0 R /F5 ${f5} 0 R /F6 ${f6} 0 R >>`;

  const pageIds = [];
  for (const page of pages) {
    const streamStr = page.ops.join('\n') + '\n';
    const streamLen = Buffer.byteLength(streamStr, 'latin1');
    const contentId = addObj(`<< /Length ${streamLen} >>\nstream\n${streamStr}endstream`);
    const [x0, y0, x1, y1] = page.mediaBox || [0, 0, 612, 792];
    const pageId = addObj(
      `<< /Type /Page /Parent 2 0 R /MediaBox [${x0} ${y0} ${x1} ${y1}] /Resources << ${fontDict} >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  }

  objects[0].body = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1].body = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;

  const chunks = ['%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'];
  const offsets = [0];
  let cursor = Buffer.byteLength(chunks[0], 'latin1');

  for (const obj of objects) {
    offsets.push(cursor);
    const entry = `${obj.id} 0 obj\n${obj.body}\nendobj\n`;
    chunks.push(entry);
    cursor += Buffer.byteLength(entry, 'latin1');
  }

  const xrefOffset = cursor;
  const xrefLines = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n'];
  for (let i = 1; i < offsets.length; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(xrefLines.join(''), trailer);

  return Buffer.from(chunks.join(''), 'latin1');
}

function makeSingleColWhitepaper() {
  const p1 = [
    textLine('F2', 18, 60, 728, 'Architectural Principles for Low-Latency Edge Computing'),
    textLine('F1', 10, 60, 706, 'Technical Whitepaper Series  |  Enterprise Systems Group'),
    textLine('F2', 14, 60, 668, '1. Executive Summary'),
    textLine('F3', 11, 60, 646, 'Modern distributed systems rely on predictable memory access and deterministic'),
    textLine('F3', 11, 60, 631, 'scheduling across regional edge clusters. By reducing cross-zone transfor-'),
    textLine('F3', 11, 60, 616, 'mation overhead, operators maintain sub-twenty-millisecond tail latency.'),
    textLine('F2', 14, 60, 578, '2. Core Design Requirements'),
    textLine('F3', 11, 72, 556, '\u2022 Deterministic request routing without centralized state locks.'),
    textLine('F3', 11, 72, 540, '\u2022 Incremental binary serialization for zero-copy telemetry streams.'),
    textLine('F3', 11, 72, 524, '\u2022 Bounded retry budgets under transient upstream congestion.'),
    textLine('F3', 11, 60, 488, 'Each node exposes an isolated read-only control plane for health probes'),
    textLine('F3', 11, 60, 473, 'while preserving strict cryptographic separation between tenant buffers.'),
    textLine('F1', 9, 60, 72, '1. Latency measurements reflect p99 medians across 400 synthetic edge nodes.'),
    textLine('F1', 9, 495, 52, 'Page 1 of 3')
  ];

  const p2 = [
    textLine('F2', 14, 60, 726, '3. Deployment Checklist'),
    textLine('F3', 11, 60, 702, '1. Validate TLS termination certificates on every ingress gateway.'),
    textLine('F3', 11, 60, 686, '2. Configure adaptive token-bucket limits before enabling live traffic.'),
    textLine('F3', 11, 60, 670, '3. Verify indexed snapshot recovery under simulated partition faults.'),
    textLine('F2', 14, 60, 630, '4. Observability and Telemetry'),
    textLine('F3', 11, 60, 606, 'Continuous ring buffers record frame latency histograms without allocating'),
    textLine('F3', 11, 60, 591, 'heap objects on the hot path. Operators inspect aggregated percentiles'),
    textLine('F3', 11, 60, 576, 'through lightweight local endpoints during incident triage.'),
    textLine('F1', 9, 60, 72, '2. Ring buffer retention defaults to 24 hours on ephemeral storage.'),
    textLine('F1', 9, 495, 52, 'Page 2 of 3')
  ];

  const p3 = [
    textLine('F2', 14, 60, 726, '5. Conclusion and Future Work'),
    textLine('F3', 11, 60, 702, 'Combining geometric cache partitioning with bounded backoff enables stable'),
    textLine('F3', 11, 60, 687, 'throughput even when upstream providers throttle burst workloads.'),
    textLine('F3', 11, 60, 660, 'Future revisions will extend hardware enclave attestation to cold storage'),
    textLine('F3', 11, 60, 645, 'archives while maintaining full backward compatibility with legacy clients.'),
    textLine('F1', 9, 495, 52, 'Page 3 of 3')
  ];

  return buildPdfBuffer({
    title: 'Architectural Principles for Low-Latency Edge Computing',
    pages: [
      { mediaBox: [0, 0, 612, 792], ops: p1 },
      { mediaBox: [0, 0, 612, 792], ops: p2 },
      { mediaBox: [0, 0, 612, 792], ops: p3 }
    ]
  });
}

function makeTwoColAcademic() {
  // 24pt gutter at x=294..318 (left col: 54..294, right col: 318..558)
  const p1 = [
    textLine('F2', 17, 92, 734, 'Structured Attention for Multi-Column Document Parsing'),
    textLine('F4', 10, 85, 700, 'Alice Researcher'),
    textLine('F3', 10, 85, 686, 'Stanford University'),
    textLine('F5', 9, 85, 672, 'alice@stanford.edu'),
    textLine('F4', 10, 345, 700, 'Bob Scientist'),
    textLine('F3', 10, 345, 686, 'University of Toronto'),
    textLine('F5', 9, 345, 672, 'bob@utoronto.ca'),

    textLine('F2', 13, 54, 634, 'Abstract'),
    textLine('F3', 10, 54, 616, 'Document layout recovery requires separating'),
    textLine('F3', 10, 54, 602, 'adjacent columns without merging unrelated'),
    textLine('F3', 10, 54, 588, 'headings or mathematical expressions.'),

    textLine('F2', 13, 318, 634, '1. Introduction'),
    textLine('F3', 10, 318, 616, 'Academic papers interleave two-column'),
    textLine('F3', 10, 318, 602, 'prose with centered equations and vector'),
    textLine('F3', 10, 318, 588, 'figures that must never be overlapped.'),

    // Centered narrow equation
    textLine('F5', 10, 190, 544, 'Attention(Q, K, V) = softmax(Q * K^T / sqrt(d_k)) * V'),

    textLine('F2', 13, 54, 506, '2. Column Segmentation'),
    textLine('F3', 10, 54, 488, 'Using horizontal X-projection profiles,'),
    textLine('F3', 10, 54, 474, 'we detect continuous vertical gutters'),
    textLine('F3', 10, 54, 460, 'wider than 1.5 times median font size.'),

    textLine('F2', 13, 318, 506, '3. Experimental Setup'),
    textLine('F3', 10, 318, 488, 'We evaluate across diverse single-column'),
    textLine('F3', 10, 318, 474, 'and two-column manuscripts under strict'),
    textLine('F3', 10, 318, 460, 'pixel-overlap invariants.'),

    // Vector diagram box (y=280..410)
    '0.93 0.96 0.99 rg 130 285 352 120 re f',
    '0.15 0.30 0.55 RG 1.2 w 130 285 352 120 re S',
    '0.20 0.45 0.80 rg 160 325 96 42 re f',
    '0.20 0.45 0.80 rg 356 325 96 42 re f',
    '0.15 0.30 0.55 RG 1.5 w 256 346 m 356 346 l S',
    textLine('F2', 10, 186, 342, 'Encoder', '1 1 1'),
    textLine('F2', 10, 384, 342, 'Softmax', '1 1 1'),
    textLine('F1', 9, 136, 266, 'Figure 1: Two-stage encoder and softmax projection architecture.'),

    textLine('F3', 10, 54, 232, 'Left column continues below the figure'),
    textLine('F3', 10, 54, 218, 'with clean reading-order preservation.'),
    textLine('F3', 10, 318, 232, 'Right column follows after left column'),
    textLine('F3', 10, 318, 218, 'completes its vertical reading band.')
  ];

  const p2 = [
    textLine('F2', 13, 54, 728, '4. Ablation Results'),
    textLine('F3', 10, 54, 708, 'Prior studies on neural parsing'),
    textLine('F3', 7, 186, 711, '1'),
    textLine('F3', 10, 194, 708, 'showed that'),
    textLine('F3', 10, 54, 694, 'superscript citations stay inline without'),
    textLine('F3', 10, 54, 680, 'splitting the host paragraph into fragments.'),

    textLine('F2', 13, 318, 728, '5. Reproducibility'),
    textLine('F3', 10, 318, 708, 'All synthetic benchmarks run deterministically'),
    textLine('F3', 10, 318, 694, 'with fixed geometry bounds and zero external'),
    textLine('F3', 10, 318, 680, 'network dependencies.')
  ];

  return buildPdfBuffer({
    title: 'Structured Attention for Multi-Column Document Parsing',
    pages: [
      { mediaBox: [0, 0, 612, 792], ops: p1 },
      { mediaBox: [0, 0, 612, 792], ops: p2 }
    ]
  });
}

function makeMixedTableToc() {
  const p1 = [
    textLine('F2', 16, 60, 726, 'Table of Contents'),
    textLine('F3', 11, 60, 684, '1. Introduction ........................................................................ 1'),
    textLine('F3', 11, 60, 662, '2. System Architecture ................................................................. 4'),
    textLine('F3', 11, 60, 640, '3. Geometric Segmentation ............................................................ 9'),
    textLine('F3', 11, 60, 618, '4. Streaming Transport ................................................................ 14'),
    textLine('F3', 11, 60, 596, '5. Security Model ...................................................................... 19'),
    textLine('F3', 11, 60, 574, '6. Evaluation Benchmarks ............................................................ 25')
  ];

  // Page 2: Stroked 4x3 grid table without dot leaders
  const p2 = [
    textLine('F2', 15, 60, 726, 'Benchmark Latency Comparison'),
    textLine('F3', 11, 60, 698, 'Table 1 summarizes throughput and memory overhead across model sizes.'),
    '0.25 0.25 0.25 RG 0.8 w',
    '60 560 480 112 re S',
    '60 644 m 540 644 l S',
    '60 616 m 540 616 l S',
    '60 588 m 540 588 l S',
    '240 560 m 240 672 l S',
    '390 560 m 390 672 l S',
    textLine('F2', 10, 72, 654, 'Model Name'),
    textLine('F2', 10, 254, 654, 'Tokens/sec'),
    textLine('F2', 10, 404, 654, 'Memory (MB)'),
    textLine('F3', 10, 72, 626, 'Nano-Edge-1B'),
    textLine('F3', 10, 254, 626, '412.5'),
    textLine('F3', 10, 404, 626, '780'),
    textLine('F3', 10, 72, 598, 'Flash-Core-7B'),
    textLine('F3', 10, 254, 598, '184.2'),
    textLine('F3', 10, 404, 598, '3420'),
    textLine('F3', 10, 72, 570, 'Pro-Dense-32B'),
    textLine('F3', 10, 254, 570, '62.8'),
    textLine('F3', 10, 404, 570, '14200'),
    textLine('F1', 9, 60, 536, 'Table 1: Synthetic throughput measured on single-node runtime.')
  ];

  return buildPdfBuffer({
    title: 'Mixed TOC and Benchmark Table Fixture',
    pages: [
      { mediaBox: [0, 0, 612, 792], ops: p1 },
      { mediaBox: [0, 0, 612, 792], ops: p2 }
    ]
  });
}

function makeLandscapeSlides() {
  const p1 = [
    textLine('F2', 18, 60, 726, 'Quarterly Architecture Deck'),
    textLine('F3', 11, 60, 694, 'Page 1 uses portrait orientation while Page 2 switches to landscape'),
    textLine('F3', 11, 60, 678, 'widescreen slides to verify per-page viewport scaling and horizontal fit.')
  ];

  // Landscape [0 0 792 612]
  const p2 = [
    '0.08 0.16 0.32 rg 0 532 792 80 re f',
    textLine('F2', 20, 48, 566, 'Distributed Cache & Streaming Topology', '1 1 1'),
    '0.95 0.97 1.0 rg 48 160 328 330 re f',
    '0.75 0.82 0.92 RG 1 w 48 160 328 330 re S',
    '0.95 0.97 1.0 rg 416 160 328 330 re f',
    '0.75 0.82 0.92 RG 1 w 416 160 328 330 re S',
    textLine('F2', 14, 68, 456, 'Ingress & LRU Cache'),
    textLine('F3', 11, 68, 426, 'Requests resolve against local IndexedDB'),
    textLine('F3', 11, 68, 408, 'entries before dispatching incremental SSE'),
    textLine('F3', 11, 68, 390, 'batches to the configured provider.'),
    textLine('F2', 14, 436, 456, 'Resilient Fallback'),
    textLine('F3', 11, 436, 426, 'Partial chunks update DOM immediately'),
    textLine('F3', 11, 436, 408, 'while unreceived items trigger bounded'),
    textLine('F3', 11, 436, 390, 'binary-split recovery.')
  ];

  return buildPdfBuffer({
    title: 'Mixed Portrait and Landscape Presentation',
    pages: [
      { mediaBox: [0, 0, 612, 792], ops: p1 },
      { mediaBox: [0, 0, 792, 612], ops: p2 }
    ]
  });
}

export function generateAllPdfFixtures(outputDir = PDF_OUTPUT_DIR) {
  fs.mkdirSync(outputDir, { recursive: true });
  const specs = [
    { name: 'single-col-whitepaper.pdf', build: makeSingleColWhitepaper },
    { name: 'two-col-academic.pdf', build: makeTwoColAcademic },
    { name: 'mixed-table-toc.pdf', build: makeMixedTableToc },
    { name: 'landscape-slides.pdf', build: makeLandscapeSlides }
  ];
  const written = [];
  for (const spec of specs) {
    const outPath = path.join(outputDir, spec.name);
    const buf = spec.build();
    fs.writeFileSync(outPath, buf);
    written.push({ name: spec.name, path: outPath, bytes: buf.length });
  }
  return written;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const results = generateAllPdfFixtures();
  console.log(JSON.stringify(results, null, 2));
}
