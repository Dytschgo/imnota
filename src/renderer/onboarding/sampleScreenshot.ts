import type { Annotation, ImagePayload } from '../../shared/types';

const WIDTH = 1280;
const HEIGHT = 760;

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function text(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  options: { color?: string; font?: string; align?: CanvasTextAlign } = {},
) {
  context.fillStyle = options.color ?? '#20242d';
  context.font = options.font ?? '16px system-ui, sans-serif';
  context.textAlign = options.align ?? 'left';
  context.textBaseline = 'middle';
  context.fillText(value, x, y);
}

/** Creates a self-contained, synthetic product-search screenshot. It is never written to disk. */
export function createSampleSearchScreenshot(): ImagePayload {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas rendering is unavailable for the onboarding sample.');

  context.fillStyle = '#f4f6f9';
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, WIDTH, 72);
  context.strokeStyle = '#dfe3e9';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, 71.5);
  context.lineTo(WIDTH, 71.5);
  context.stroke();

  context.fillStyle = '#6857f5';
  roundedRect(context, 28, 24, 24, 24, 6);
  context.fill();
  context.fillStyle = '#ffffff';
  context.fillRect(35, 31, 10, 2);
  context.fillRect(35, 36, 10, 2);
  context.fillRect(35, 41, 7, 2);
  text(context, 'Component index', 66, 36, { font: '600 18px system-ui, sans-serif' });
  text(context, 'Local reference', 1228, 36, {
    color: '#737b89',
    font: '14px system-ui, sans-serif',
    align: 'right',
  });

  context.fillStyle = '#ffffff';
  context.fillRect(0, 72, 242, HEIGHT - 72);
  context.strokeStyle = '#dfe3e9';
  context.beginPath();
  context.moveTo(241.5, 72);
  context.lineTo(241.5, HEIGHT);
  context.stroke();

  text(context, 'FILTERS', 28, 112, { color: '#89909d', font: '700 11px system-ui, sans-serif' });
  const filters = [
    ['All components', true],
    ['Actions', false],
    ['Navigation', false],
    ['Forms', false],
  ] as const;
  filters.forEach(([label, active], index) => {
    const y = 148 + index * 44;
    if (active) {
      context.fillStyle = '#efedff';
      roundedRect(context, 16, y - 17, 210, 34, 7);
      context.fill();
    }
    context.strokeStyle = active ? '#6857f5' : '#aeb5c0';
    context.lineWidth = 1.5;
    roundedRect(context, 29, y - 7, 14, 14, 3);
    context.stroke();
    if (active) {
      context.strokeStyle = '#6857f5';
      context.beginPath();
      context.moveTo(32, y);
      context.lineTo(35, y + 3);
      context.lineTo(40, y - 3);
      context.stroke();
    }
    text(context, label, 54, y, {
      color: active ? '#4338a8' : '#596171',
      font: `${active ? 600 : 400} 14px system-ui, sans-serif`,
    });
  });

  text(context, 'Components', 290, 122, { font: '650 27px system-ui, sans-serif' });
  text(context, 'Search local interface patterns and implementation references.', 290, 158, {
    color: '#697180',
    font: '15px system-ui, sans-serif',
  });

  context.fillStyle = '#ffffff';
  context.strokeStyle = '#b8bfca';
  context.lineWidth = 1.5;
  roundedRect(context, 290, 190, 684, 54, 9);
  context.fill();
  context.stroke();
  context.strokeStyle = '#6e7684';
  context.lineWidth = 2;
  context.beginPath();
  context.arc(316, 217, 8, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(322, 223);
  context.lineTo(329, 230);
  context.stroke();
  text(context, 'button', 343, 217, { font: '16px system-ui, sans-serif' });
  text(context, '/', 949, 217, { color: '#9299a5', font: '12px system-ui, sans-serif', align: 'right' });

  text(context, '3 results', 290, 278, { color: '#7a8290', font: '13px system-ui, sans-serif' });
  const results = [
    {
      title: 'Button',
      path: 'components/actions/Button.tsx',
      detail: 'Primary, secondary, and destructive actions',
    },
    {
      title: 'Icon button',
      path: 'components/actions/IconButton.tsx',
      detail: 'Compact actions with an accessible label',
    },
    {
      title: 'Button group',
      path: 'components/actions/ButtonGroup.tsx',
      detail: 'Related actions with shared spacing',
    },
  ];
  results.forEach((result, index) => {
    const y = 306 + index * 128;
    context.fillStyle = '#ffffff';
    context.strokeStyle = index === 0 ? '#6857f5' : '#dfe3e9';
    context.lineWidth = index === 0 ? 2 : 1;
    roundedRect(context, 290, y, 910, 104, 10);
    context.fill();
    context.stroke();
    context.fillStyle = index === 0 ? '#6857f5' : '#f0f2f5';
    roundedRect(context, 310, y + 20, 64, 32, 7);
    context.fill();
    text(context, index === 0 ? 'Save' : index === 1 ? '↗' : '•••', 342, y + 36, {
      color: index === 0 ? '#ffffff' : '#596171',
      font: '600 13px system-ui, sans-serif',
      align: 'center',
    });
    text(context, result.title, 396, y + 28, { font: '600 16px system-ui, sans-serif' });
    text(context, result.detail, 396, y + 56, { color: '#697180', font: '14px system-ui, sans-serif' });
    text(context, result.path, 396, y + 80, { color: '#9299a5', font: '12px ui-monospace, monospace' });
    text(context, 'Open', 1172, y + 52, {
      color: '#5747df',
      font: '600 13px system-ui, sans-serif',
      align: 'right',
    });
  });

  return {
    filename: 'component-search.png',
    dataUrl: canvas.toDataURL('image/png'),
    width: WIDTH,
    height: HEIGHT,
  };
}

