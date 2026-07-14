// Boot stub: spawns the genesis worker for seed 42 and dumps the result
// into a <pre>. Task 8+ replaces this with the views.
const el = document.createElement('pre');
el.textContent = 'generating…';
document.body.append(el);

const worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });

worker.onmessage = (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type === 'world') {
    const { system, tiles } = msg;
    el.textContent = `${system.star.className} · ${tiles.width}×${tiles.height} tiles`;
  } else if (msg.type === 'error') {
    // Genesis-refused replies render the message verbatim — the sim's
    // physical reason is the UI copy.
    el.textContent = msg.message;
  }
};

worker.postMessage({ type: 'generate', seed: '42', tilesWidth: 512 });
