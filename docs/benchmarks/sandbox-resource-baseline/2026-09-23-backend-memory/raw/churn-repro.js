const rss = () => { Bun.gc(true); return Math.round(process.memoryUsage.rss() / 1048576 * 10) / 10; };
const cycles = Number(process.argv[2] ?? 8);
console.log(JSON.stringify({ cycle: 0, rss: rss() }));
for (let c = 1; c <= cycles; c++) {
  let keep = [];
  for (let i = 0; i < 400000; i++) {
    keep.push({ id: `row-${c}-${i}`, payload: "x".repeat(200 + (i % 300)), nested: { a: [i, i + 1, i + 2], b: new Uint8Array(64 + (i % 512)) } });
  }
  const peak = Math.round(process.memoryUsage.rss() / 1048576);
  keep = null;
  await Bun.sleep(200);
  const a = rss(); await Bun.sleep(10000); console.log(JSON.stringify({ cycle: c, peak, rss: a, after10s: rss() }));
}