export function createGuidedAnnotations(existingCount = 0): Annotation[] {
  return [
    {
      id: `demo-rectangle-${existingCount}`,
      kind: 'rectangle',
      x: 282,
      y: 182,
      width: 700,
      height: 70,
      rotation: 0,
      stroke: '#ef4444',
      fill: 'transparent',
      strokeWidth: 5,
      opacity: 1,
      zIndex: existingCount,
    },
    {
      id: `demo-text-${existingCount + 1}`,
      kind: 'text',
      x: 724,
      y: 254,
      width: 460,
      height: 42,
      rotation: 0,
      text: 'Keep search visible while reviewing results.',
      stroke: '#ef4444',
      fill: '#b91c1c',
      strokeWidth: 0,
      opacity: 1,
      fontSize: 22,
      fontFamily: 'Arial',
      zIndex: existingCount + 1,
    },
  ];
}

export function buildSamplePromptMarkdown(annotations: Annotation[]): string {
  const notes = annotations.filter(
    (annotation): annotation is Annotation & { text: string } =>
      (annotation.kind === 'text' || annotation.kind === 'callout') && Boolean(annotation.text?.trim()),
  );
  const noteMarkdown = notes
    .map((annotation, index) => `\n### Picture 1 / Note ${index + 1}\n\n${annotation.text.trim()}\n`)
    .join('');
  return `# Component search review

## Picture 1 — component-search.png

Priority for agent: Medium

Keep the component search easy to use while someone reviews several results.${noteMarkdown}`;
}

/** Wraps the annotated screenshot in the labelled, white prompt-PNG structure used by export. */
export async function composeSamplePromptPng(annotatedImageDataUrl: string): Promise<string> {
  const annotated = new Image();
  annotated.src = annotatedImageDataUrl;
  await annotated.decode();
  const margin = 44;
  const headingHeight = 72;
  const width = Math.max(1, annotated.naturalWidth || annotated.width);
  const height = Math.max(1, annotated.naturalHeight || annotated.height);
  const canvas = document.createElement('canvas');
  canvas.width = width + margin * 2;
  canvas.height = height + margin * 2 + headingHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas rendering is unavailable for the sample prompt.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  text(context, 'Picture 1 — component-search.png', margin, margin + 18, {
    color: '#17191f',
    font: '650 24px system-ui, sans-serif',
  });
  context.drawImage(annotated, margin, margin + headingHeight, width, height);
  return canvas.toDataURL('image/png');
}
